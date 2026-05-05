const APP_URL = "http://localhost:3001/vault";
const VAULTMASTER_URLS = [
	"http://localhost:3000/*",
	"http://127.0.0.1:3000/*",
	"http://localhost:3001/*",
	"http://127.0.0.1:3001/*",
];
const RECENT_SELECTIONS_KEY = "vaultmasterRecentSelections";
const PENDING_AUTOFILL_KEY = "vaultmasterPendingAutofill";

// Badge güncelleme periyodu (ms)
const BADGE_UPDATE_INTERVAL = 5000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.type === "OPEN_VAULTMASTER") {
		void openVaultMaster(sendResponse);
		return true;
	}

	if (message?.type === "GET_EXTENSION_STATUS") {
		void getExtensionStatus(sendResponse);
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

async function lookupPasswordSuggestion(message, sender, sendResponse) {
	const response = await requestVaultTab("VM_LOOKUP_PASSWORD_REQUEST", {
		identifier: message.identifier,
		pageUrl: message.pageUrl,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

async function resolvePasswordForFill(message, sender, sendResponse) {
	const response = await requestVaultTab("VM_GET_PASSWORD_REQUEST", {
		itemId: message.itemId,
		identifier: message.identifier,
		pageUrl: message.pageUrl,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

async function listLoginSuggestions(message, sender, sendResponse) {
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
	const response = await requestVaultTab("VM_GET_LOGIN_CREDENTIAL_REQUEST", {
		itemId: message.itemId,
		pageUrl: message.pageUrl,
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
	const response = await requestVaultTab("VM_GET_IDENTITY_REQUEST", {
		itemId: message.itemId,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

async function saveLoginCredential(message, sender, sendResponse) {
	const response = await requestVaultTab("VM_SAVE_LOGIN_REQUEST", {
		credential: message.credential,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

async function trackAutofillSelection(message, sendResponse) {
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
	if (!tabId || !message.pendingAutofill) {
		sendResponse({ ok: false });
		return;
	}

	const stored = await getPendingAutofillMap();
	stored[String(tabId)] = message.pendingAutofill;
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
	sendResponse({
		ok: true,
		payload: {
			pendingAutofill: stored[String(tabId)] || null,
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
	delete stored[String(tabId)];
	await chrome.storage.session.set({
		[PENDING_AUTOFILL_KEY]: stored,
	});

	sendResponse({ ok: true });
}

// Phishing koruması - domain doğrulama
async function validateCredentialDomain(message, sender, sendResponse) {
	const response = await requestVaultTab("VM_VALIDATE_CREDENTIAL_DOMAIN_REQUEST", {
		itemId: message.itemId,
		pageUrl: message.expectedUrl,
		sourceTabId: sender.tab?.id ?? null,
	});

	sendResponse(response);
}

// TOTP code isteme
async function getTotpCode(message, sender, sendResponse) {
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