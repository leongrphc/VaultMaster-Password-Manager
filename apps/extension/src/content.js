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

let evaluationTimer = null;
let prewarmTimer = null;
let activeField = null;
let activePanel = null;
let activeLauncher = null;
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
const CREDENTIAL_CACHE_TTL_MS = 30000;
const autofillSuppressions = new Map();
const suggestionCache = new Map();
const credentialCache = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!isVaultMasterPage()) {
		return false;
	}

	if (typeof message?.type === "string" && message.type.startsWith("VM_") && message.type.endsWith("_REQUEST")) {
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
	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (message?.type === "GET_PAGE_AUTOFILL_STATE") {
			void getPageAutofillState(message, sendResponse);
			return true;
		}

		if (message?.type === "FILL_LOGIN_CREDENTIAL") {
			void fillCredentialFromMessage(message, sendResponse);
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
}

function onFieldActivity(event) {
	const target = event.target;
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

async function onFormSubmitCapture(event) {
	const form = event.target;
	if (!(form instanceof HTMLFormElement)) return;
	const hostname = normalizeHostname(window.location.href);
	if (hostname && (await isNeverSaveHost(hostname))) return;

	const detector = window.VaultMasterFormDetector;
	const inputs = Array.from(form.querySelectorAll("input"));
	const passwordInput = inputs.find((input) => detector?.normalizeInputType(input) === "password");
	const usernameInput =
		inputs.find((input) => detector?.isLikelyIdentifierInput(input)) ||
		(passwordInput ? inputs.slice(0, inputs.indexOf(passwordInput)).reverse().find((input) => ["text", "email", "tel"].includes(detector?.normalizeInputType(input))) : null);

	if (!usernameInput || !passwordInput || !usernameInput.value.trim() || !passwordInput.value) return;

	window.setTimeout(() => {
		showSavePrompt({
			title: document.title || formatHostname(window.location.href),
			url: window.location.origin,
			username: usernameInput.value.trim(),
			password: passwordInput.value,
		});
	}, 800);
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

async function getPageAutofillState(_message, sendResponse) {
	if (Date.now() - pageAutofillState.updatedAt > SUGGESTION_CACHE_TTL_MS) {
		await prewarmPageAutofillState({ silent: true });
	}

	sendResponse({ ok: true, payload: pageAutofillState });
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
	const payload = await fetchSuggestions(identifier);
	if (payload?.suggestions?.length) {
		void prefetchSuggestionCredentials(payload.suggestions.slice(0, 4));
	}

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
				fillAction: fillCreditCard,
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
				fillAction: fillIdentity,
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
	void prefetchSuggestionCredentials(suggestionsPayload.suggestions.slice(0, 4));
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

function showSuggestionPanel({ context, panelKey, typedIdentifier, suggestions, isUsingOfflineData }) {
	const shouldReuse =
		activePanel &&
		activePanel.panelKey === panelKey &&
		activePanel.anchorInput === context.anchorInput;

	if (!shouldReuse) {
		removePanel();
	}

	const panel = shouldReuse ? activePanel.element : document.createElement("div");
	panel.id = "vaultmaster-inline-autofill";
	panel.style.cssText = [
		"position:fixed",
		"z-index:2147483647",
		"width:min(380px, calc(100vw - 24px))",
		"background:linear-gradient(180deg, rgba(11,17,31,0.98) 0%, rgba(7,11,22,0.98) 100%)",
		"border:1px solid rgba(0,255,178,0.18)",
		"border-radius:18px",
		"box-shadow:0 20px 56px rgba(0,0,0,0.32)",
		"backdrop-filter:blur(18px)",
		"color:#eef2ff",
		"font:13px/1.45 'Segoe UI', Arial, sans-serif",
		"overflow:hidden",
	].join(";");

	panel.innerHTML = `
  <div style="padding:14px 14px 10px;border-bottom:1px solid rgba(144,160,195,0.12);display:flex;align-items:start;justify-content:space-between;gap:12px;">
    <div>
      <div style="display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:4px;">
        <span style="display:inline-flex;width:10px;height:10px;border-radius:999px;background:#00ffb2;box-shadow:0 0 12px rgba(0,255,178,0.45);"></span>
        VaultMaster Autofill
      </div>
      <div style="color:#90a0c3;font-size:12px;">
        ${typedIdentifier ? "Hesap eşleşmeleri bulundu" : "Bu site için kayıtlı girişler"}
        ${isUsingOfflineData ? " • offline snapshot" : ""}
      </div>
    </div>
    <button data-action="dismiss" style="border:0;background:transparent;color:#90a0c3;cursor:pointer;font-size:18px;line-height:1;padding:0;">×</button>
  </div>
  <div style="padding:8px;display:grid;gap:8px;">
    ${suggestions
			.map(
				(suggestion) => `
      <button
        data-action="fill"
        data-item-id="${escapeHtml(suggestion.itemId)}"
        style="border:1px solid rgba(144,160,195,0.14);background:rgba(18,26,49,0.9);border-radius:14px;padding:12px;text-align:left;color:#eef2ff;cursor:pointer;display:grid;gap:6px;"
      >
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="font-weight:700;">${escapeHtml(suggestion.title)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:end;">
            ${suggestion.isPreferred ? badgeHtml("Son kullanılan", "#00ffb2", "rgba(0,255,178,0.10)") : ""}
            ${suggestion.isExactIdentifierMatch ? badgeHtml("Tam eşleşme", "#7dd3fc", "rgba(125,211,252,0.10)") : ""}
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;color:#90a0c3;">
          <div>${escapeHtml(maskIdentifier(suggestion.username))}</div>
          <div style="font-size:12px;">${escapeHtml(formatHostname(suggestion.url || window.location.href))}</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="color:#90a0c3;font-size:12px;">${escapeHtml(getPanelFootnote(context))}</div>
          <span style="display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:#00ffb2;color:#04111d;padding:5px 10px;font-weight:700;font-size:12px;">
            Doldur
          </span>
        </div>
      </button>
    `
			)
			.join("")}
  </div>
`;

	panel.querySelector("[data-action='dismiss']")?.addEventListener("click", () => {
		dismissedPanelKeys.add(panelKey);
		removePanel();
	});

	panel.querySelectorAll("[data-action='fill']").forEach((node) => {
		node.addEventListener("click", async () => {
			const itemId = node.getAttribute("data-item-id");
			if (!itemId) {
				return;
			}

			await handleCredentialFill(itemId, context, panelKey);
		});
	});

	if (!shouldReuse) {
		document.body.appendChild(panel);
	}

	activePanel = {
		element: panel,
		anchorInput: context.anchorInput,
		usernameInput: context.usernameInput,
		passwordInput: context.passwordInput,
		panelKey,
	};

	updatePanelPosition();
}

async function fillCredentialFromMessage(message, sendResponse) {
	activeField = getBestAnchorInput();
	const context = getPageLoginContext();
	if (!context) {
		sendResponse({ ok: false, message: "Giriş alanı bulunamadı." });
		return;
	}

	const itemId = message.itemId;
	if (!itemId) {
		sendResponse({ ok: false, message: "Kayıt seçilmedi." });
		return;
	}

	const result = await fillCredentialIntoContext(itemId, context, { forceFill: false });
	if (result.ok) {
		suppressAutofillForContext(context);
		removePanel();
		removeLauncher();
	}
	sendResponse(result);
}

async function handleCredentialFill(itemId, context, panelKey, options = {}) {
	if (!options.forceFill) {
		const isDomainValid = await validateCredentialForDomain(itemId, window.location.href);
		if (!isDomainValid) {
			showPhishingWarning(itemId, context, panelKey);
			return;
		}
	}

	const result = await fillCredentialIntoContext(itemId, context, options);
	if (!result.ok) {
		updatePanelNotice(result.message || "Kayıt alınamadı. VaultMaster sekmesinin açık ve kilitsiz olduğundan emin olun.", true);
		if (options.fromLauncher) {
			showLauncherFeedback("Kayit alinamadi");
		}
		return;
	}

	updatePanelNotice(result.message, false);
	if (options.fromLauncher) {
		showLauncherFeedback(result.filledFields.includes("identifier") && !result.filledFields.includes("password") ? "Kullanici adi dolduruldu" : "Doldurma tamamlandi");
	}
	dismissedPanelKeys.add(panelKey);
	window.setTimeout(() => removePanel(), result.hasTotp ? 3000 : 1200);
}

async function fillCredentialIntoContext(itemId, context, options = {}) {
	const credential = await getCachedCredential(itemId);
	if (!credential) {
		return { ok: false, message: "Kayıt alınamadı. VaultMaster sekmesinin açık ve kilitsiz olduğundan emin olun." };
	}
	const latestContext = getPageLoginContext() || context;
	const filledFields = [];

	if (latestContext.usernameInput && credential.username && (options.forceFill || !latestContext.usernameInput.value.trim())) {
		setNativeValue(latestContext.usernameInput, credential.username);
		filledFields.push("identifier");
	}

	if (latestContext.passwordInput && credential.password && (options.forceFill || !latestContext.passwordInput.value.trim())) {
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

	if (credential.hasTotp && filledFields.includes("password")) {
		window.setTimeout(async () => {
			const totpResponse = await sendRuntimeMessage({
				type: "GET_TOTP_CODE",
				itemId: credential.itemId,
			}).catch(() => null);

			if (totpResponse?.ok && totpResponse?.payload?.totpCode) {
				try {
					await navigator.clipboard.writeText(totpResponse.payload.totpCode);
					showTotpCopiedFeedback();
				} catch {}
			}
		}, 2000);
	}

	return {
		ok: true,
		message: buildFilledNotice(credential.title, credential.hasTotp, filledFields),
		filledFields,
		hasTotp: credential.hasTotp,
	};
}

async function prefetchSuggestionCredentials(suggestions) {
	await Promise.allSettled(
		suggestions.map((suggestion) => getCachedCredential(suggestion.itemId))
	);
}

async function getCachedCredential(itemId) {
	const cached = credentialCache.get(itemId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.credential;
	}

	const response = await sendRuntimeMessage({
		type: "GET_LOGIN_CREDENTIAL",
		itemId,
		pageUrl: window.location.href,
	}).catch(() => null);

	const credential = response?.payload?.credential;
	if (!response?.ok || response.payload?.status !== "ready" || !credential) {
		credentialCache.delete(itemId);
		return null;
	}

	credentialCache.set(itemId, {
		credential,
		expiresAt: Date.now() + CREDENTIAL_CACHE_TTL_MS,
	});
	return credential;
}

// Phishing koruması - domain doğrulama
async function validateCredentialForDomain(itemId, pageUrl) {
	try {
		const response = await sendRuntimeMessage({
			type: "VALIDATE_CREDENTIAL_DOMAIN",
			itemId,
			expectedUrl: pageUrl,
		});
		return response?.payload?.valid === true;
	} catch {
		return false;
	}
}

// Phishing uyarısı göster
function showPhishingWarning(itemId, context, panelKey) {
	if (!activePanel?.element) {
		return;
	}

	activePanel.locked = true;

	const body = activePanel.element.querySelector("div:nth-of-type(2)");
	if (!(body instanceof HTMLElement)) {
		return;
	}

	body.innerHTML = `
    <div style="padding:12px;border-radius:14px;background:rgba(255,77,106,0.12);border:1px solid rgba(255,77,106,0.35);color:#ff9aac;">
      <div style="font-weight:700;margin-bottom:6px;">⚠️ Güvenlik Uyarısı</div>
      <div style="font-size:12px;line-height:1.5;">
        Bu kayıt farklı bir site için kaydedilmiş. Credential'ı farklı bir domaine doldurmak güvenlik riski oluşturabilir.
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button data-action="dismiss-warning" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,77,106,0.3);background:transparent;color:#ff9aac;cursor:pointer;font-size:12px;font-weight:600;">
          İptal
        </button>
        <button data-action="force-fill" data-item-id="${escapeHtml(itemId)}" style="flex:1;padding:8px;border-radius:8px;border:0;background:rgba(255,77,106,0.2);color:#ff9aac;cursor:pointer;font-size:12px;font-weight:600;">
          Yine de doldur
        </button>
      </div>
    </div>
  `;

	activePanel.element.querySelector("[data-action='dismiss-warning']")?.addEventListener("click", () => {
		dismissedPanelKeys.add(panelKey + "-warning");
		removePanel();
	});

	activePanel.element.querySelector("[data-action='force-fill']")?.addEventListener("click", async () => {
		const forceItemId = activePanel.element.querySelector("[data-action='force-fill']")?.getAttribute("data-item-id");
		if (forceItemId) {
			await handleCredentialFill(forceItemId, context, panelKey, { forceFill: true });
		}
	});
}

// TOTP kodu kopyalandı feedback
function showTotpCopiedFeedback() {
	if (!activePanel?.element) {
		return;
	}

	const body = activePanel.element.querySelector("div:nth-of-type(2)");
	if (!(body instanceof HTMLElement)) {
		return;
	}

	body.innerHTML = `
    <div style="padding:12px;border-radius:14px;background:rgba(0,255,178,0.10);border:1px solid rgba(0,255,178,0.20);color:#b7ffe8;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;">✓</span>
        <span style="font-weight:600;">TOTP kodu panoya kopyalandı</span>
      </div>
    </div>
  `;
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

	panel.querySelector("[data-action='dismiss']")?.addEventListener("click", removePanel);
	panel.querySelector("[data-action='never-save']")?.addEventListener("click", async () => {
		const hostname = normalizeHostname(credential.url);
		if (hostname) {
			await addNeverSaveHost(hostname);
		}
		removePanel();
	});
	panel.querySelector("[data-action='save']")?.addEventListener("click", async () => {
		const response = await sendRuntimeMessage({ type: "SAVE_LOGIN_CREDENTIAL", credential }).catch(() => null);
		const status = response?.payload?.status;
		if (response?.ok && (status === "created" || status === "updated")) {
			updatePanelNotice(status === "updated" ? "Kayıt güncellendi." : "Kayıt kasaya eklendi.", false);
			window.setTimeout(removePanel, 1200);
			return;
		}
		updatePanelNotice("Kaydetme başarısız. VaultMaster sekmesinin açık ve kilitsiz olduğundan emin olun.", true);
	});

	document.body.appendChild(panel);
	activePanel = { element: panel, anchorInput: null, panelKey: `save|${window.location.hostname}`, fixed: true };
}

function showStructuredSuggestionPanel({ context, items, title, subtitle, fillAction }) {
	removePanel();
	const panel = document.createElement("div");
	panel.id = "vaultmaster-inline-autofill";
	panel.style.cssText = [
		"position:fixed",
		"z-index:2147483647",
		"width:min(380px, calc(100vw - 24px))",
		"background:linear-gradient(180deg, rgba(11,17,31,0.98) 0%, rgba(7,11,22,0.98) 100%)",
		"border:1px solid rgba(0,255,178,0.18)",
		"border-radius:18px",
		"box-shadow:0 20px 56px rgba(0,0,0,0.32)",
		"backdrop-filter:blur(18px)",
		"color:#eef2ff",
		"font:13px/1.45 'Segoe UI', Arial, sans-serif",
		"overflow:hidden",
	].join(";");

	panel.innerHTML = `
		<div style="padding:14px 14px 10px;border-bottom:1px solid rgba(144,160,195,0.12);display:flex;align-items:start;justify-content:space-between;gap:12px;">
			<div>
				<div style="display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:4px;">
					<span style="display:inline-flex;width:10px;height:10px;border-radius:999px;background:#00ffb2;box-shadow:0 0 12px rgba(0,255,178,0.45);"></span>
					${escapeHtml(title)}
				</div>
				<div style="color:#90a0c3;font-size:12px;">${escapeHtml(subtitle)}</div>
			</div>
			<button data-action="dismiss" style="border:0;background:transparent;color:#90a0c3;cursor:pointer;font-size:18px;line-height:1;padding:0;">×</button>
		</div>
		<div style="padding:8px;display:grid;gap:8px;">
			${items.map((item) => `
				<button data-action="fill-structured" data-item-id="${escapeHtml(item.itemId)}" style="border:1px solid rgba(144,160,195,0.14);background:rgba(18,26,49,0.9);border-radius:14px;padding:12px;text-align:left;color:#eef2ff;cursor:pointer;display:grid;gap:6px;">
					<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
						<div style="font-weight:700;">${escapeHtml(item.title)}</div>
						<span style="display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:#00ffb2;color:#04111d;padding:5px 10px;font-weight:700;font-size:12px;">Doldur</span>
					</div>
					<div style="color:#90a0c3;font-size:12px;">${escapeHtml(formatStructuredItemSubtitle(item))}</div>
				</button>
			`).join("")}
		</div>
	`;

	panel.querySelector("[data-action='dismiss']")?.addEventListener("click", removePanel);
	panel.querySelectorAll("[data-action='fill-structured']").forEach((node) => {
		node.addEventListener("click", async () => {
			const itemId = node.getAttribute("data-item-id");
			if (itemId) await fillAction(itemId, context);
		});
	});

	document.body.appendChild(panel);
	activePanel = {
		element: panel,
		anchorInput: context.anchorInput || activeField,
		panelKey: `${context.type}|${window.location.hostname}`,
		locked: true,
	};
	updatePanelPosition();
}

function updatePanelPosition() {
	if (activePanel?.fixed) {
		return;
	}

	if (activePanel?.locked && activePanel.anchorInput && document.body.contains(activePanel.anchorInput)) {
		const rect = activePanel.anchorInput.getBoundingClientRect();
		const panel = activePanel.element;
		const top = Math.min(rect.bottom + 10, window.innerHeight - panel.offsetHeight - 12);
		const left = Math.min(Math.max(12, rect.left), window.innerWidth - panel.offsetWidth - 12);
		panel.style.top = `${Math.max(12, top)}px`;
		panel.style.left = `${left}px`;
		return;
	}

	if (!activePanel?.anchorInput || !document.body.contains(activePanel.anchorInput)) {
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

		launcher.addEventListener("click", async () => {
			const focusTarget = getBestAnchorInput();
			if (focusTarget) {
				activeField = focusTarget;
				focusTarget.focus();
			}

			const context = getLoginFormContext(activeField) || getFallbackLoginFormContext();
			if (!context) {
				showLauncherFeedback("Giris alani bulunamadi");
				return;
			}

			if (await tryApplyPendingAutofill(context)) {
				showLauncherFeedback("Sifre dolduruldu");
				return;
			}

			const typedIdentifier = context.usernameInput?.value.trim() || "";
			const payload = await fetchSuggestions(typedIdentifier);
			if (!payload?.suggestions?.length) {
				showLauncherFeedback("Uygun hesap bulunamadi");
				return;
			}

			const panelKey = buildPanelKey(context, typedIdentifier);
			await handleCredentialFill(payload.suggestions[0].itemId, context, panelKey, {
				fromLauncher: true,
			});
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

function getScopedVisibleInputs(currentInput) {
	const scopeRoot =
		currentInput instanceof HTMLElement ? currentInput.closest("form") : null;

	const inputList = scopeRoot
		? Array.from(scopeRoot.querySelectorAll("input"))
		: Array.from(document.querySelectorAll("input"));

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

async function rememberPendingAutofill(credential) {
	const pendingAutofill = {
		itemId: credential.itemId,
		title: credential.title,
		username: credential.username,
		password: credential.password,
		hasTotp: credential.hasTotp,
		hostname: window.location.hostname,
		expiresAt: Date.now() + PENDING_AUTOFILL_TTL_MS,
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
		pendingAutofill.hostname !== window.location.hostname ||
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

async function tryApplyPendingAutofill(context) {
	const pending = await getPendingAutofill();
	if (!pending || !context?.passwordInput || !pending.password) {
		return false;
	}

	if (context.passwordInput.value.trim()) {
		await clearPendingAutofill();
		return false;
	}

	setNativeValue(context.passwordInput, pending.password);
	context.passwordInput.focus();
	await clearPendingAutofill();
	suppressAutofillForContext(context);
	updatePanelNotice(buildFilledNotice(pending.title, pending.hasTotp, ["password"]), false);
	return true;
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

async function fillCreditCard(itemId, context) {
	const response = await sendRuntimeMessage({ type: "GET_CREDIT_CARD", itemId }).catch(() => null);
	const card = response?.payload?.card;
	if (!response?.ok || response.payload?.status !== "ready" || !card) {
		updatePanelNotice("Kart bilgisi alınamadı. VaultMaster sekmesinin açık ve kilitsiz olduğundan emin olun.", true);
		return;
	}

	if (context.cardNumberInput) setNativeValue(context.cardNumberInput, card.cardNumber);
	if (context.cardholderNameInput) setNativeValue(context.cardholderNameInput, card.cardholderName);
	if (context.cvvInput) setNativeValue(context.cvvInput, card.cvv);
	if (context.expMonthInput) setNativeValue(context.expMonthInput, card.expMonth);
	if (context.expYearInput) setNativeValue(context.expYearInput, card.expYear);
	if (context.expiryInput) setNativeValue(context.expiryInput, `${card.expMonth}/${String(card.expYear).slice(-2)}`);
	updatePanelNotice(`${card.title} kartı dolduruldu.`, false);
	window.setTimeout(removePanel, 1200);
}

async function fillIdentity(itemId, context) {
	const response = await sendRuntimeMessage({ type: "GET_IDENTITY", itemId }).catch(() => null);
	const identity = response?.payload?.identity;
	if (!response?.ok || response.payload?.status !== "ready" || !identity) {
		updatePanelNotice("Kimlik bilgisi alınamadı. VaultMaster sekmesinin açık ve kilitsiz olduğundan emin olun.", true);
		return;
	}

	if (context.fullNameInput) setNativeValue(context.fullNameInput, identity.fullName);
	if (context.emailInput && identity.email) setNativeValue(context.emailInput, identity.email);
	if (context.phoneInput && identity.phone) setNativeValue(context.phoneInput, identity.phone);
	if (context.organizationInput && identity.organization) setNativeValue(context.organizationInput, identity.organization);
	if (context.addressInput && identity.address) setNativeValue(context.addressInput, identity.address);
	updatePanelNotice(`${identity.title} kimliği dolduruldu.`, false);
	window.setTimeout(removePanel, 1200);
}

function formatStructuredItemSubtitle(item) {
	if (item.last4) return `${item.cardholderName || "Kart"} •••• ${item.last4} • ${item.expMonth}/${item.expYear}`;
	return [item.fullName, item.email].filter(Boolean).join(" • ") || "Kimlik bilgisi";
}

async function fetchSuggestions(identifier, options = {}) {
	const normalizedIdentifier = normalizeIdentifier(identifier);
	const cacheKey = `${window.location.origin}${window.location.pathname}|${normalizedIdentifier}`;
	const cached = suggestionCache.get(cacheKey);
	if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
		return cached.payload;
	}

	const response = await sendRuntimeMessage({
		type: "LIST_LOGIN_SUGGESTIONS",
		identifier: normalizedIdentifier,
		pageUrl: window.location.href,
	}).catch(() => null);

	const payload = response?.payload;
	if (!response?.ok || !payload || payload.status !== "ready" || !payload.suggestions?.length) {
		return null;
	}

	suggestionCache.set(cacheKey, {
		payload,
		expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS,
	});
	return payload;
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

function isVaultMasterPage() {
	return VAULTMASTER_ORIGINS.has(window.location.origin);
}

function requestVaultBridge(type, payload, existingRequestId) {
	return new Promise((resolve, reject) => {
		const requestId = existingRequestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const timeout = window.setTimeout(() => {
			window.removeEventListener("message", onMessage);
			reject(new Error("VaultMaster bridge timed out."));
		}, 4000);

		function onMessage(event) {
			if (event.source !== window) {
				return;
			}

			const data = event.data;
			if (
				data?.source !== "vaultmaster-web" ||
				data.type !== `${type}_RESPONSE` ||
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
			"*"
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