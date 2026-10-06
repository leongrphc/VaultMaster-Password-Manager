const BRIDGE_LOOKUP_REQUEST = "VM_LOOKUP_PASSWORD_REQUEST";
const BRIDGE_LOOKUP_RESPONSE = "VM_LOOKUP_PASSWORD_REQUEST_RESPONSE";
const BRIDGE_SECRET_REQUEST = "VM_GET_PASSWORD_REQUEST";
const BRIDGE_SECRET_RESPONSE = "VM_GET_PASSWORD_REQUEST_RESPONSE";
const BRIDGE_LIST_REQUEST = "VM_LIST_LOGIN_SUGGESTIONS_REQUEST";
const BRIDGE_LIST_RESPONSE = "VM_LIST_LOGIN_SUGGESTIONS_REQUEST_RESPONSE";
const BRIDGE_CREDENTIAL_REQUEST = "VM_GET_LOGIN_CREDENTIAL_REQUEST";
const BRIDGE_CREDENTIAL_RESPONSE = "VM_GET_LOGIN_CREDENTIAL_REQUEST_RESPONSE";
const BRIDGE_VAULT_STATUS_REQUEST = "VM_GET_VAULT_STATUS_REQUEST";
const BRIDGE_VAULT_STATUS_RESPONSE = "VM_GET_VAULT_STATUS_RESPONSE";
const VAULTMASTER_ORIGINS = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
const BRIDGE_REQUEST_TYPES = new Set([
	BRIDGE_LOOKUP_REQUEST,
	BRIDGE_SECRET_REQUEST,
	BRIDGE_LIST_REQUEST,
	BRIDGE_CREDENTIAL_REQUEST,
	BRIDGE_VAULT_STATUS_REQUEST,
	"VM_VALIDATE_CREDENTIAL_DOMAIN_REQUEST",
	"VM_GET_TOTP_CODE_REQUEST",
	"VM_PASSKEY_BRIDGE_REQUEST",
	"VM_LIST_CREDIT_CARDS_REQUEST",
	"VM_GET_CREDIT_CARD_REQUEST",
	"VM_LIST_IDENTITIES_REQUEST",
	"VM_GET_IDENTITY_REQUEST",
	"VM_SAVE_LOGIN_REQUEST",
]);

let evaluationTimer = null;
let prewarmTimer = null;
let activeField = null;
let activePanel = null;
let activeLauncher = null;
let pendingSavePromptId = null;
let pageAutofillState = {
	status: "initializing",
	suggestions: [],
	updatedAt: 0,
};
const dismissedPanelKeys = new Set();
const PENDING_AUTOFILL_TTL_MS = 20000;
const AUTOFILL_SUPPRESSION_TTL_MS = 15000;
const NEVER_SAVE_HOSTS_KEY = "vaultmasterNeverSaveHosts";
const SUGGESTION_CACHE_TTL_MS = 5000;
const autofillSuppressions = new Map();
const suggestionCache = new Map();
const suggestionRequests = new Map();
const credentialRequests = new Map();
const PASSKEY_INJECTED_SOURCE = "vaultmaster-passkey-injected";
const PASSKEY_CONTENT_SOURCE = "vaultmaster-passkey-content";

installPasskeyBridge();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!isVaultMasterPage()) {
		return false;
	}

	if (BRIDGE_REQUEST_TYPES.has(message?.type)) {
		const { type, requestId, ...payload } = message;
		requestVaultBridge(type, payload, requestId)
			.then((bridgePayload) => sendResponse({ ok: true, payload: bridgePayload }))
			.catch((error) =>
				sendResponse({
					ok: false,
					payload: {
						status: "bridge_error",
						error: error instanceof Error ? error.message : "Unknown error",
					},
				})
			);
		return true;
	}

	if (message?.type === "LOOKUP_PASSWORD_SUGGESTION") {
		requestVaultBridge(BRIDGE_LOOKUP_REQUEST, {
			identifier: message.identifier,
			pageUrl: message.pageUrl,
			sourceTabId: message.sourceTabId,
		})
			.then((payload) => sendResponse({ ok: true, payload }))
			.catch((error) =>
				sendResponse({
					ok: false,
					payload: {
						status: "bridge_error",
						error: error instanceof Error ? error.message : "Unknown error",
					},
				})
			);
		return true;
	}

	if (message?.type === "GET_PASSWORD_FOR_FILL") {
		requestVaultBridge(BRIDGE_SECRET_REQUEST, {
			itemId: message.itemId,
			identifier: message.identifier,
			pageUrl: message.pageUrl,
			sourceTabId: message.sourceTabId,
		})
			.then((payload) => sendResponse({ ok: true, payload }))
			.catch((error) =>
				sendResponse({
					ok: false,
					payload: {
						status: "bridge_error",
						error: error instanceof Error ? error.message : "Unknown error",
					},
				})
			);
		return true;
	}

	if (message?.type === "LIST_LOGIN_SUGGESTIONS") {
		requestVaultBridge(BRIDGE_LIST_REQUEST, {
			identifier: message.identifier,
			pageUrl: message.pageUrl,
			sourceTabId: message.sourceTabId,
		})
			.then((payload) => sendResponse({ ok: true, payload }))
			.catch((error) =>
				sendResponse({
					ok: false,
					payload: {
						status: "bridge_error",
						error: error instanceof Error ? error.message : "Unknown error",
					},
				})
			);
		return true;
	}

	if (message?.type === "GET_LOGIN_CREDENTIAL") {
		requestVaultBridge(BRIDGE_CREDENTIAL_REQUEST, {
			itemId: message.itemId,
			pageUrl: message.pageUrl,
			sourceTabId: message.sourceTabId,
		})
			.then((payload) => sendResponse({ ok: true, payload }))
			.catch((error) =>
				sendResponse({
					ok: false,
					payload: {
						status: "bridge_error",
						error: error instanceof Error ? error.message : "Unknown error",
					},
				})
			);
		return true;
	}

	if (message?.type === "GET_VAULT_STATUS") {
		requestVaultBridge(BRIDGE_VAULT_STATUS_REQUEST, {})
			.then((payload) => sendResponse({ ok: true, payload }))
			.catch((error) =>
				sendResponse({
					ok: false,
					payload: {
						status: "bridge_error",
						error: error instanceof Error ? error.message : "Unknown error",
					},
				})
			);
		return true;
	}

	return false;
});

// Klavye kısayolu dinleyicisi (Ctrl+Shift+V ile tetiklenir)
if (!isVaultMasterPage()) {
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (sender.id !== chrome.runtime.id || sender.tab) return false;
		if (message?.type === "GET_PAGE_AUTOFILL_STATE") {
			void getPageAutofillState(message, sendResponse).catch(() => sendResponse({ ok: false }));
			return true;
		}

		if (message?.type === "FILL_LOGIN_CREDENTIAL") {
			void fillCredentialFromMessage(message, sendResponse).catch(() => sendResponse({ ok: false, message: "Doldurma tamamlanamadı." }));
			return true;
		}

		if (message?.type === "TRIGGER_AUTOFILL") {
			activeField = getBestAnchorInput();
			if (activeField) {
				activeField.focus();
				void evaluateAutofillOpportunity();
			}
			sendResponse({ ok: true });
			return true;
		}
		return false;
	});

	initializeAutofillAssistant();
}

function installPasskeyBridge() {
	if (isVaultMasterPage()) {
		return;
	}

	const script = document.createElement("script");
	script.src = chrome.runtime.getURL("passkey-injected.js");
	script.async = false;
	script.onload = () => script.remove();
	(document.documentElement || document.head).appendChild(script);

	window.addEventListener("message", (event) => {
		if (event.source !== window || event.origin !== window.location.origin) {
			return;
		}

		const data = event.data;
		if (data?.source !== PASSKEY_INJECTED_SOURCE || data.type !== "VM_PASSKEY_INTERCEPTED") {
			return;
		}

		void handlePasskeyIntercept(data);
	}, true);
}

async function handlePasskeyIntercept(data) {
	const operation = data.operation;
	const payload = data.payload || {};
	if (operation !== "create" && operation !== "get") {
		return;
	}

	const response = await sendRuntimeMessage({
		type: "PASSKEY_INTERCEPTED",
		operation,
		requestId: data.requestId,
		pageUrl: window.location.href,
		origin: window.location.origin,
		rpId: payload.rpId || "",
		rpName: payload.rpName || "",
		userName: payload.userName || "",
		userDisplayName: payload.userDisplayName || "",
		allowCredentialIds: Array.isArray(payload.allowCredentialIds) ? payload.allowCredentialIds : [],
	}).catch(() => null);

	showPasskeyConsentNotice(operation, response?.payload);

	window.postMessage(
		{
			source: PASSKEY_CONTENT_SOURCE,
			type: "VM_PASSKEY_NOTICE",
			requestId: data.requestId,
			payload: response?.payload || { status: "bridge_unavailable" },
		},
		window.location.origin
	);
}

function showPasskeyConsentNotice(operation, payload) {
	removePanel();
	const panel = document.createElement("div");
	panel.id = "vaultmaster-passkey-notice";
	panel.style.cssText = [
		"position:fixed",
		"right:20px",
		"bottom:20px",
		"z-index:2147483647",
		"width:min(360px, calc(100vw - 24px))",
		"background:linear-gradient(180deg, rgba(11,17,31,0.98) 0%, rgba(7,11,22,0.98) 100%)",
		"border:1px solid rgba(0,255,178,0.18)",
		"border-radius:18px",
		"box-shadow:0 20px 56px rgba(0,0,0,0.32)",
		"color:#eef2ff",
		"font:13px/1.45 'Segoe UI', Arial, sans-serif",
		"overflow:hidden",
	].join(";");

	const action = operation === "create" ? "passkey oluşturma" : "passkey ile giriş";
	const status = payload?.status || "notice_only";
	const message = status === "rp_mismatch"
		? "RP ID bu sayfanın domainiyle eşleşmedi; VaultMaster işlem yapmadı."
		: payload?.message || "VaultMaster isteği kaydetti ve kullanıcı onayı gerektirdi. İmzalama veya credential oluşturma bu aşamada uygulanmadı; tarayıcının yerel WebAuthn akışı devam eder.";
	const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
	const candidateHtml = candidates.length
		? `<div style="display:grid;gap:8px;">${candidates.map((candidate) => `
			<button data-action="select-passkey" data-item-id="${escapeHtml(candidate.itemId)}" style="border:1px solid rgba(0,255,178,0.20);background:rgba(18,26,49,0.9);border-radius:12px;padding:10px;text-align:left;color:#eef2ff;cursor:pointer;">
				<div style="font-weight:700;">${escapeHtml(candidate.title || "Stored passkey")}</div>
				<div style="color:#90a0c3;font-size:12px;">${escapeHtml(candidate.username || candidate.rpId || "Passkey candidate")}</div>
			</button>
		`).join("")}</div>`
		: "";

	panel.innerHTML = `
		<div style="padding:14px;border-bottom:1px solid rgba(144,160,195,0.12);">
			<div style="font-weight:700;margin-bottom:4px;">VaultMaster Passkey Bridge</div>
			<div style="color:#90a0c3;font-size:12px;">${escapeHtml(formatHostname(window.location.href))} üzerinde ${escapeHtml(action)} isteği algılandı.</div>
		</div>
		<div style="padding:12px;display:grid;gap:10px;">
			<div style="color:#dbe7ff;font-size:12px;line-height:1.5;">${escapeHtml(message)}</div>
			${candidateHtml}
			<button data-action="dismiss" style="border:0;border-radius:12px;background:#00ffb2;color:#04111d;padding:10px;font-weight:700;cursor:pointer;">Tamam</button>
		</div>
	`;
	panel.querySelector("[data-action='dismiss']")?.addEventListener("click", () => panel.remove());
	panel.querySelectorAll("[data-action='select-passkey']").forEach((node) => {
		node.addEventListener("click", () => {
			const itemId = node.getAttribute("data-item-id");
			showPasskeySelectionNotice(panel, itemId);
		});
	});
	document.body.appendChild(panel);
	window.setTimeout(() => panel.remove(), candidates.length ? 15000 : 7000);
}

function showPasskeySelectionNotice(panel, itemId) {
	const body = panel.querySelector("div:nth-of-type(2)");
	if (!(body instanceof HTMLElement)) {
		return;
	}

	body.innerHTML = `
		<div style="padding:12px;border-radius:14px;background:rgba(0,255,178,0.10);border:1px solid rgba(0,255,178,0.20);color:#b7ffe8;line-height:1.5;">
			<div style="font-weight:700;margin-bottom:6px;">Passkey seçimi kaydedildi</div>
			<div style="font-size:12px;">VaultMaster bu aşamada ${escapeHtml(itemId || "seçili")} kaydını sayfaya imzalı assertion olarak döndürmez. Yerel WebAuthn penceresini kullanın veya imzalama desteği eklendiğinde tekrar deneyin.</div>
		</div>
		<button data-action="dismiss" style="border:0;border-radius:12px;background:#00ffb2;color:#04111d;padding:10px;font-weight:700;cursor:pointer;">Tamam</button>
	`;
	body.querySelector("[data-action='dismiss']")?.addEventListener("click", () => panel.remove());
}

function initializeAutofillAssistant() {
	document.addEventListener("focusin", onFieldActivity, true);
	document.addEventListener("input", onFieldActivity, true);
	document.addEventListener("change", onFieldActivity, true);
	document.addEventListener("click", onFieldActivity, true);
	document.addEventListener("keydown", onKeyDown, true);
	document.addEventListener("submit", onFormSubmitCapture, true);
	window.addEventListener("resize", updatePanelPosition, true);
	window.addEventListener("scroll", updatePanelPosition, true);

	const observer = new MutationObserver(() => scheduleEvaluation());
	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
	});

	scheduleEvaluation();
	schedulePrewarm(120);
	// Bounded retries cover captures still being encrypted during a fast navigation.
	let saveChecks = 0;
	const checkSave = () => {
		void refreshPendingSavePrompt();
		if (++saveChecks < 10 && !pendingSavePromptId) window.setTimeout(checkSave, 500);
	};
	checkSave();
}

function onFieldActivity(event) {
	const target = event.composedPath()[0];
	if (!(target instanceof HTMLInputElement)) {
		return;
	}

	const type = normalizeInputType(target);
	if (!["text", "email", "tel", "password"].includes(type)) {
		return;
	}

	activeField = target;
	scheduleEvaluation();
	schedulePrewarm(80);
}

function onKeyDown(event) {
	if (event.key === "Escape") {
		dismissActivePanel();
	}
}

function onFormSubmitCapture(event) {
	const form = event.target;
	if (!(form instanceof HTMLFormElement)) return;
	const inputs = Array.from(form.querySelectorAll("input"));
	const passwordInput = inputs.find(input => normalizeInputType(input) === "password");
	const usernameInput = inputs.find(input => isLikelyIdentifierInput(input)) ||
		(passwordInput ? inputs.slice(0, inputs.indexOf(passwordInput)).reverse().find(input => ["text", "email", "tel"].includes(normalizeInputType(input))) : null);
	if (!usernameInput?.value.trim() || !passwordInput?.value) return;
	// Snapshot and send before any await or timer: a native submit can unload this document immediately.
	const credential = {
		title: document.title || formatHostname(window.location.href), url: window.location.origin,
		username: usernameInput.value.trim(), password: passwordInput.value,
	};
	void sendRuntimeMessage({ type: "CAPTURE_LOGIN", credential }).then(response => {
		if (response?.payload?.status === "captured") {
			pendingSavePromptId = null;
			return refreshPendingSavePrompt();
		}
	}).catch(() => null);
}

async function refreshPendingSavePrompt() {
	if (pendingSavePromptId) return;
	const response = await sendRuntimeMessage({ type: "GET_PENDING_LOGIN_SAVE" }).catch(() => null);
	const draft = response?.payload?.draft;
	if (!draft || pendingSavePromptId || draft.expiresAt <= Date.now()) return;
	pendingSavePromptId = draft.id;
	showSavePrompt(draft);
}

function scheduleEvaluation() {
	window.clearTimeout(evaluationTimer);
	evaluationTimer = window.setTimeout(() => {
		void evaluateAutofillOpportunity();
	}, 220);
}

function schedulePrewarm(delay = 220) {
	window.clearTimeout(prewarmTimer);
	prewarmTimer = window.setTimeout(() => {
		void prewarmPageAutofillState();
	}, delay);
}

function getSelectionContext() {
	const detector = window.VaultMasterFormDetector;
	return detector?.detectCardFormContext(activeField) || detector?.detectIdentityFormContext(activeField) || getPageLoginContext();
}

async function getPageAutofillState(_message, sendResponse) {
	const context = getSelectionContext();
	const kind = context?.type || 'login';
	if (kind !== 'login') {
		const payload = kind === 'credit_card' ? await fetchCreditCards() : await fetchIdentities();
		sendResponse({ ok: true, payload: { kind, formToken: getFormToken(context),
			suggestions: payload?.cards || payload?.identities || [] } }); return;
	}
	if (Date.now() - pageAutofillState.updatedAt > SUGGESTION_CACHE_TTL_MS) await prewarmPageAutofillState();
	sendResponse({ ok: true, payload: { ...pageAutofillState, kind,
		formToken: context ? getFormToken(context) : null } });
}

async function prewarmPageAutofillState() {
	const context = getPageLoginContext();
	if (!context) {
		pageAutofillState = {
			status: "no_form",
			suggestions: [],
			updatedAt: Date.now(),
		};
		return;
	}

	const identifier = context.usernameInput?.value.trim() || "";
	if (
		pageAutofillState.identifier === identifier &&
		Date.now() - pageAutofillState.updatedAt <= SUGGESTION_CACHE_TTL_MS
	) {
		return;
	}

	const payload = await fetchSuggestions(identifier);

	pageAutofillState = {
		status: payload?.suggestions?.length ? "ready" : "no_match",
		suggestions: payload?.suggestions || [],
		isUsingOfflineData: Boolean(payload?.isUsingOfflineData),
		identifier,
		updatedAt: Date.now(),
	};
}

async function evaluateAutofillOpportunity() {
	if (activePanel?.locked) {
		return;
	}

	const detector = window.VaultMasterFormDetector;
	const cardContext = detector?.detectCardFormContext(activeField);
	if (cardContext) {
		const cardsPayload = await fetchCreditCards();
		if (cardsPayload?.cards?.length) {
			showStructuredSuggestionPanel({
				context: cardContext,
				items: cardsPayload.cards,
				title: "VaultMaster Cards",
				subtitle: "Ödeme formu algılandı",
			});
			return;
		}
	}

	const identityContext = detector?.detectIdentityFormContext(activeField);
	if (identityContext) {
		const identitiesPayload = await fetchIdentities();
		if (identitiesPayload?.identities?.length) {
			showStructuredSuggestionPanel({
				context: identityContext,
				items: identitiesPayload.identities,
				title: "VaultMaster Identities",
				subtitle: "Kimlik/iletişim formu algılandı",
			});
			return;
		}
	}

	const context = getLoginFormContext(activeField) || getFallbackLoginFormContext();
	if (isAutofillSuppressed(context)) {
		removePanel();
		removeLauncher();
		return;
	}

	if (context && (await tryApplyPendingAutofill(context))) {
		removePanel();
		removeLauncher();
		return;
	}

	if (await getPendingAutofill()) {
		removePanel();
		return;
	}

	const suggestionsPayload = await fetchSuggestions(context?.usernameInput?.value.trim() || "");
	if (!suggestionsPayload?.suggestions?.length) {
		removePanel();
		return;
	}

	pageAutofillState = {
		status: "ready",
		suggestions: suggestionsPayload.suggestions,
		isUsingOfflineData: Boolean(suggestionsPayload.isUsingOfflineData),
		identifier: context?.usernameInput?.value.trim() || "",
		updatedAt: Date.now(),
	};
	ensureLauncher(suggestionsPayload.suggestions);

	if (!context) {
		removePanel();
		return;
	}

	const typedIdentifier = context.usernameInput?.value.trim() || "";
	const panelKey = buildPanelKey(context, typedIdentifier);
	if (dismissedPanelKeys.has(panelKey)) {
		removePanel();
		return;
	}

	showSuggestionPanel({
		context,
		panelKey,
		typedIdentifier,
		suggestions: suggestionsPayload.suggestions,
		isUsingOfflineData: Boolean(suggestionsPayload.isUsingOfflineData),
	});
}

function showSuggestionPanel({ suggestions }) {
	// Page DOM is only a launcher. Account selection belongs to extension UI.
	ensureLauncher(suggestions);
}

const formTokens = new WeakMap();
function getContextInputs(context) {
	return Object.values(context).filter(value => value instanceof HTMLInputElement);
}

function getFormToken(context) {
	const inputs = getContextInputs(context);
	const anchor = context.passwordInput || context.usernameInput || inputs[0];
	let entry = formTokens.get(anchor);
	if (!entry || entry.inputs.length !== inputs.length || entry.inputs.some((input, index) => input !== inputs[index])) {
		entry = { token: generatePendingNonce(), inputs };
		formTokens.set(anchor, entry);
	}
	return entry.token;
}

async function fillCredentialFromMessage(message, sendResponse) {
	const context = getSelectionContext();
	if (!context) {
		sendResponse({ ok: false, message: "Giriş alanı bulunamadı." });
		return;
	}

	const itemId = message.itemId;
	if (!itemId) {
		sendResponse({ ok: false, message: "Kayıt seçilmedi." });
		return;
	}

	if (message.formToken !== getFormToken(context)) {
		sendResponse({ ok: false, message: 'Giriş formu değişti. Eklentiyi yeniden açın.' }); return;
	}
	if (context.type === 'credit_card' || context.type === 'identity') {
		const inputs = getContextInputs(context), roots = inputs.map(input => input.getRootNode());
		const card = context.type === 'credit_card';
		const response = await sendRuntimeMessage({ type: card ? 'GET_CREDIT_CARD' : 'GET_IDENTITY', itemId }).catch(() => null);
		const data = card ? response?.payload?.card : response?.payload?.identity;
		if (!response?.ok || !data || inputs.some((input, index) => !input.isConnected || input.getRootNode() !== roots[index])) {
			sendResponse({ ok: false, message: 'Hedef form değişti veya kasa kilitli.' }); return;
		}
		const values = card ? { cardNumberInput: data.cardNumber, cardholderNameInput: data.cardholderName,
			expMonthInput: data.expMonth, expYearInput: data.expYear, expiryInput: `${data.expMonth}/${String(data.expYear).slice(-2)}` }
			: { fullNameInput: data.fullName, emailInput: data.email, phoneInput: data.phone,
				organizationInput: data.organization, addressInput: data.address };
		for (const [key, value] of Object.entries(values)) {
			if (context[key]?.isConnected && value) setNativeValue(context[key], value);
		}
		sendResponse({ ok: true, message: 'Dolduruldu.' }); return;
	}
	const result = await fillCredentialIntoContext(itemId, context, { forceFill: message.forceFill === true });
	if (result.ok) {
		if (result.filledFields?.includes("password")) suppressAutofillForContext(context);
		removePanel();
		removeLauncher();
	}
	sendResponse(result);
}

async function fillCredentialIntoContext(itemId, context, options = {}) {
	const originalRoots = [context.usernameInput?.getRootNode(), context.passwordInput?.getRootNode()];
	const credentialResult = await requestCredential(itemId, { forceFill: options.forceFill });
	const credential = credentialResult?.credential;
	if (!credential) {
		return {
			ok: false,
			status: credentialResult?.status,
			message: credentialResult?.status === "domain_mismatch"
				? "Kayıt bu domain için doğrulanamadı."
				: "Kayıt alınamadı. Eklentiden kasanın kilidini açıp tekrar deneyin.",
		};
	}
	// Do not retarget a credential after asynchronous vault work or page events.
	const latestContext = context;
	if ([context.usernameInput, context.passwordInput].some((input, index) => input && (!input.isConnected || input.getRootNode() !== originalRoots[index]))) {
		return { ok: false, message: 'Giriş formu değişti.' };
	}
	const filledFields = [];

	if (latestContext.usernameInput && credential.username && (options.forceFill || !latestContext.usernameInput.value.trim())) {
		setNativeValue(latestContext.usernameInput, credential.username);
		filledFields.push("identifier");
	}

	if (latestContext.passwordInput?.isConnected && credential.password && (options.forceFill || !latestContext.passwordInput.value.trim())) {
		setNativeValue(latestContext.passwordInput, credential.password);
		latestContext.passwordInput.focus();
		filledFields.push("password");
	}

	if (!filledFields.length) {
		return { ok: false, message: "Alanlar dolu. Üzerine yazmak için uyarı panelindeki 'Yine de doldur' seçeneğini kullanın." };
	}

	if (filledFields.includes("identifier") && !filledFields.includes("password") && credential.password) {
		await rememberPendingAutofill(credential);
	} else {
		await clearPendingAutofill();
		suppressAutofillForContext(latestContext);
	}

	await sendRuntimeMessage({
		type: "TRACK_AUTOFILL_SELECTION",
		itemId,
		pageUrl: window.location.href,
	}).catch(() => null);

	return {
		ok: true,
		message: buildFilledNotice(credential.title, credential.hasTotp, filledFields),
		filledFields,
		hasTotp: credential.hasTotp,
	};
}

async function requestCredential(itemId, options = {}) {

	const requestKey = `${itemId}|${options.forceFill ? "force" : "strict"}`;
	if (credentialRequests.has(requestKey)) {
		return credentialRequests.get(requestKey);
	}

	const request = sendRuntimeMessage({
		type: "GET_LOGIN_CREDENTIAL",
		itemId,
		pageUrl: window.location.href,
		forceFill: Boolean(options.forceFill),
	})
		.catch(() => null)
		.then((response) => {
			const payload = response?.payload;
			const credential = payload?.credential;
			if (!response?.ok || payload?.status !== "ready" || !credential) {
				return { status: payload?.status || "error", credential: null };
			}

			return { status: "ready", credential };
		})
		.finally(() => {
			credentialRequests.delete(requestKey);
		});

	credentialRequests.set(requestKey, request);
	return request;
}

function updatePanelNotice(message, isError) {
	if (!activePanel?.element) {
		return;
	}

	const body = activePanel.element.querySelector("div:nth-of-type(2)");
	if (!(body instanceof HTMLElement)) {
		return;
	}

	body.innerHTML = `
    <div style="padding:12px;border-radius:14px;background:${isError ? "rgba(255,77,106,0.08)" : "rgba(0,255,178,0.08)"};border:1px solid ${isError ? "rgba(255,77,106,0.18)" : "rgba(0,255,178,0.18)"};color:${isError ? "#ff9aac" : "#b7ffe8"};">
      ${escapeHtml(message)}
    </div>
  `;
}

function showSavePrompt(credential) {
	removePanel();
	const panel = document.createElement("div");
	panel.id = "vaultmaster-inline-autofill";
	panel.style.cssText = [
		"position:fixed",
		"z-index:2147483647",
		"right:20px",
		"bottom:20px",
		"width:min(360px, calc(100vw - 24px))",
		"background:linear-gradient(180deg, rgba(11,17,31,0.98) 0%, rgba(7,11,22,0.98) 100%)",
		"border:1px solid rgba(0,255,178,0.18)",
		"border-radius:18px",
		"box-shadow:0 20px 56px rgba(0,0,0,0.32)",
		"color:#eef2ff",
		"font:13px/1.45 'Segoe UI', Arial, sans-serif",
		"overflow:hidden",
	].join(";");

	panel.innerHTML = `
		<div style="padding:14px;border-bottom:1px solid rgba(144,160,195,0.12);">
			<div style="font-weight:700;margin-bottom:4px;">VaultMaster'a kaydet?</div>
			<div style="color:#90a0c3;font-size:12px;">${escapeHtml(formatHostname(credential.url))} • ${escapeHtml(maskIdentifier(credential.username))}</div>
		</div>
		<div style="padding:12px;display:grid;gap:8px;">
			<div style="display:flex;gap:8px;">
					<button data-action="save" style="flex:1;border:0;border-radius:12px;background:#00ffb2;color:#04111d;padding:10px;font-weight:700;cursor:pointer;">Kaydet/Güncelle</button>
					<button data-action="dismiss" style="border:1px solid rgba(144,160,195,0.18);border-radius:12px;background:rgba(18,26,49,0.9);color:#90a0c3;padding:10px 12px;font-weight:700;cursor:pointer;">Geç</button>
				</div>
				<button data-action="never-save" style="border:0;background:transparent;color:#90a0c3;padding:4px 8px;font-size:12px;text-align:left;cursor:pointer;">Bu sitede bir daha sorma</button>
			</div>
	`;

	const dismissSave = async () => {
		await sendRuntimeMessage({ type: "DISMISS_LOGIN_SAVE", draftId: credential.id }).catch(() => null);
		removePanel();
	};
	panel.querySelector("[data-action='dismiss']")?.addEventListener("click", dismissSave);
	panel.querySelector("[data-action='never-save']")?.addEventListener("click", async () => {
		const hostname = normalizeHostname(credential.url);
		if (hostname) {
			await addNeverSaveHost(hostname);
		}
		await dismissSave();
	});
	panel.querySelector("[data-action='save']")?.addEventListener("click", async (event) => {
		if (!event.isTrusted) return;
		const button = event.currentTarget;
		button.disabled = true;
		const response = await sendRuntimeMessage({ type: "CONFIRM_LOGIN_SAVE", draftId: credential.id }).catch(() => null);
		const status = response?.payload?.status;
		if (response?.ok && (status === "created" || status === "updated")) {
			updatePanelNotice(status === "updated" ? "Kayıt güncellendi." : "Kayıt kasaya eklendi.", false);
			window.setTimeout(removePanel, 1200);
			return;
		}
		button.disabled = false;
		let error = panel.querySelector("[data-save-error]");
		if (!error) {
			error = document.createElement("div");
			error.dataset.saveError = "true";
			error.style.cssText = "padding:12px;color:#ff9aac";
			panel.appendChild(error);
		}
		error.textContent = "Kaydetme başarısız. Eklentide kasanın açık olduğunu ve bağlantınızı kontrol edip tekrar deneyin.";
	});

	document.body.appendChild(panel);
	activePanel = { element: panel, anchorInput: null, panelKey: `save|${window.location.hostname}`, fixed: true, locked: true };
	window.setTimeout(() => {
		if (activePanel?.element === panel) removePanel();
	}, Math.max(0, credential.expiresAt - Date.now()));
}

function showStructuredSuggestionPanel({ items }) {
	ensureLauncher(items);
}

function updatePanelPosition() {
	if (activePanel?.fixed) {
		return;
	}

	if (activePanel?.locked && activePanel.anchorInput && activePanel.anchorInput.isConnected) {
		const rect = activePanel.anchorInput.getBoundingClientRect();
		const panel = activePanel.element;
		const top = Math.min(rect.bottom + 10, window.innerHeight - panel.offsetHeight - 12);
		const left = Math.min(Math.max(12, rect.left), window.innerWidth - panel.offsetWidth - 12);
		panel.style.top = `${Math.max(12, top)}px`;
		panel.style.left = `${left}px`;
		return;
	}

	if (!activePanel?.anchorInput || !activePanel.anchorInput.isConnected) {
		removePanel();
		return;
	}

	const rect = activePanel.anchorInput.getBoundingClientRect();
	const panel = activePanel.element;
	const top = Math.min(rect.bottom + 10, window.innerHeight - panel.offsetHeight - 12);
	const left = Math.min(
		Math.max(12, rect.left),
		window.innerWidth - panel.offsetWidth - 12
	);

	panel.style.top = `${Math.max(12, top)}px`;
	panel.style.left = `${left}px`;
}

function dismissActivePanel() {
	if (!activePanel) {
		return;
	}

	dismissedPanelKeys.add(activePanel.panelKey);
	removePanel();
}

function removePanel() {
	activePanel?.element?.remove();
	activePanel = null;
}

function ensureLauncher(suggestions) {
	const count = suggestions.length;
	if (!activeLauncher) {
		const launcher = document.createElement("button");
		launcher.type = "button";
		launcher.id = "vaultmaster-autofill-launcher";
		launcher.style.cssText = [
			"position:fixed",
			"right:20px",
			"bottom:20px",
			"z-index:2147483646",
			"display:inline-flex",
			"align-items:center",
			"gap:10px",
			"padding:12px 16px",
			"border:1px solid rgba(0,255,178,0.22)",
			"border-radius:999px",
			"background:linear-gradient(180deg, rgba(9,18,31,0.96) 0%, rgba(6,12,23,0.96) 100%)",
			"box-shadow:0 20px 44px rgba(0,0,0,0.28)",
			"backdrop-filter:blur(16px)",
			"color:#eef2ff",
			"font:600 13px/1 'Segoe UI', Arial, sans-serif",
			"cursor:pointer",
		].join(";");

		launcher.addEventListener("click", async (event) => {
			if (!event.isTrusted) return;
			await sendRuntimeMessage({ type: 'OPEN_AUTOFILL_POPUP' }).catch(() => null);
		});

		document.body.appendChild(launcher);
		activeLauncher = launcher;
	}

	updateLauncherContent(count);
}

function updateLauncherContent(count) {
	if (!activeLauncher) {
		return;
	}

	activeLauncher.innerHTML = `
    <span style="display:inline-flex;width:10px;height:10px;border-radius:999px;background:#00ffb2;box-shadow:0 0 12px rgba(0,255,178,0.45);"></span>
    <span>VaultMaster ile doldur</span>
    <span style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 7px;border-radius:999px;background:rgba(0,255,178,0.14);color:#8ef7d4;font-size:12px;">${count}</span>
  `;
}

function showLauncherFeedback(message) {
	if (!activeLauncher) {
		return;
	}

	activeLauncher.innerHTML = `
    <span style="display:inline-flex;width:10px;height:10px;border-radius:999px;background:#00ffb2;box-shadow:0 0 12px rgba(0,255,178,0.45);"></span>
    <span>${escapeHtml(message)}</span>
  `;

	window.setTimeout(async () => {
		const payload = await fetchSuggestions((getFallbackLoginFormContext()?.usernameInput?.value || "").trim());
		if (payload?.suggestions?.length) {
			updateLauncherContent(payload.suggestions.length);
		}
	}, 1200);
}

function removeLauncher() {
	activeLauncher?.remove();
	activeLauncher = null;
}

function getLoginFormContext(currentInput) {
	if (!(currentInput instanceof HTMLInputElement)) {
		return null;
	}

	const visibleInputs = getScopedVisibleInputs(currentInput);
	const passwordInput =
		visibleInputs.find((input) => normalizeInputType(input) === "password") || null;

	const usernameInput =
		findIdentifierField(visibleInputs, currentInput) ||
		(passwordInput ? findPreviousTextInput(passwordInput, visibleInputs) : null) ||
		(isLikelyIdentifierInput(currentInput) ? currentInput : null) ||
		null;

	if (!passwordInput && !usernameInput) {
		return null;
	}

	if (!passwordInput && usernameInput && !isLikelyIdentifierInput(usernameInput)) {
		return null;
	}

	const anchorInput =
		currentInput instanceof HTMLInputElement && visibleInputs.includes(currentInput)
			? currentInput
			: usernameInput || passwordInput;

	return {
		usernameInput,
		passwordInput,
		anchorInput,
	};
}

function getFallbackLoginFormContext() {
	const anchorInput = getBestAnchorInput();
	if (!anchorInput) {
		return null;
	}

	return getLoginFormContext(anchorInput);
}

function getPageLoginContext() {
	return getLoginFormContext(activeField) || getFallbackLoginFormContext();
}

function collectOpenInputs(root) {
	const inputs = Array.from(root.querySelectorAll('input'));
	for (const element of root.querySelectorAll('*')) {
		if (element.shadowRoot?.mode === 'open') inputs.push(...collectOpenInputs(element.shadowRoot));
	}
	return inputs;
}

function getScopedVisibleInputs(currentInput) {
	const scopeRoot =
		currentInput instanceof HTMLElement ? currentInput.closest("form") : null;

	const inputList = scopeRoot
		? Array.from(scopeRoot.querySelectorAll("input"))
		: collectOpenInputs(currentInput?.getRootNode() || document);

	return inputList.filter((input) => {
		if (!(input instanceof HTMLInputElement)) {
			return false;
		}

		const type = normalizeInputType(input);
		if (input.disabled || type === "hidden") {
			return false;
		}

		const rect = input.getBoundingClientRect();
		const styles = window.getComputedStyle(input);
		return (
			rect.width > 0 &&
			rect.height > 0 &&
			styles.display !== "none" &&
			styles.visibility !== "hidden"
		);
	});
}

function getBestAnchorInput() {
	const inputs = getScopedVisibleInputs(null);
	const identifierInput = inputs.find((input) => isLikelyIdentifierInput(input));
	if (identifierInput) {
		return identifierInput;
	}

	return inputs.find((input) => normalizeInputType(input) === "password") || null;
}

function findIdentifierField(inputs, currentInput) {
	const identifierHints = [
		"username",
		"email",
		"login",
		"user",
		"identifier",
		"account",
	];

	const candidates = inputs.filter((input) =>
		["text", "email", "tel"].includes(normalizeInputType(input))
	);

	if (
		currentInput instanceof HTMLInputElement &&
		candidates.includes(currentInput) &&
		isLikelyIdentifierInput(currentInput)
	) {
		return currentInput;
	}

	return (
		candidates.find((input) => {
			return (
				isLikelyIdentifierInput(input) ||
				identifierHints.some((hint) => getInputHintText(input).includes(hint))
			);
		}) || candidates[0] || null
	);
}

function findPreviousTextInput(passwordInput, inputs) {
	const index = inputs.indexOf(passwordInput);
	if (index <= 0) {
		return null;
	}

	return [...inputs]
		.slice(0, index)
		.reverse()
		.find((input) => ["text", "email", "tel"].includes(normalizeInputType(input)));
}

function buildPanelKey(context, identifier) {
	return [
		window.location.hostname,
		normalizeIdentifier(identifier),
		context.usernameInput?.name || context.usernameInput?.id || "identifier",
		context.passwordInput?.name || context.passwordInput?.id || "password",
	].join("|");
}

function normalizeInputType(input) {
	return (input.getAttribute("type") || "text").toLowerCase();
}

function normalizeIdentifier(value) {
	return String(value || "").trim().toLowerCase();
}

function generatePendingNonce() {
	const values = new Uint32Array(4);
	crypto.getRandomValues(values);
	return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");
}

async function rememberPendingAutofill(credential) {
	const nonce = generatePendingNonce();
	const expiresAt = Date.now() + PENDING_AUTOFILL_TTL_MS;

	const pendingAutofill = {
		itemId: credential.itemId,
		nonce,
		title: credential.title,
		username: credential.username,
		hasTotp: credential.hasTotp,
		hostname: window.location.hostname,
		origin: window.location.origin,
		expiresAt,
	};

	await sendRuntimeMessage({
		type: "SET_PENDING_AUTOFILL",
		pendingAutofill,
	}).catch(() => null);
}

async function getPendingAutofill() {
	const response = await sendRuntimeMessage({
		type: "GET_PENDING_AUTOFILL",
	}).catch(() => null);

	const pendingAutofill = response?.payload?.pendingAutofill;
	if (!pendingAutofill) {
		return null;
	}

	if (
		pendingAutofill.origin !== window.location.origin ||
		pendingAutofill.expiresAt <= Date.now()
	) {
		await clearPendingAutofill();
		return null;
	}

	return pendingAutofill;
}

async function clearPendingAutofill() {
	await sendRuntimeMessage({
		type: "CLEAR_PENDING_AUTOFILL",
	}).catch(() => null);
}

let applyingPendingAutofill = false;

async function tryApplyPendingAutofill(context) {
	if (applyingPendingAutofill || !context?.passwordInput) return false;
	applyingPendingAutofill = true;
	try {
		const pending = await getPendingAutofill();
		if (!pending) return false;
		if (context.passwordInput.value.trim()) {
			await clearPendingAutofill();
			return false;
		}
		// Retrieve again after navigation so the vault's current lock and domain checks apply.
		const result = await requestCredential(pending.itemId);
		if (!result.credential) {
			await clearPendingAutofill();
			return false;
		}
		if (!context.passwordInput.isConnected || context.passwordInput.value.trim()) return false;
		setNativeValue(context.passwordInput, result.credential.password);
		context.passwordInput.focus();
		await clearPendingAutofill();
		suppressAutofillForContext(context);
		updatePanelNotice(buildFilledNotice(pending.title, pending.hasTotp, ["password"]), false);
		return true;
	} finally {
		applyingPendingAutofill = false;
	}
}

function suppressAutofillForContext(context) {
	const suppressionKey = buildSuppressionKey(context);
	if (!suppressionKey) {
		return;
	}

	autofillSuppressions.set(suppressionKey, Date.now() + AUTOFILL_SUPPRESSION_TTL_MS);
}

function isAutofillSuppressed(context) {
	const suppressionKey = buildSuppressionKey(context);
	if (!suppressionKey) {
		return false;
	}

	const expiresAt = autofillSuppressions.get(suppressionKey);
	if (!expiresAt) {
		return false;
	}

	if (expiresAt <= Date.now()) {
		autofillSuppressions.delete(suppressionKey);
		return false;
	}

	return true;
}

function buildSuppressionKey(context) {
	if (!context?.passwordInput && !context?.usernameInput) {
		return "";
	}

	return [
		window.location.hostname,
		context?.usernameInput?.name || context?.usernameInput?.id || "identifier",
		context?.passwordInput?.name || context?.passwordInput?.id || "password",
	].join("|");
}

async function fetchCreditCards() {
	const response = await sendRuntimeMessage({ type: "LIST_CREDIT_CARDS" }).catch(() => null);
	const payload = response?.payload;
	if (!response?.ok || payload?.status !== "ready" || !payload.cards?.length) return null;
	return payload;
}

async function fetchIdentities() {
	const response = await sendRuntimeMessage({ type: "LIST_IDENTITIES" }).catch(() => null);
	const payload = response?.payload;
	if (!response?.ok || payload?.status !== "ready" || !payload.identities?.length) return null;
	return payload;
}

async function fetchSuggestions(identifier, options = {}) {
	const normalizedIdentifier = normalizeIdentifier(identifier);
	const cacheKey = `${window.location.origin}${window.location.pathname}|${normalizedIdentifier}`;
	const cached = suggestionCache.get(cacheKey);
	if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
		return cached.payload;
	}

	if (!options.forceRefresh && suggestionRequests.has(cacheKey)) {
		return suggestionRequests.get(cacheKey);
	}

	const request = sendRuntimeMessage({
		type: "LIST_LOGIN_SUGGESTIONS",
		identifier: normalizedIdentifier,
		pageUrl: window.location.href,
	})
		.catch(() => null)
		.then((response) => {
			const payload = response?.payload;
			if (!response?.ok || !payload || payload.status !== "ready" || !payload.suggestions?.length) {
				return null;
			}

			suggestionCache.set(cacheKey, {
				payload,
				expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS,
			});
			return payload;
		})
		.finally(() => {
			suggestionRequests.delete(cacheKey);
		});

	suggestionRequests.set(cacheKey, request);
	return request;
}

function isLikelyIdentifierInput(input) {
	const type = normalizeInputType(input);
	if (type === "email") {
		return true;
	}

	if (!["text", "email", "tel"].includes(type)) {
		return false;
	}

	const hintText = getInputHintText(input);
	return ["username", "email", "login", "user", "identifier", "account", "phone", "telefon"].some(
		(hint) => hintText.includes(hint)
	);
}

function getInputHintText(input) {
	return [
		input.name,
		input.id,
		input.placeholder,
		input.autocomplete,
		input.getAttribute("aria-label") || "",
	]
		.join(" ")
		.toLowerCase();
}

function getPanelFootnote(context) {
	if (context.usernameInput && context.passwordInput) {
		return "Kullanıcı adı/mail ve şifre birlikte doldurulur";
	}

	if (context.usernameInput) {
		return "Bu adımda kullanıcı adı/mail doldurulur";
	}

	return "Bu adımda şifre doldurulur";
}

function buildFilledNotice(title, hasTotp, filledFields) {
	if (filledFields.includes("identifier") && filledFields.includes("password")) {
		return `${title} hesabı dolduruldu${hasTotp ? " • TOTP mevcut" : ""}.`;
	}

	if (filledFields.includes("identifier")) {
		return `${title} için kullanıcı adı/mail dolduruldu. Şifre alanı görünür görünmez otomatik tamamlanacak.`;
	}

	if (filledFields.includes("password")) {
		return `${title} için şifre dolduruldu${hasTotp ? " • TOTP mevcut" : ""}.`;
	}

	return `${title} hesabı seçildi.`;
}

function isAllowedVaultMasterOrigin(origin) {
	return VAULTMASTER_ORIGINS.has(origin);
}

function isVaultMasterPage() {
	return isAllowedVaultMasterOrigin(window.location.origin);
}

function requestVaultBridge(type, payload, existingRequestId) {
	return new Promise((resolve, reject) => {
		const requestId = existingRequestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const timeout = window.setTimeout(() => {
			window.removeEventListener("message", onMessage);
			reject(new Error("VaultMaster bridge timed out."));
		}, 4000);

		function onMessage(event) {
			if (event.source !== window || !isAllowedVaultMasterOrigin(event.origin)) {
				return;
			}

			const data = event.data;
			if (
				data?.source !== "vaultmaster-web" ||
				!([`${type}_RESPONSE`, type.replace(/_REQUEST$/, "_RESPONSE")].includes(data.type)) ||
				data.requestId !== requestId
			) {
				return;
			}

			window.clearTimeout(timeout);
			window.removeEventListener("message", onMessage);
			resolve(data.payload);
		}

		window.addEventListener("message", onMessage);
		window.postMessage(
			{
				source: "vaultmaster-extension",
				type,
				requestId,
				...payload,
			},
			window.location.origin
		);
	});
}

function sendRuntimeMessage(payload) {
	return new Promise((resolve, reject) => {
		chrome.runtime.sendMessage(payload, (response) => {
			const runtimeError = chrome.runtime.lastError;
			if (runtimeError) {
				reject(new Error(runtimeError.message));
				return;
			}

			resolve(response);
		});
	});
}

function setNativeValue(input, value) {
	const prototype = Object.getPrototypeOf(input);
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
	descriptor?.set?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
	input.dispatchEvent(new Event("change", { bubbles: true }));
}

function badgeHtml(label, color, background) {
	return `<span style="display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;background:${background};color:${color};font-size:11px;font-weight:700;">${escapeHtml(label)}</span>`;
}

function formatHostname(value) {
	return normalizeHostname(value) || value;
}

function normalizeHostname(value) {
	try {
		return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return String(value || "").replace(/^www\./, "").toLowerCase();
	}
}

async function getNeverSaveHosts() {
	const stored = await chrome.storage.local.get(NEVER_SAVE_HOSTS_KEY);
	return stored[NEVER_SAVE_HOSTS_KEY] || [];
}

async function isNeverSaveHost(hostname) {
	const hosts = await getNeverSaveHosts();
	return hosts.includes(hostname);
}

async function addNeverSaveHost(hostname) {
	const hosts = await getNeverSaveHosts();
	await chrome.storage.local.set({
		[NEVER_SAVE_HOSTS_KEY]: Array.from(new Set([...hosts, hostname])),
	});
}

function maskIdentifier(value) {
	const trimmed = value.trim();
	const atIndex = trimmed.indexOf("@");
	if (atIndex > 1) {
		const prefix = trimmed.slice(0, atIndex);
		return `${prefix.slice(0, 2)}***${trimmed.slice(atIndex)}`;
	}

	if (trimmed.length <= 4) {
		return trimmed;
	}

	return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
