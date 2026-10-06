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
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === 'session' && changes.vaultmasterNativeSession && !busy) void loadState();
});

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
		setStatus(response.payload?.isAuthenticated ? 'Kasanın kilidini açmak için ana şifrenizi girin.' : 'Eklentiye giriş yapın. Web sekmesi açmanız gerekmez.');
		renderEmptyState('Öğeleriniz kasanın kilidi açılınca görünür.');
		return;
	}

	if (!/^https?:/i.test(activeUrl)) {
		setStatus("Bu sekme için otomatik doldurma önerisi desteklenmiyor.");
		renderEmptyState("HTTP/HTTPS bir sayfaya geçin.");
		return;
	}

	if (await renderPasskeyRequests(activeTab.id)) return;
	const result = await sendRuntimeMessage({ type: 'LIST_AUTOFILL_TARGETS', tabId: activeTab.id }).catch(() => null);
	const targets = result?.payload?.targets || [];
	itemsNode.innerHTML = '';
	for (const target of targets) {
		const label = document.createElement('p');
		label.textContent = `${target.frameId === 0 ? 'Ana sayfa' : `Frame ${target.frameId}`} • ${target.origin || target.url}`;
		itemsNode.appendChild(label);
		if (!target.supported) {
			const notice = document.createElement('p');
			notice.textContent = 'Desteklenmiyor: farklı köken, opak veya etkin olmayan belge. Bu adresi ayrı sekmede açın.';
			itemsNode.appendChild(notice); continue;
		}
		const decision = document.createElement('p');
		decision.textContent = target.formToken ? 'Aynı köken: bu form için seçim yapabilirsiniz.' : 'Aynı köken: görünür desteklenen form bulunamadı.';
		itemsNode.appendChild(decision);
		if (target.passwordMode) decision.textContent += target.passwordMode === 'change' ? ' Mevcut şifre doldurulur; yeni şifre ayrı tutulur.' : target.passwordMode === 'ambiguous' ? ' Şifre alanları belirsiz; doldurulmaz.' : target.passwordMode === 'new' ? ' Yeni şifre formu.' : '';
		if (target.canGenerate && target.formToken) {
			const generate = document.createElement('button');
			generate.type = 'button'; generate.dataset.action = 'generate-password';
			generate.textContent = 'Yeni Şifre Üret (24 karakter)';
			generate.addEventListener('click', async event => {
				if (!event.isTrusted) return;
				generate.disabled = true;
				const result = await sendRuntimeMessage({ type: 'GENERATE_AUTOFILL_PASSWORD', tabId: activeTab.id,
					documentId: target.documentId, formToken: target.formToken }).catch(() => null);
				setStatus(result?.message || 'Şifre üretilemedi. Formu yeniden kontrol edin.'); generate.disabled = false;
			});
			itemsNode.appendChild(generate);
		}
		if (target.passwordMode !== 'ambiguous') renderSuggestions(target.suggestions, { ...target, tabId: activeTab.id });
	}
	setStatus('Hedef adresi kontrol edin, sonra bir giriş bilgisi seçin. Kapalı Shadow DOM desteklenmez.');
	if (!targets.length) renderEmptyState('Desteklenen giriş formu bulunamadı.');
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
		document.getElementById('session-submit').textContent = isAuthenticated ? 'Kasanın Kilidini Aç' : 'Giriş Yap';
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
			vaultStatusNode.textContent = "Kasa Kilitli 🔒";
			vaultStatusNode.className = "vault-status locked";
		} else {
			updateVaultStatusBadge(true);
			vaultStatusNode.textContent = "Kasa Kilidi Açık ✓";
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

function renderSuggestions(suggestions, target) {
	const group = document.createElement("div");
	group.innerHTML = suggestions
		.map(
			(suggestion) => `
			<button class="item suggestion-item" type="button" data-item-id="${escapeHtml(suggestion.itemId)}">
				<div class="item-main">
					<div>
						<p class="item-title">${escapeHtml(suggestion.title)}</p>
						<p class="item-meta">${escapeHtml(target.kind === 'login' ? maskIdentifier(suggestion.username) : suggestion.last4 ? `•••• ${suggestion.last4}` : suggestion.fullName || '')}</p>
					</div>
					<span class="score">Doldur</span>
				</div>
				<div class="tags">
					<span class="tag">${escapeHtml(formatHostname(suggestion.url || ""))}</span>
					${suggestion.isExactIdentifierMatch ? '<span class="tag">Tam eşleşme</span>' : ""}
					${suggestion.isPreferred ? '<span class="tag">Son kullanılan</span>' : ""}
				</div>
				<p class="item-footnote">Doldur: seçilen formun uygun alanlarını doldur; formu göndermez veya öğeyi kaydetmez.</p>
			</button>
		`
		)
		.join("");

	group.querySelectorAll("[data-item-id]").forEach((node) => {
		node.addEventListener("click", async (event) => {
			if (!event.isTrusted) return;
			const itemId = node.getAttribute("data-item-id");
			if (!itemId) return;
			await fillActiveTab(itemId, target);
		});
	});

	itemsNode.appendChild(group);
}

function renderEmptyState(message) {
	itemsNode.innerHTML = `
		<article class="item">
			<div class="item-main">
				<div>
					<p class="item-title">Otomatik Doldurma</p>
					<p class="item-meta">${escapeHtml(message)}</p>
				</div>
				<span class="score">Beklemede</span>
			</div>
			<div class="tags">
				<span class="tag">Alan adı eşleşmesi</span>
				<span class="tag">Giriş bilgisi önerisi</span>
				<span class="tag">Onaylı doldurma</span>
			</div>
		</article>
	`;
}

async function fillActiveTab(itemId, target, forceFill = false) {
	setStatus('Dolduruluyor...');
	const response = await sendRuntimeMessage({ type: 'FILL_AUTOFILL_TARGET', tabId: target.tabId,
		documentId: target.documentId, formToken: target.formToken, itemId, forceFill }).catch(() => null);
	if (response?.status === 'domain_mismatch' && !forceFill) {
		setStatus(`Öğe ${target.url} için doğrulanamadı. HTTPS giriş bilgileri HTTP üzerinde doldurulmaz.`);
		const confirm = document.createElement('button');
		confirm.dataset.action = 'force-fill';
		confirm.textContent = 'Adresi kontrol ettim: yine de doldur';
		confirm.addEventListener('click', event => {
			if (!event.isTrusted) return;
			confirm.remove(); void fillActiveTab(itemId, target, true);
		});
		itemsNode.appendChild(confirm); return;
	}
	setStatus(response?.message || (response?.ok ? 'Dolduruldu.' : 'Doldurma reddedildi. Hedefi yeniden kontrol edin.'));
}

function setStatus(text) {
	statusNode.textContent = text;
}

function queryTabs(query) {
	if (globalThis.browser?.tabs) return globalThis.browser.tabs.query(query);
	return new Promise((resolve) => {
		chrome.tabs.query(query, (tabs) => resolve(tabs));
	});
}

function sendRuntimeMessage(payload) {
	if (globalThis.browser?.runtime) return globalThis.browser.runtime.sendMessage(payload);
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

function formatHostname(value) {
	try {
		const url = new URL(value);
		return url.hostname.replace(/^www\./, "");
	} catch {
		return value || "Alan adı yok";
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

async function renderPasskeyRequests(tabId) {
  const response = await sendRuntimeMessage({ type: 'PASSKEY_LIST', tabId }).catch(() => null);
  if (!response?.payload?.length) return false;
  itemsNode.innerHTML = '';
  setStatus('Adresi ve hesabı kontrol edin. Passkey işlemi yalnızca bu penceredeki onayla yapılır.');
  for (const request of response.payload) {
    const label = document.createElement('p');
    label.textContent = `${request.origin} • RP: ${request.rpId} • ${request.userName}`; itemsNode.appendChild(label);
    const approve = (title, itemId) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = 'approve-passkey'; button.textContent = title;
      button.addEventListener('click', async event => {
        if (!event.isTrusted) return;
        for (const node of itemsNode.querySelectorAll('button')) node.disabled = true;
        const result = await sendRuntimeMessage({ type: 'PASSKEY_APPROVE', approvalId: request.approvalId, itemId }).catch(() => null);
        setStatus(result?.ok ? 'Passkey işlemi tamamlandı.' : 'Passkey işlemi iptal edildi veya tamamlanamadı.');
      }); itemsNode.appendChild(button);
    };
    if (request.operation === 'create') approve('Passkey Oluştur ve Şifreli Kasaya Kaydet');
    else for (const candidate of request.candidates) approve(`İmzala: ${candidate.title} • ${candidate.username}`, candidate.itemId);
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.dataset.action = 'cancel-passkey'; cancel.textContent = 'Passkey İşlemini İptal Et';
    cancel.addEventListener('click', async event => {
      if (!event.isTrusted) return;
      await sendRuntimeMessage({ type: 'PASSKEY_DISMISS', approvalId: request.approvalId }); setStatus('Passkey işlemi iptal edildi.');
    }); itemsNode.appendChild(cancel);
  }
  return true;
}

// Management uses the web's own device/session and explicit approval dialogs.
document.getElementById('open-sharing-button').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_SHARING_SETTINGS' });
});
