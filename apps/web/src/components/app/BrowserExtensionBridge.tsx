"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { useShallow } from "zustand/shallow";
import { generateTotpCode } from "@/lib/totp";

const LOOKUP_REQUEST = "VM_LOOKUP_PASSWORD_REQUEST";
const LOOKUP_RESPONSE = "VM_LOOKUP_PASSWORD_REQUEST_RESPONSE";
const SECRET_REQUEST = "VM_GET_PASSWORD_REQUEST";
const SECRET_RESPONSE = "VM_GET_PASSWORD_REQUEST_RESPONSE";
const LIST_REQUEST = "VM_LIST_LOGIN_SUGGESTIONS_REQUEST";
const LIST_RESPONSE = "VM_LIST_LOGIN_SUGGESTIONS_REQUEST_RESPONSE";
const CREDENTIAL_REQUEST = "VM_GET_LOGIN_CREDENTIAL_REQUEST";
const CREDENTIAL_RESPONSE = "VM_GET_LOGIN_CREDENTIAL_REQUEST_RESPONSE";
const VALIDATE_DOMAIN_REQUEST = "VM_VALIDATE_CREDENTIAL_DOMAIN_REQUEST";
const VALIDATE_DOMAIN_RESPONSE = "VM_VALIDATE_CREDENTIAL_DOMAIN_RESPONSE";
const TOTP_REQUEST = "VM_GET_TOTP_CODE_REQUEST";
const TOTP_RESPONSE = "VM_GET_TOTP_CODE_RESPONSE";
const VAULT_STATUS_REQUEST = "VM_GET_VAULT_STATUS_REQUEST";
const VAULT_STATUS_RESPONSE = "VM_GET_VAULT_STATUS_RESPONSE";
const LIST_CARDS_REQUEST = "VM_LIST_CREDIT_CARDS_REQUEST";
const LIST_CARDS_RESPONSE = "VM_LIST_CREDIT_CARDS_RESPONSE";
const GET_CARD_REQUEST = "VM_GET_CREDIT_CARD_REQUEST";
const GET_CARD_RESPONSE = "VM_GET_CREDIT_CARD_RESPONSE";
const LIST_IDENTITIES_REQUEST = "VM_LIST_IDENTITIES_REQUEST";
const LIST_IDENTITIES_RESPONSE = "VM_LIST_IDENTITIES_RESPONSE";
const GET_IDENTITY_REQUEST = "VM_GET_IDENTITY_REQUEST";
const GET_IDENTITY_RESPONSE = "VM_GET_IDENTITY_RESPONSE";
const SAVE_LOGIN_REQUEST = "VM_SAVE_LOGIN_REQUEST";
const SAVE_LOGIN_RESPONSE = "VM_SAVE_LOGIN_RESPONSE";
const VAULTMASTER_ORIGINS = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);

function isAllowedExtensionBridgeOrigin(origin: string) {
	return VAULTMASTER_ORIGINS.has(origin);
}

function normalizeUrl(value?: string) {
	if (!value) {
		return null;
	}

	try {
		const url = new URL(value);
		return {
			hostname: url.hostname.replace(/^www\./, "").toLowerCase(),
			href: url.href.toLowerCase(),
		};
	} catch {
		return null;
	}
}

function normalizeIdentifier(value?: string) {
	return value?.trim().toLowerCase() || "";
}

function scoreHostMatch(activePage: ReturnType<typeof normalizeUrl>, loginUrl: string | undefined) {
	const targetUrl = normalizeUrl(loginUrl);
	if (!activePage || !targetUrl) {
		return 0;
	}

	if (
		activePage.hostname === targetUrl.hostname ||
		activePage.hostname.endsWith(`.${targetUrl.hostname}`) ||
		targetUrl.hostname.endsWith(`.${activePage.hostname}`)
	) {
		return 3;
	}

	if (activePage.href.includes(targetUrl.hostname)) {
		return 1;
	}

	return -5;
}

function buildLoginSuggestions(
	items: ReturnType<typeof useStore.getState>["items"],
	pageUrl?: string,
	identifierQuery?: string
) {
	const activePage = normalizeUrl(pageUrl);
	const query = normalizeIdentifier(identifierQuery);

	return items
		.filter((item) => item.data.type === "login")
		.map((item) => {
			const loginData = item.data;
			if (loginData.type !== "login") {
				return null;
			}

			const hostScore = scoreHostMatch(activePage, loginData.url);
			if (hostScore < 0) {
				return null;
			}

			const username = loginData.username.trim();
			const normalizedUsername = normalizeIdentifier(username);
			const normalizedTitle = normalizeIdentifier(loginData.title);
			const isExactIdentifierMatch = query.length > 0 && normalizedUsername === query;
			const matchesQuery =
				query.length === 0 ||
				normalizedUsername.includes(query) ||
				normalizedTitle.includes(query);

			if (!matchesQuery) {
				return null;
			}

			return {
				itemId: item.id,
				title: loginData.title,
				username,
				url: loginData.url || "",
				hostScore,
				isExactIdentifierMatch,
			};
		})
		.filter((item): item is NonNullable<typeof item> => item !== null)
		.sort((a, b) => {
			if (a.isExactIdentifierMatch !== b.isExactIdentifierMatch) {
				return a.isExactIdentifierMatch ? -1 : 1;
			}

			if (a.hostScore !== b.hostScore) {
				return b.hostScore - a.hostScore;
			}

			return a.title.localeCompare(b.title, "tr");
		});
}

export default function BrowserExtensionBridge() {
	const { isAuthenticated, isLocked, items, lastSyncedAt, isUsingOfflineData, createVaultItem, updateVaultItemFull } = useStore(
		useShallow((state) => ({
			isAuthenticated: state.isAuthenticated,
			isLocked: state.isLocked,
			items: state.items,
			lastSyncedAt: state.lastSyncedAt,
			isUsingOfflineData: state.isUsingOfflineData,
			createVaultItem: state.createVaultItem,
			updateVaultItemFull: state.updateVaultItemFull,
		}))
	);

	useEffect(() => {
		const onMessage = async (event: MessageEvent) => {
			if (event.source !== window || !isAllowedExtensionBridgeOrigin(event.origin)) {
				return;
			}

			const data = event.data as
				| {
						source?: string;
						type?: string;
						requestId?: string;
						pageUrl?: string;
						identifier?: string;
						itemId?: string;
						credential?: {
							title?: string;
							url?: string;
							username?: string;
							password?: string;
						};
					}
				| undefined;

			if (data?.source !== "vaultmaster-extension" || !data.type || !data.requestId) {
				return;
			}

			const responseType = resolveResponseType(data.type);
				if (!responseType) {
					return;
				}

				const respond = (type: string, payload: unknown) => {
				window.postMessage(
					{
						source: "vaultmaster-web",
						type,
						requestId: data.requestId,
						payload,
					},
					window.location.origin
				);
			};

			if (data.type === VAULT_STATUS_REQUEST) {
				respond(VAULT_STATUS_RESPONSE, {
					isLocked,
					isAuthenticated,
					isUsingOfflineData,
					lastSyncedAt,
				});
				return;
			}

			if (!isAuthenticated) {
				respond(responseType, {
					status: "logged_out",
					isAuthenticated,
					isLocked,
					lastSyncedAt,
					isUsingOfflineData,
				});
				return;
			}

			if (isLocked) {
				respond(responseType, {
					status: "locked",
					isAuthenticated,
					isLocked,
					lastSyncedAt,
					isUsingOfflineData,
				});
				return;
			}

			if (data.type === LOOKUP_REQUEST) {
				const identifier = normalizeIdentifier(data.identifier);
				if (!identifier) {
					respond(LOOKUP_RESPONSE, { status: "missing_identifier" });
					return;
				}

				const suggestions = buildLoginSuggestions(items, data.pageUrl, identifier).map(
					(suggestion) => ({
						itemId: suggestion.itemId,
						title: suggestion.title,
						username: suggestion.username,
						url: suggestion.url,
						matchScore: suggestion.hostScore,
						isExactIdentifierMatch: suggestion.isExactIdentifierMatch,
					})
				);

				if (!suggestions.length) {
					respond(LOOKUP_RESPONSE, {
						status: "no_match",
						lastSyncedAt,
						isUsingOfflineData,
					});
					return;
				}

				respond(LOOKUP_RESPONSE, {
					status: "ready",
					lastSyncedAt,
					isUsingOfflineData,
					suggestion: suggestions[0],
				});
				return;
			}

			if (data.type === SAVE_LOGIN_REQUEST) {
				const credential = data.credential;
				if (!credential?.username || !credential.password || !credential.url) {
					respond(SAVE_LOGIN_RESPONSE, { status: "invalid" });
					return;
				}

				const activePage = normalizeUrl(credential.url);
				const existingItem = items.find((item) => {
					if (item.data.type !== "login") return false;
					return (
						normalizeIdentifier(item.data.username) === normalizeIdentifier(credential.username) &&
						scoreHostMatch(activePage, item.data.url) > 0
					);
				});

				if (existingItem && existingItem.data.type === "login") {
					await updateVaultItemFull(
						existingItem.id,
						{
							...existingItem.data,
							password: credential.password,
							url: existingItem.data.url || credential.url,
						},
						existingItem.folderId
					);
					respond(SAVE_LOGIN_RESPONSE, { status: "updated", itemId: existingItem.id });
					return;
				}

				await createVaultItem({
					type: "login",
					title: credential.title || activePage?.hostname || "Yeni Login",
					url: credential.url,
					username: credential.username,
					password: credential.password,
				});
				respond(SAVE_LOGIN_RESPONSE, { status: "created" });
				return;
			}

			if (data.type === LIST_CARDS_REQUEST) {
				const cards = items
					.filter((item) => item.data.type === "credit_card")
					.slice(0, 8)
					.map((item) => {
						if (item.data.type !== "credit_card") return null;
						return {
							itemId: item.id,
							title: item.data.title,
							cardholderName: item.data.cardholderName,
							last4: item.data.cardNumber.slice(-4),
							expMonth: item.data.expMonth,
							expYear: item.data.expYear,
						};
					})
					.filter((item) => item !== null);

				respond(LIST_CARDS_RESPONSE, {
					status: cards.length ? "ready" : "no_match",
					cards,
					lastSyncedAt,
					isUsingOfflineData,
				});
				return;
			}

			if (data.type === GET_CARD_REQUEST) {
				const item = items.find((entry) => entry.id === data.itemId);
				if (!item || item.data.type !== "credit_card") {
					respond(GET_CARD_RESPONSE, { status: "no_match" });
					return;
				}

				respond(GET_CARD_RESPONSE, {
					status: "ready",
					card: item.data,
					lastSyncedAt,
					isUsingOfflineData,
				});
				return;
			}

			if (data.type === LIST_IDENTITIES_REQUEST) {
				const identities = items
					.filter((item) => item.data.type === "identity")
					.slice(0, 8)
					.map((item) => {
						if (item.data.type !== "identity") return null;
						return {
							itemId: item.id,
							title: item.data.title,
							fullName: item.data.fullName,
							email: item.data.email || "",
						};
					})
					.filter((item) => item !== null);

				respond(LIST_IDENTITIES_RESPONSE, {
					status: identities.length ? "ready" : "no_match",
					identities,
					lastSyncedAt,
					isUsingOfflineData,
				});
				return;
			}

			if (data.type === GET_IDENTITY_REQUEST) {
				const item = items.find((entry) => entry.id === data.itemId);
				if (!item || item.data.type !== "identity") {
					respond(GET_IDENTITY_RESPONSE, { status: "no_match" });
					return;
				}

				respond(GET_IDENTITY_RESPONSE, {
					status: "ready",
					identity: item.data,
					lastSyncedAt,
					isUsingOfflineData,
				});
				return;
			}

			if (data.type === LIST_REQUEST) {
				const suggestions = buildLoginSuggestions(items, data.pageUrl, data.identifier)
					.slice(0, 6)
					.map((suggestion) => ({
						itemId: suggestion.itemId,
						title: suggestion.title,
						username: suggestion.username,
						url: suggestion.url,
						matchScore: suggestion.hostScore,
						isExactIdentifierMatch: suggestion.isExactIdentifierMatch,
					}));

				if (!suggestions.length) {
					respond(LIST_RESPONSE, {
						status: "no_match",
						lastSyncedAt,
						isUsingOfflineData,
					});
					return;
				}

				respond(LIST_RESPONSE, {
					status: "ready",
					lastSyncedAt,
					isUsingOfflineData,
					suggestions,
				});
				return;
			}

			if (data.type === SECRET_REQUEST) {
				const identifier = normalizeIdentifier(data.identifier);
				const activePage = normalizeUrl(data.pageUrl);
				const matchedItem = items.find((item) => {
					if (item.id !== data.itemId || item.data.type !== "login") {
						return false;
					}

					const loginData = item.data;
					if (normalizeIdentifier(loginData.username) !== identifier) {
						return false;
					}

					return scoreHostMatch(activePage, loginData.url) >= 0;
				});

				if (!matchedItem || matchedItem.data.type !== "login") {
					respond(SECRET_RESPONSE, {
						status: "no_match",
					});
					return;
				}

				respond(SECRET_RESPONSE, {
					status: "ready",
					password: matchedItem.data.password,
					lastSyncedAt,
					isUsingOfflineData,
				});
				return;
			}

			if (data.type === CREDENTIAL_REQUEST) {
				const activePage = normalizeUrl(data.pageUrl);
				const matchedItem = items.find((item) => {
					if (item.id !== data.itemId || item.data.type !== "login") {
						return false;
					}

					return scoreHostMatch(activePage, item.data.url) >= 0;
				});

				if (!matchedItem || matchedItem.data.type !== "login") {
					respond(CREDENTIAL_RESPONSE, {
						status: "no_match",
					});
					return;
				}

				respond(CREDENTIAL_RESPONSE, {
					status: "ready",
					credential: {
						itemId: matchedItem.id,
						title: matchedItem.data.title,
						username: matchedItem.data.username,
						password: matchedItem.data.password,
						url: matchedItem.data.url || "",
						hasTotp: Boolean(matchedItem.data.totpSecret),
					},
					lastSyncedAt,
					isUsingOfflineData,
				});
				return;
			}

			// Phishing koruması - domain doğrulama
			if (data.type === VALIDATE_DOMAIN_REQUEST) {
				const activePage = normalizeUrl(data.pageUrl);
				const matchedItem = items.find((item) => {
					if (item.id !== data.itemId || item.data.type !== "login") {
						return false;
					}
					return scoreHostMatch(activePage, item.data.url) > 0;
				});

				respond(VALIDATE_DOMAIN_RESPONSE, {
					valid: Boolean(matchedItem),
					itemId: matchedItem?.id,
				});
				return;
			}

			// TOTP code üretimi
			if (data.type === TOTP_REQUEST) {
				const item = items.find((i) => i.id === data.itemId);
				if (!item || item.data.type !== "login" || !item.data.totpSecret) {
					respond(TOTP_RESPONSE, { status: "no_totp" });
					return;
				}

				try {
					const totp = await generateTotpCode(item.data.totpSecret);
					respond(TOTP_RESPONSE, {
						status: "ready",
						totpCode: totp.code,
						expiresIn: totp.expiresIn,
					});
				} catch {
					respond(TOTP_RESPONSE, { status: "error" });
				}
				return;
			}

		};

		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [createVaultItem, isAuthenticated, isLocked, isUsingOfflineData, items, lastSyncedAt, updateVaultItemFull]);

	return null;
}

function resolveResponseType(type: string): string | null {
	if (type === LOOKUP_REQUEST) {
		return LOOKUP_RESPONSE;
	}

	if (type === LIST_REQUEST) {
		return LIST_RESPONSE;
	}

	if (type === CREDENTIAL_REQUEST) {
		return CREDENTIAL_RESPONSE;
	}

	if (type === VALIDATE_DOMAIN_REQUEST) {
		return VALIDATE_DOMAIN_RESPONSE;
	}

	if (type === SAVE_LOGIN_REQUEST) {
		return SAVE_LOGIN_RESPONSE;
	}

	if (type === LIST_CARDS_REQUEST) {
		return LIST_CARDS_RESPONSE;
	}

	if (type === GET_CARD_REQUEST) {
		return GET_CARD_RESPONSE;
	}

	if (type === LIST_IDENTITIES_REQUEST) {
		return LIST_IDENTITIES_RESPONSE;
	}

	if (type === GET_IDENTITY_REQUEST) {
		return GET_IDENTITY_RESPONSE;
	}

	if (type === TOTP_REQUEST) {
		return TOTP_RESPONSE;
	}

	if (type === VAULT_STATUS_REQUEST) {
		return VAULT_STATUS_RESPONSE;
	}

	if (type === SECRET_REQUEST) {
		return SECRET_RESPONSE;
	}

	return null;
}