const APP_URL = "http://localhost:3000/vault";
const VAULTMASTER_URLS = ["http://localhost:3000/*", "http://127.0.0.1:3000/*"];
const RECENT_SELECTIONS_KEY = "vaultmasterRecentSelections";
const PENDING_AUTOFILL_KEY = "vaultmasterPendingAutofill";
const PENDING_SAVE_KEY = "vaultmasterPendingSaves";
const PENDING_SAVE_TTL_MS = 120000;
let pendingSaveTasks = Promise.resolve();

// Badge güncelleme periyodu (ms)
const BADGE_UPDATE_INTERVAL = 5000;

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value) {
	return value === undefined || typeof value === "string";
}

function isHttpUrlString(value) {
	if (typeof value !== "string") {
		return false;
	}

	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

// Chrome supplies the document URL; never let a request claim another site's origin.
function getContentPageUrl(sender, claimedUrl) {
	if (!Number.isInteger(sender.tab?.id) || !isHttpUrlString(sender.url) ||
		(sender.documentLifecycle && sender.documentLifecycle !== "active")) return null;
	if (claimedUrl !== undefined && (!isHttpUrlString(claimedUrl) ||
		new URL(claimedUrl).origin !== new URL(sender.url).origin)) return null;
	return sender.url;
}

function isLoginCredentialPayload(value) {
	return (
		isObject(value) &&
		isOptionalString(value.title) &&
		isHttpUrlString(value.url) &&
		isString(value.username) &&
		isString(value.password)
	);
}

function isValidPasskeyOperation(value) {
	return value === "create" || value === "get";
}

function isRpIdAllowedForOrigin(rpId, origin) {
	if (!isString(rpId) || !isHttpUrlString(origin)) {
		return false;
	}

	try {
		const hostname = new URL(origin).hostname.toLowerCase();
		const normalizedRpId = rpId.toLowerCase();
		return hostname === normalizedRpId || hostname.endsWith(`.${normalizedRpId}`);
	} catch {
		return false;
	}
}

function isStringArray(value) {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isPasskeyInterceptPayload(message) {
	return (
		isValidPasskeyOperation(message?.operation) &&
		isString(message.requestId) &&
		isHttpUrlString(message.pageUrl) &&
		isHttpUrlString(message.origin) &&
		isOptionalString(message.rpId) &&
		isOptionalString(message.rpName) &&
		isOptionalString(message.userName) &&
		isOptionalString(message.userDisplayName) &&
		(message.allowCredentialIds === undefined || isStringArray(message.allowCredentialIds))
	);
}

function isPendingAutofillPayload(value) {
	return (
		isObject(value) &&
		isString(value.itemId) &&
		isString(value.nonce) &&
		isHttpUrlString(value.origin) &&
		Number.isFinite(value.expiresAt) &&
		value.expiresAt > Date.now() &&
		value.expiresAt <= Date.now() + 120000
	);
}

function rejectInvalidPayload(sendResponse) {
	sendResponse({ ok: false, error: "Invalid message payload" });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (["CAPTURE_LOGIN", "GET_PENDING_LOGIN_SAVE", "CONFIRM_LOGIN_SAVE", "DISMISS_LOGIN_SAVE"].includes(message?.type)) {
		// Serialize read/modify/write so a navigation cannot race the submit capture.
		pendingSaveTasks = pendingSaveTasks.then(() => handlePendingSave(message, sender, sendResponse))
			.catch(() => sendResponse({ ok: false, payload: { status: "error" } }));
		return true;
	}
	if (message?.type === "OPEN_VAULTMASTER") {
		void openVaultMaster(sendResponse);
		return true;
	}

	if (message?.type === "GET_EXTENSION_STATUS") {
		void getExtensionStatus(sendResponse);
		return true;
	}

	if (message?.type === "PASSKEY_INTERCEPTED") {
		void handlePasskeyIntercept(message, sender, sendResponse);
		return true;
	}

	if (message?.type === "LIST_LOGIN_SUGGESTIONS") {
		void listLoginSuggestions(message, sender, sendResponse);
		return true;
	}

	if (message?.type === "GET_LOGIN_CREDENTIAL") {
		void getLoginCredential(message, sender, sendResponse);
		return true;
	}

	if (message?.type === "LIST_CREDIT_CARDS") {
		void listCreditCards(sender, sendResponse);
		return true;
	}

	if (message?.type === "GET_CREDIT_CARD") {
		void getCreditCard(message, sender, sendResponse);
		return true;
	}

	if (message?.type === "LIST_IDENTITIES") {
		void listIdentities(sender, sendResponse);
		return true;
	}

	if (message?.type === "GET_IDENTITY") {
		void getIdentity(message, sender, sendResponse);
		return true;
	}

	if (message?.type === "SAVE_LOGIN_CREDENTIAL") {
		void saveLoginCredential(message, sender, sendResponse);
		return true;
	}

	if (message?.type === "TRACK_AUTOFILL_SELECTION") {
		void trackAutofillSelection(message, sendResponse);
		return true;
	}

	if (message?.type === "SET_PENDING_AUTOFILL") {
		void setPendingAutofill(message, sender, sendResponse);
		return true;
	}

	if (message?.type === "GET_PENDING_AUTOFILL") {
		void getPendingAutofill(sender, sendResponse);
		return true;
	}

	if (message?.type === "CLEAR_PENDING_AUTOFILL") {
		void clearPendingAutofill(sender, sendResponse);
		return true;
	}

	if (message?.type === "LOOKUP_PASSWORD_SUGGESTION") {
		void lookupPasswordSuggestion(message, sender, sendResponse);
		return true;
	}

	if (message?.type === "GET_PASSWORD_FOR_FILL") {
		void resolvePasswordForFill(message, sender, sendResponse);
		return true;
	}

	// Phishing koruması - domain doğrulama
	if (message?.type === "VALIDATE_CREDENTIAL_DOMAIN") {
		void validateCredentialDomain(message, sender, sendResponse);
		return true;
	}

	// TOTP code isteme
	if (message?.type === "GET_TOTP_CODE") {
		void getTotpCode(message, sender, sendResponse);
		return true;
	}

	// Vault durumu isteme (badge için)
	if (message?.type === "GET_VAULT_STATUS") {
		void getVaultStatus(sendResponse);
		return true;
	}

	return false;
});

// Klavye kısayolu dinleyicisi (Ctrl+Shift+V)
chrome.commands.onCommand.addListener(async (command) => {
	if (command === "_execute_action") {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tab?.id) {
			chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_AUTOFILL" });
		}
	}
});

// Extension yüklendiğinde badge güncellemesini başlat
chrome.runtime.onInstalled.addListener(() => {
	setupContextMenus();
	void startBadgeUpdater();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (!tab?.id) {
		return;
	}

	if (info.menuItemId === "vaultmaster-fill") {
		chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_AUTOFILL" });
		return;
	}

	if (info.menuItemId === "vaultmaster-open") {
		await openVaultMaster(() => undefined);
	}
});

// Badge durumunu periyodik güncelle
let badgeIntervalId = null;
async function startBadgeUpdater() {
	if (badgeIntervalId) {
		return;
	}
	badgeIntervalId = setInterval(updateBadgeStatus, BADGE_UPDATE_INTERVAL);
	void updateBadgeStatus();
}

function setupContextMenus() {
	chrome.contextMenus.removeAll(() => {
		chrome.contextMenus.create({
			id: "vaultmaster-fill",
			title: "Fill with VaultMaster",
			contexts: ["editable"],
		});
		chrome.contextMenus.create({
			id: "vaultmaster-open",
			title: "Open VaultMaster",
			contexts: ["page", "editable"],
		});
	});
}

async function updateBadgeStatus() {
	const [vaultTab] = await chrome.tabs.query({ url: VAULTMASTER_URLS });

	if (!vaultTab?.id) {
		chrome.action.setBadgeText({ text: "!" });
		chrome.action.setBadgeBackgroundColor({ color: "#6b7280" }); // gri - kapalı
		return;
	}

	try {
		const response = await sendMessageToTab(vaultTab.id, {
			type: "VM_GET_VAULT_STATUS_REQUEST",
			requestId: `badge-${Date.now()}`,
		});

		const isLocked = response?.payload?.isLocked;

		if (isLocked) {
			chrome.action.setBadgeText({ text: "🔒" });
			chrome.action.setBadgeBackgroundColor({ color: "#ef4444" }); // kırmızı - kilitli
		} else {
			chrome.action.setBadgeText({ text: "✓" });
			chrome.action.setBadgeBackgroundColor({ color: "#22c55e" }); // yeşil - açık
		}
	} catch {
		chrome.action.setBadgeText({ text: "?" });
		chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
	}
}

async function openVaultMaster(sendResponse) {
	const [existingTab] = await chrome.tabs.query({ url: VAULTMASTER_URLS });

	if (existingTab?.id) {
		await chrome.tabs.update(existingTab.id, { active: true });
		if (existingTab.windowId) {
			await chrome.windows.update(existingTab.windowId, { focused: true });
		}
		sendResponse({ ok: true, mode: "focus" });
		return;
	}

	await chrome.tabs.create({ url: APP_URL });
	sendResponse({ ok: true, mode: "open" });
}

async function getExtensionStatus(sendResponse) {
	const [vaultTab] = await chrome.tabs.query({ url: VAULTMASTER_URLS });

	sendResponse({
		ok: true,
		payload: {
			hasVaultTab: Boolean(vaultTab?.id),
		},
	});
}

async function handlePasskeyIntercept(message, sender, sendResponse) {
	if (!isPasskeyInterceptPayload(message) || sender.tab?.url !== message.pageUrl) {
		rejectInvalidPayload(sendResponse);
		return;
	}

	const pageOrigin = new URL(message.pageUrl).origin;
	if (pageOrigin !== message.origin) {
		sendResponse({ ok: false, payload: { status: "origin_mismatch" } });
		return;
	}

	const effectiveRpId = message.rpId || new URL(message.origin).hostname;
	if (!isRpIdAllowedForOrigin(effectiveRpId, message.origin)) {
		sendResponse({ ok: false, payload: { status: "rp_mismatch" } });
		return;
	}

	const vaultResponse = await requestVaultTab("VM_PASSKEY_BRIDGE_REQUEST", {
		operation: message.operation,
		rpId: effectiveRpId,
		rpName: message.rpName || "",
		userName: message.userName || "",
		userDisplayName: message.userDisplayName || "",
		allowCredentialIds: message.allowCredentialIds || [],
		origin: message.origin,
		pageUrl: message.pageUrl,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse({
		ok: true,
		payload: {
			status: vaultResponse?.payload?.status || "consent_required",
			operation: message.operation,
			rpId: effectiveRpId,
			origin: message.origin,
			pageUrl: message.pageUrl,
			sourceTabId: sender.tab?.id ?? null,
			candidates: vaultResponse?.payload?.candidates || [],
			message: vaultResponse?.payload?.message || "VaultMaster detected a passkey request. Credential creation/signing is not automatic and requires an explicit user action in VaultMaster.",
		},
	});
}

async function lookupPasswordSuggestion(message, sender, sendResponse) {
	if (!isOptionalString(message.identifier) || !isHttpUrlString(message.pageUrl)) {
		rejectInvalidPayload(sendResponse);
		return;
	}

	const response = await requestVaultTab("VM_LOOKUP_PASSWORD_REQUEST", {
		identifier: message.identifier,
		pageUrl: message.pageUrl,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

async function resolvePasswordForFill(message, sender, sendResponse) {
	if (!isString(message.itemId) || !isOptionalString(message.identifier) || !isHttpUrlString(message.pageUrl)) {
		rejectInvalidPayload(sendResponse);
		return;
	}

	const pageUrl = getContentPageUrl(sender, message.pageUrl);
	if (!pageUrl) { rejectInvalidPayload(sendResponse); return; }

	const response = await requestVaultTab("VM_GET_PASSWORD_REQUEST", {
		itemId: message.itemId,
		identifier: message.identifier,
		pageUrl,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

async function listLoginSuggestions(message, sender, sendResponse) {
	if (!isOptionalString(message.identifier) || !isHttpUrlString(message.pageUrl)) {
		rejectInvalidPayload(sendResponse);
		return;
	}

	const response = await requestVaultTab("VM_LIST_LOGIN_SUGGESTIONS_REQUEST", {
		identifier: message.identifier || "",
		pageUrl: message.pageUrl,
		sourceTabId: sender.tab?.id ?? null,
	});

	if (!response?.ok || response.payload?.status !== "ready") {
		sendResponse(response);
		return;
	}

	const hostname = normalizeHostname(message.pageUrl);
	const recentSelections = await getRecentSelections();
	const preferredItemId = hostname ? recentSelections[hostname] : null;
	const suggestions = reorderSuggestions(response.payload.suggestions || [], preferredItemId);

	sendResponse({
		ok: true,
		payload: {
			...response.payload,
			suggestions,
		},
	});
}

async function getLoginCredential(message, sender, sendResponse) {
	if (!isString(message.itemId) || !isHttpUrlString(message.pageUrl)) {
		rejectInvalidPayload(sendResponse);
		return;
	}

	const pageUrl = getContentPageUrl(sender, message.pageUrl);
	if (!pageUrl) { rejectInvalidPayload(sendResponse); return; }

	const response = await requestVaultTab("VM_GET_LOGIN_CREDENTIAL_REQUEST", {
		itemId: message.itemId,
		pageUrl,
		forceFill: message.forceFill === true,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

async function listCreditCards(sender, sendResponse) {
	const response = await requestVaultTab("VM_LIST_CREDIT_CARDS_REQUEST", {
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

async function getCreditCard(message, sender, sendResponse) {
	if (!isString(message.itemId) || !getContentPageUrl(sender)) {
		rejectInvalidPayload(sendResponse);
		return;
	}

	const response = await requestVaultTab("VM_GET_CREDIT_CARD_REQUEST", {
		itemId: message.itemId,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

async function listIdentities(sender, sendResponse) {
	const response = await requestVaultTab("VM_LIST_IDENTITIES_REQUEST", {
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

async function getIdentity(message, sender, sendResponse) {
	if (!isString(message.itemId) || !getContentPageUrl(sender)) {
		rejectInvalidPayload(sendResponse);
		return;
	}

	const response = await requestVaultTab("VM_GET_IDENTITY_REQUEST", {
		itemId: message.itemId,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

async function saveLoginCredential(message, sender, sendResponse) {
	if (!isLoginCredentialPayload(message.credential) || !getContentPageUrl(sender, message.credential.url)) {
		rejectInvalidPayload(sendResponse);
		return;
	}

	const response = await requestVaultTab("VM_SAVE_LOGIN_REQUEST", {
		credential: message.credential,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

async function trackAutofillSelection(message, sendResponse) {
	if (!isString(message.itemId) || !(isHttpUrlString(message.pageUrl) || isString(message.hostname))) {
		rejectInvalidPayload(sendResponse);
		return;
	}

	const hostname = normalizeHostname(message.pageUrl || message.hostname);
	if (!hostname || !message.itemId) {
		sendResponse({ ok: false });
		return;
	}

	const recentSelections = await getRecentSelections();
	recentSelections[hostname] = message.itemId;
	await chrome.storage.local.set({
		[RECENT_SELECTIONS_KEY]: recentSelections,
	});

	sendResponse({ ok: true });
}

async function setPendingAutofill(message, sender, sendResponse) {
	const tabId = sender.tab?.id;
	if (tabId === undefined || !isPendingAutofillPayload(message.pendingAutofill) ||
		!isHttpUrlString(sender.url) || new URL(sender.url).origin !== message.pendingAutofill.origin) {
		rejectInvalidPayload(sendResponse);
		return;
	}

	const { itemId, nonce, title, username, hasTotp, origin, expiresAt } = message.pendingAutofill;
	const safePendingAutofill = { itemId, nonce, title, username, hasTotp, origin, expiresAt };
	const stored = await getPendingAutofillMap();
	stored[`${tabId}:${sender.frameId ?? 0}`] = safePendingAutofill;
	await chrome.storage.session.set({
		[PENDING_AUTOFILL_KEY]: stored,
	});

	sendResponse({ ok: true });
}

async function getPendingAutofill(sender, sendResponse) {
	const tabId = sender.tab?.id;
	if (!tabId) {
		sendResponse({ ok: true, payload: { pendingAutofill: null } });
		return;
	}

	const stored = await getPendingAutofillMap();
	const key = `${tabId}:${sender.frameId ?? 0}`;
	const pending = stored[key];
	const valid = pending && pending.expiresAt > Date.now() && isHttpUrlString(sender.url) &&
		new URL(sender.url).origin === pending.origin;
	if (pending && !valid) {
		delete stored[key];
		await chrome.storage.session.set({ [PENDING_AUTOFILL_KEY]: stored });
	}
	sendResponse({
		ok: true,
		payload: {
			pendingAutofill: valid ? pending : null,
		},
	});
}

async function clearPendingAutofill(sender, sendResponse) {
	const tabId = sender.tab?.id;
	if (!tabId) {
		sendResponse({ ok: true });
		return;
	}

	const stored = await getPendingAutofillMap();
	delete stored[`${tabId}:${sender.frameId ?? 0}`];
	await chrome.storage.session.set({
		[PENDING_AUTOFILL_KEY]: stored,
	});

	sendResponse({ ok: true });
}

// Phishing koruması - domain doğrulama
async function validateCredentialDomain(message, sender, sendResponse) {
	if (!isString(message.itemId) || !isHttpUrlString(message.expectedUrl)) {
		rejectInvalidPayload(sendResponse);
		return;
	}

	const pageUrl = getContentPageUrl(sender, message.expectedUrl);
	if (!pageUrl) { rejectInvalidPayload(sendResponse); return; }

	const response = await requestVaultTab("VM_VALIDATE_CREDENTIAL_DOMAIN_REQUEST", {
		itemId: message.itemId,
		pageUrl,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

// TOTP code isteme
async function getTotpCode(message, sender, sendResponse) {
	if (!isString(message.itemId) || !getContentPageUrl(sender)) {
		rejectInvalidPayload(sendResponse);
		return;
	}

	const response = await requestVaultTab("VM_GET_TOTP_CODE_REQUEST", {
		itemId: message.itemId,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

// Vault durumu isteme
async function getVaultStatus(sendResponse) {
	const [vaultTab] = await chrome.tabs.query({ url: VAULTMASTER_URLS });

	if (!vaultTab?.id) {
		sendResponse({
			ok: true,
			payload: { isLocked: true, isAuthenticated: false },
		});
		return;
	}

	const response = await sendMessageToTab(vaultTab.id, {
		type: "VM_GET_VAULT_STATUS_REQUEST",
		requestId: `vault-status-${Date.now()}`,
	});

	sendResponse(response);
}

async function requestVaultTab(type, payload) {
	const vaultTab = await getVaultTab();
	if (!vaultTab?.id) {
		return {
			ok: false,
			payload: { status: "vault_unavailable" },
		};
	}

	return sendMessageToTab(vaultTab.id, {
		type,
		...payload,
	});
}

async function getVaultTab() {
	const [vaultTab] = await chrome.tabs.query({ url: VAULTMASTER_URLS });
	return vaultTab || null;
}

function sendMessageToTab(tabId, payload) {
	return new Promise((resolve) => {
		chrome.tabs.sendMessage(tabId, payload, (response) => {
			const runtimeError = chrome.runtime.lastError;
			if (runtimeError) {
				resolve({
					ok: false,
					payload: {
						status: "bridge_error",
						error: runtimeError.message,
					},
				});
				return;
			}

			resolve(response || { ok: false, payload: { status: "empty_response" } });
		});
	});
}

async function getRecentSelections() {
	const stored = await chrome.storage.local.get(RECENT_SELECTIONS_KEY);
	return stored[RECENT_SELECTIONS_KEY] || {};
}

async function getPendingAutofillMap() {
	const stored = await chrome.storage.session.get(PENDING_AUTOFILL_KEY);
	return stored[PENDING_AUTOFILL_KEY] || {};
}

function normalizeHostname(value) {
	if (!value) {
		return "";
	}

	try {
		const url = new URL(value);
		return url.hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return String(value).replace(/^www\./, "").toLowerCase();
	}
}

function reorderSuggestions(suggestions, preferredItemId) {
	return [...suggestions]
		.map((suggestion) => ({
			...suggestion,
			isPreferred: suggestion.itemId === preferredItemId,
		}))
		.sort((a, b) => {
			if (a.isPreferred !== b.isPreferred) {
				return a.isPreferred ? -1 : 1;
			}

			if (a.isExactIdentifierMatch !== b.isExactIdentifierMatch) {
				return a.isExactIdentifierMatch ? -1 : 1;
			}

			return (b.matchScore || 0) - (a.matchScore || 0);
		});
}

function encodeBytes(bytes) {
	return btoa(String.fromCharCode(...bytes));
}

function decodeBytes(value) {
	return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function handlePendingSave(message, sender, sendResponse) {
	if (sender.tab?.id === undefined || !isHttpUrlString(sender.url)) {
		rejectInvalidPayload(sendResponse);
		return;
	}
	const origin = new URL(sender.url).origin;
	const slot = `${sender.tab.id}:${sender.frameId ?? 0}`;
	const stored = (await chrome.storage.session.get(PENDING_SAVE_KEY))[PENDING_SAVE_KEY] || {};
	for (const [key, entry] of Object.entries(stored)) {
		if (entry.expiresAt <= Date.now()) delete stored[key];
	}
	if (message.type === "CAPTURE_LOGIN") {
		const credential = message.credential;
		if (!isLoginCredentialPayload(credential) || new URL(credential.url).origin !== origin || credential.password.length > 10000 || credential.username.length > 1024 || (credential.title?.length || 0) > 512) {
			rejectInvalidPayload(sendResponse);
			return;
		}
		const hosts = (await chrome.storage.local.get("vaultmasterNeverSaveHosts")).vaultmasterNeverSaveHosts || [];
		if (hosts.includes(normalizeHostname(origin))) {
			sendResponse({ ok: true, payload: { status: "ignored" } });
			return;
		}
		const rawKey = crypto.getRandomValues(new Uint8Array(32));
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
		const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(credential)));
		stored[slot] = {
			id: crypto.randomUUID(), origin, url: credential.url, title: credential.title || "", username: credential.username,
			expiresAt: Date.now() + PENDING_SAVE_TTL_MS,
			key: encodeBytes(rawKey), iv: encodeBytes(iv), ciphertext: encodeBytes(new Uint8Array(encrypted)),
		};
		await chrome.storage.session.set({ [PENDING_SAVE_KEY]: stored });
		sendResponse({ ok: true, payload: { status: "captured" } });
		return;
	}
	const draft = stored[slot];
	if (!draft || draft.origin !== origin) {
		delete stored[slot];
		await chrome.storage.session.set({ [PENDING_SAVE_KEY]: stored });
		sendResponse({ ok: true, payload: { status: "no_match", draft: null } });
		return;
	}
	if (message.type === "GET_PENDING_LOGIN_SAVE") {
		const { id, title, username, url, expiresAt } = draft;
		sendResponse({ ok: true, payload: { draft: { id, title, username, url, expiresAt } } });
		return;
	}
	if (message.draftId !== draft.id) {
		rejectInvalidPayload(sendResponse);
		return;
	}
	if (message.type === "DISMISS_LOGIN_SAVE") {
		delete stored[slot];
		await chrome.storage.session.set({ [PENDING_SAVE_KEY]: stored });
		sendResponse({ ok: true });
		return;
	}
	const key = await crypto.subtle.importKey("raw", decodeBytes(draft.key), "AES-GCM", false, ["decrypt"]);
	const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBytes(draft.iv) }, key, decodeBytes(draft.ciphertext));
	const credential = JSON.parse(new TextDecoder().decode(plaintext));
	const response = await requestVaultTab("VM_SAVE_LOGIN_REQUEST", { credential, sourceTabId: sender.tab.id });
	if (response?.ok && ["created", "updated"].includes(response.payload?.status)) {
		delete stored[slot];
		await chrome.storage.session.set({ [PENDING_SAVE_KEY]: stored });
	}
	sendResponse(response);
}


chrome.tabs.onRemoved?.addListener(tabId => {
	pendingSaveTasks = pendingSaveTasks.then(async () => {
		const values = await chrome.storage.session.get([PENDING_SAVE_KEY, PENDING_AUTOFILL_KEY]);
		for (const storageKey of [PENDING_SAVE_KEY, PENDING_AUTOFILL_KEY]) {
			const entries = values[storageKey] || {};
			for (const slot of Object.keys(entries)) {
				if (slot.startsWith(`${tabId}:`)) delete entries[slot];
			}
			await chrome.storage.session.set({ [storageKey]: entries });
		}
	}).catch(() => undefined);
});
