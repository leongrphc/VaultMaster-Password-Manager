const statusNode = document.getElementById("status");
const itemsNode = document.getElementById("items");
const domainNode = document.getElementById("active-domain");
const refreshButton = document.getElementById("refresh-button");
const openAppButton = document.getElementById("open-app-button");
const vaultStatusNode = document.getElementById("vault-status");
const shortcutNode = document.getElementById("shortcut-info");
const sessionForm = document.getElementById('session-form');
const passwordNode = document.getElementById('master-password');
const emailNode = document.getElementById('email');
let sessionStatus = null;
let needs2FA = false;
let webAuthnOptions = null;
let busy = false;

sessionForm.addEventListener('submit', event => { event.preventDefault(); void authenticate(); });
document.getElementById('webauthn-button').addEventListener('click', () => { void authenticate(true); });
document.getElementById('lock-button').addEventListener('click', () => { void sessionAction('NATIVE_LOCK'); });
document.getElementById('logout-button').addEventListener('click', () => { void sessionAction('NATIVE_LOGOUT'); });
chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'session' && !busy) void loadState(); });

async function nativeMessage(message) {
	const response = await sendRuntimeMessage(message);
	if (!response?.ok) throw new Error(response?.error || 'Eklenti yanıt vermiyor.');
	return response.payload;
}
function setBusy(value) {
	busy = value;
	for (const button of document.querySelectorAll('button')) button.disabled = value;
}
async function sessionAction(type) {
	if (busy) return;
	setBusy(true);
	let error;
	try { await nativeMessage({ type }); }
	catch (failure) { error = failure.message; }
	finally { setBusy(false); await loadState(); if (error) setStatus(error); }
}
async function authenticate(useWebAuthn = false) {
	if (busy || !passwordNode.value) return;
	setBusy(true); setStatus('Kasa doğrulanıyor...');
	let error;
	try {
		let assertion;
		if (useWebAuthn) {
			if (!webAuthnOptions) throw new Error('Önce giriş bilgilerinizi doğrulayın.');
			const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
			const options = webAuthnOptions.options;
			const credential = await navigator.credentials.get({ publicKey: { ...options, challenge: decode(options.challenge),
				allowCredentials: options.allowCredentials?.map(item => ({ ...item, id: decode(item.id) })) } });
			const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
			assertion = { id: credential.id, rawId: encode(credential.rawId), type: credential.type,
				response: { clientDataJSON: encode(credential.response.clientDataJSON), authenticatorData: encode(credential.response.authenticatorData),
					signature: encode(credential.response.signature), userHandle: credential.response.userHandle ? encode(credential.response.userHandle) : undefined },
				clientExtensionResults: credential.getClientExtensionResults() };
		}
		const payload = await nativeMessage(sessionStatus?.isAuthenticated
			? { type: 'NATIVE_UNLOCK', password: passwordNode.value }
			: { type: 'NATIVE_LOGIN', email: emailNode.value, password: passwordNode.value,
				code: document.getElementById('two-factor-code').value.trim(), recoveryCode: document.getElementById('recovery-code').value.trim(),
				...(assertion ? { webAuthnResponse: assertion, webAuthnChallengeToken: webAuthnOptions.challengeToken } : {}) });
		needs2FA = Boolean(payload.requires2FA); webAuthnOptions = payload.webAuthnOptions || null;
		if (needs2FA) error = 'İkinci doğrulama gerekli. Ana şifreyi tekrar girip 2FA/kurtarma kodunu veya güvenlik anahtarını kullanın.';
		else { document.getElementById('two-factor-code').value = ''; document.getElementById('recovery-code').value = ''; }
	} catch (failure) { error = failure.message || 'Giriş tamamlanamadı.'; }
	finally { passwordNode.value = ''; setBusy(false); await loadState(); if (error) setStatus(error); }
}

refreshButton.addEventListener("click", () => {
	void sessionAction('NATIVE_SYNC');
});

openAppButton.addEventListener("click", () => {
	chrome.runtime.sendMessage({ type: "OPEN_VAULTMASTER" });
});

void loadState();

async function loadState() {
	itemsNode.innerHTML = "";
	setStatus("Aktif site ve VaultMaster durumu analiz ediliyor...");

	// Vault durumunu al
	await loadVaultStatus();

	const [activeTab] = await queryTabs({ active: true, currentWindow: true });
	const activeUrl = activeTab?.url || "";
	const activeDomain = activeUrl ? formatHostname(activeUrl) : "Aktif sekme bulunamadı";
	domainNode.textContent = activeDomain;

	const response = await sendRuntimeMessage({ type: "GET_EXTENSION_STATUS" }).catch(() => null);
	if (!response?.ok) {
		setStatus("VaultMaster durumu alınamadı.");
		renderEmptyState("Eklenti arka plan servisi ile iletişim kurulamadı.");
		updateVaultStatusBadge(null);
		return;
	}

	if (!response.payload?.isAuthenticated || response.payload.isLocked) {
		setStatus(response.payload?.isAuthenticated ? 'Kasayı açmak için ana şifrenizi girin.' : 'Eklentiye giriş yapın. Web sekmesi açmanız gerekmez.');
		renderEmptyState('Kayıtlarınız kasa açılınca görünür.');
		return;
	}

	if (!/^https?:/i.test(activeUrl)) {
		setStatus("Bu sekme için autofill önerisi desteklenmiyor.");
		renderEmptyState("HTTP/HTTPS bir sayfaya geçin.");
		return;
	}

	const pageState = activeTab?.id
		? await sendTabMessage(activeTab.id, { type: "GET_PAGE_AUTOFILL_STATE" }).catch(() => null)
		: null;
	let payload = pageState?.payload;

	if (payload?.status !== "ready" || !payload.suggestions?.length) {
		const suggestionsResponse = await sendRuntimeMessage({
			type: "LIST_LOGIN_SUGGESTIONS",
			pageUrl: activeUrl,
			identifier: "",
		}).catch(() => null);
		payload = suggestionsResponse?.payload;
	}

	if (payload?.status !== "ready" || !payload.suggestions?.length) {
		setStatus("VaultMaster hazır. Bu domaine uygun kayıt bulunamadı veya giriş formu bekleniyor.");
		renderEmptyState("Bu site için eşleşen hesap görünmüyor.");
		updateVaultStatusBadge(true);
		return;
	}

	setStatus("Hazır. Bir hesaba tıklayınca aktif sayfadaki boş alanlar doldurulur.");
	renderSuggestions(payload.suggestions.slice(0, 4));
	updateVaultStatusBadge(true);
}

// Vault durumunu badge'den al
async function loadVaultStatus() {
	try {
		const response = await sendRuntimeMessage({ type: "GET_VAULT_STATUS" }).catch(() => null);
		const isLocked = response?.payload?.isLocked;
		const isAuthenticated = response?.payload?.isAuthenticated;
		sessionStatus = response?.payload || null;
		document.getElementById('session-panel').hidden = Boolean(isAuthenticated && !isLocked);
		document.getElementById('email-label').hidden = Boolean(isAuthenticated);
		emailNode.required = !isAuthenticated;
		if (isAuthenticated) emailNode.value = sessionStatus.email;
		document.getElementById('session-title').textContent = isAuthenticated ? 'Kasanın Kilidini Aç' : 'Eklentiye Giriş Yap';
		document.getElementById('session-submit').textContent = isAuthenticated ? 'Kilidi Aç' : 'Giriş Yap';
		document.getElementById('code-label').hidden = !needs2FA || isAuthenticated;
		document.getElementById('recovery-label').hidden = !needs2FA || isAuthenticated;
		document.getElementById('webauthn-button').hidden = !webAuthnOptions || isAuthenticated;
		document.getElementById('lock-button').hidden = !isAuthenticated || isLocked;
		document.getElementById('logout-button').hidden = !isAuthenticated;
		refreshButton.hidden = !isAuthenticated || isLocked;

		if (!isAuthenticated) {
			updateVaultStatusBadge(null);
			vaultStatusNode.textContent = "Giriş yapılmadı";
			vaultStatusNode.className = "vault-status disconnected";
		} else if (isLocked) {
			updateVaultStatusBadge(true);
			vaultStatusNode.textContent = "Vault kilitli 🔒";
			vaultStatusNode.className = "vault-status locked";
		} else {
			updateVaultStatusBadge(true);
			vaultStatusNode.textContent = "Vault açık ✓";
			vaultStatusNode.className = "vault-status unlocked";
		}
	} catch {
		vaultStatusNode.textContent = "Durum bilinmiyor";
		vaultStatusNode.className = "vault-status unknown";
	}
}

// Extension badge durumunu güncelle (popup'tan bağımsız)
async function updateVaultStatusBadge(isOpen) {
	// Badge zaten background.js tarafından güncelleniyor, burada sadece UI feedback
}

function renderSuggestions(suggestions) {
	itemsNode.innerHTML = suggestions
		.map(
			(suggestion) => `
			<button class="item suggestion-item" type="button" data-item-id="${escapeHtml(suggestion.itemId)}">
				<div class="item-main">
					<div>
						<p class="item-title">${escapeHtml(suggestion.title)}</p>
						<p class="item-meta">${escapeHtml(maskIdentifier(suggestion.username))}</p>
					</div>
					<span class="score">Doldur</span>
				</div>
				<div class="tags">
					<span class="tag">${escapeHtml(formatHostname(suggestion.url || ""))}</span>
					${suggestion.isExactIdentifierMatch ? '<span class="tag">Tam eşleşme</span>' : ""}
					${suggestion.isPreferred ? '<span class="tag">Son kullanılan</span>' : ""}
				</div>
				<p class="item-footnote">Tıkla: aktif sayfadaki boş kullanıcı adı/şifre alanlarını doldur.</p>
			</button>
		`
		)
		.join("");

	itemsNode.querySelectorAll("[data-item-id]").forEach((node) => {
		node.addEventListener("click", async () => {
			const itemId = node.getAttribute("data-item-id");
			if (!itemId) return;
			await fillActiveTab(itemId);
		});
	});
}

function renderEmptyState(message) {
	itemsNode.innerHTML = `
		<article class="item">
			<div class="item-main">
				<div>
					<p class="item-title">Akıllı Autofill</p>
					<p class="item-meta">${escapeHtml(message)}</p>
				</div>
				<span class="score">Beklemede</span>
			</div>
			<div class="tags">
				<span class="tag">Domain eşleşmesi</span>
				<span class="tag">Mail önerisi</span>
				<span class="tag">Onaylı doldurma</span>
			</div>
		</article>
	`;
}

async function fillActiveTab(itemId) {
	const [activeTab] = await queryTabs({ active: true, currentWindow: true });
	if (!activeTab?.id || !activeTab.url) {
		setStatus("Aktif sekme bulunamadı.");
		return;
	}

	setStatus("Dolduruluyor...");
	const response = await sendTabMessage(activeTab.id, {
		type: "FILL_LOGIN_CREDENTIAL",
		itemId,
		pageUrl: activeTab.url,
	}).catch(() => null);

	if (response?.ok) {
		setStatus(response.message || "Doldurma isteği gönderildi.");
		window.setTimeout(() => window.close(), 450);
		return;
	}

	setStatus(response?.message || "Doldurma yapılamadı. Sayfayı yenileyip tekrar deneyin.");
}

function setStatus(text) {
	statusNode.textContent = text;
}

function queryTabs(query) {
	return new Promise((resolve) => {
		chrome.tabs.query(query, (tabs) => resolve(tabs));
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

function sendTabMessage(tabId, payload) {
	return new Promise((resolve, reject) => {
		chrome.tabs.sendMessage(tabId, payload, (response) => {
			const runtimeError = chrome.runtime.lastError;
			if (runtimeError) {
				reject(new Error(runtimeError.message));
				return;
			}

			resolve(response);
		});
	});
}

function formatHostname(value) {
	try {
		const url = new URL(value);
		return url.hostname.replace(/^www\./, "");
	} catch {
		return value || "Domain yok";
	}
}

function maskIdentifier(value) {
	const trimmed = String(value || "").trim();
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
