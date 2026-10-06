import { structuredEvent, newCorrelationId } from './observability.js';
import { API_URL } from './config.js';
import { deriveMasterKey, exportMasterKeyBase64, importMasterKey } from './crypto/key-derivation.js';
import { generateAuthHash } from './crypto/password-hash.js';
import { unwrapVaultKey } from './crypto/vault-key.js';
import { encryptJSON, decryptJSON } from './crypto/encryption.js';
import { createStoredPasskey, signStoredPasskey, isStoredPasskey, validatePasskeyRequest } from './crypto/passkey.js';
import { generateTotpCode } from './crypto/totp.js';

const chrome = globalThis.browser || globalThis.chrome;
const SESSION = 'vaultmasterNativeSession';
const CACHE = 'vaultmasterEncryptedCache';
const LOCK_MS = 5 * 60 * 1000;
const normalize = value => String(value || '').trim().toLowerCase();
function hostScore(pageUrl, savedUrl) {
  try {
    const page = new URL(pageUrl), saved = new URL(savedUrl);
    if (!['http:', 'https:'].includes(page.protocol) || !['http:', 'https:'].includes(saved.protocol) ||
      (saved.protocol === 'https:' && page.protocol !== 'https:')) return -5;
    const hostname = saved.hostname.replace(/^www\./, '').toLowerCase();
    const active = page.hostname.replace(/^www\./, '').toLowerCase();
    return active === hostname || active.endsWith(`.${hostname}`) ? 3 : -5;
  } catch { return -5; }
}

export class ExtensionApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Tokens and the unlocked DEK live only in Chrome's trusted, in-memory session
// storage. Persistent storage receives ciphertext only. No content-script API
// exposes session storage or the data key.
export class VaultSession {
  constructor({ storage, fetcher = (...args) => fetch(...args), apiUrl = API_URL, now = Date.now } = {}) {
    this.storage = storage || chrome.storage;
    this.fetcher = fetcher; this.apiUrl = apiUrl; this.now = now;
    this.session = null; this.key = null; this.keyBase64 = null;
    this.items = []; this.deadline = 0; this.lastSyncedAt = null;
    this.epoch = 0; this.refreshing = null; this.writes = Promise.resolve();
    this.ready = this.initialize();
  }
  async initialize() {
    if (this.storage.session.setAccessLevel) {
      await this.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    } else if (!globalThis.browser?.runtime?.getDocumentId) {
      throw new Error('Trusted session storage unavailable');
    } // Firefox session storage is always inaccessible to content scripts.
    await this.storage.session.remove('vaultmasterPendingPasskeys');
    const stored = (await this.storage.session.get(SESSION))[SESSION];
    if (stored?.apiUrl === this.apiUrl && stored.user?.id && stored.tokens?.refreshToken) {
      this.session = { user: stored.user, tokens: stored.tokens, deviceId: stored.deviceId, id: stored.id };
      if (stored.keyBase64 && stored.deadline > this.now()) {
        try { this.key = await importMasterKey(stored.keyBase64); this.keyBase64 = stored.keyBase64; this.deadline = stored.deadline; }
        catch { this.key = null; }
      }
    }
    await this.persist();
  }
  persist() {
    const value = this.session ? { ...this.session, apiUrl: this.apiUrl, keyBase64: this.keyBase64, deadline: this.deadline } : null;
    this.writes = this.writes.catch(() => undefined).then(async () => {
      if (value) await this.storage.session.set({ [SESSION]: value }); else await this.storage.session.remove(SESSION);
      if (value?.keyBase64 && value.deadline > this.now()) await chrome?.alarms?.create('vaultmaster-lock', { when: value.deadline });
      else await chrome?.alarms?.clear('vaultmaster-lock');
    });
    return this.writes;
  }
  guard(epoch, key = this.key) {
    if (this.key && this.deadline <= this.now()) void this.lock().catch(() => undefined);
    if (epoch !== this.epoch || !key || this.key !== key || this.deadline <= this.now()) throw new Error('Kasa kilitlendi. Kasanın kilidini tekrar açın.');
  }
  async lock() {
    ++this.epoch; this.key = null; this.keyBase64 = null; this.items = []; this.deadline = 0;
    await this.persist();
    await this.storage.session.remove(['vaultmasterPendingSaves', 'vaultmasterPendingAutofill', 'vaultmasterPendingPasskeys']);
  }
  async status() {
    await this.ready;
    if (this.key && this.deadline <= this.now()) await this.lock();
    return { isAuthenticated: Boolean(this.session), isLocked: !this.key, email: this.session?.user.email || '',
      lastSyncedAt: this.lastSyncedAt, lockDeadline: this.deadline, isUsingOfflineData: false };
  }
  async raw(path, { body, token, method = body ? 'POST' : 'GET' } = {}) {
    let response;
    try {
      response = await this.fetcher(this.apiUrl + path, { method, credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', 'X-VaultMaster-Client': 'extension',
          ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new ExtensionApiError('Sunucuya ulaşılamıyor. Bağlantınızı kontrol edin.', 0); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new ExtensionApiError(result.error || 'İstek tamamlanamadı.', response.status);
    return result;
  }
  async api(path, options = {}) {
    const sessionId = this.session?.id;
    if (!sessionId) throw new ExtensionApiError('Tekrar giriş yapın.', 401);
    try { return await this.raw(path, { ...options, token: this.session.tokens.accessToken }); }
    catch (error) {
      if (error.status !== 401) throw error;
      if (!this.refreshing) {
        const refreshToken = this.session?.tokens.refreshToken;
        this.refreshing = (async () => {
          try {
            const response = await this.raw('/auth/refresh', { body: { refreshToken } });
            if (this.session?.id !== sessionId) throw new Error('Oturum değişti.');
            this.session.tokens = response.data.tokens;
            await this.persist();
          } catch (failure) {
            if (failure.status === 401 && this.session?.id === sessionId) await this.clearSession();
            throw failure;
          } finally { this.refreshing = null; }
        })();
      }
      await this.refreshing;
      if (this.session?.id !== sessionId) throw new Error('Oturum değişti.');
      try { return await this.raw(path, { ...options, token: this.session.tokens.accessToken }); }
      catch (failure) {
        if (failure.status === 401 && this.session?.id === sessionId) await this.clearSession();
        throw failure;
      }
    }
  }
  async clearSession() {
    this.session = null;
    await this.lock();
    await this.storage.local.remove(CACHE);
  }
  async logout() {
    await this.ready;
    const previous = this.session;
    await this.clearSession();
    if (previous) {
      try { await this.raw('/auth/logout', { method: 'POST', token: previous.tokens.accessToken }); }
      catch (error) {
        if (error.status !== 401) throw error;
        const refreshed = await this.raw('/auth/refresh', { body: { refreshToken: previous.tokens.refreshToken } });
        await this.raw('/auth/logout', { method: 'POST', token: refreshed.data.tokens.accessToken });
      }
    }
  }
  async login({ email, password, code, recoveryCode, webAuthnResponse, webAuthnChallengeToken }) {
    await this.ready;
    if (typeof password !== 'string' || !password || password.length > 10000 || typeof email !== 'string' || email.length > 320) throw new Error('E-posta ve ana şifre gerekli.');
    if (this.session) await this.logout();
    const epoch = ++this.epoch;
    const normalizedEmail = normalize(email);
    const wrappingKey = await deriveMasterKey(password, normalizedEmail);
    const authHash = await generateAuthHash(wrappingKey, password);
    if (epoch !== this.epoch) throw new Error('Oturum işlemi iptal edildi.');
    const { data } = await this.raw('/auth/login', { body: { email: normalizedEmail, authHash, vaultKeyProtocol: 1,
      ...(code ? { code } : {}), ...(recoveryCode ? { recoveryCode } : {}),
      ...(webAuthnResponse ? { webAuthnResponse, webAuthnChallengeToken } : {}) } });
    if (epoch !== this.epoch) {
      if (data.tokens) await this.raw('/auth/logout', { method: 'POST', token: data.tokens.accessToken }).catch(() => undefined);
      throw new Error('Oturum işlemi iptal edildi.');
    }
    if (data.requires2FA) return { requires2FA: true, webAuthnOptions: data.webAuthnOptions };
    if (!data.tokens?.accessToken || !data.tokens?.refreshToken || !data.user?.id || normalize(data.user.email) !== normalizedEmail) throw new Error('Geçersiz oturum yanıtı.');
    const key = data.vaultKeyEnvelope ? await unwrapVaultKey(data.vaultKeyEnvelope, wrappingKey) : wrappingKey;
    const keyBase64 = await exportMasterKeyBase64(key);
    if (epoch !== this.epoch) {
      await this.raw('/auth/logout', { method: 'POST', token: data.tokens.accessToken }).catch(() => undefined);
      throw new Error('Oturum işlemi iptal edildi.');
    }
    this.session = { user: data.user, tokens: data.tokens, deviceId: data.deviceId, id: crypto.randomUUID() };
    this.key = key; this.keyBase64 = keyBase64; this.deadline = this.now() + LOCK_MS;
    await this.persist();
    try { await this.sync(); } catch (error) { await this.lock(); throw error; }
    return this.status();
  }
  async unlock(password) {
    await this.ready;
    await this.lock();
    if (!this.session) throw new Error('Önce giriş yapın.');
    const epoch = this.epoch, sessionId = this.session.id;
    const wrappingKey = await deriveMasterKey(password, this.session.user.email);
    // Reauthenticate the password with the API even for a legacy empty vault.
    // Current metadata recovers from password changes made in the web app.
    const authHash = await generateAuthHash(wrappingKey, password);
    const { data } = await this.api('/auth/unlock', { body: { authHash } });
    const key = data.vaultKeyEnvelope ? await unwrapVaultKey(data.vaultKeyEnvelope, wrappingKey) : wrappingKey;
    const keyBase64 = await exportMasterKeyBase64(key);
    if (epoch !== this.epoch || sessionId !== this.session?.id) throw new Error('Kilit açma iptal edildi.');
    this.key = key; this.keyBase64 = keyBase64; this.deadline = this.now() + LOCK_MS;
    await this.persist();
    try { await this.sync(); } catch (error) { await this.lock(); throw error; }
    return this.status();
  }
  async sync() {
    const requestId = newCorrelationId();
    let reason = 'internal';
    try {
    await this.ready;
    const epoch = this.epoch, key = this.key;
    this.guard(epoch, key);
    reason = 'http';
    const { data } = await this.api('/vault');
    reason = 'invalid_response';
    if (!Array.isArray(data)) throw new Error('Geçersiz kasa yanıtı.');
    reason = 'decrypt';
    const items = await Promise.all(data.filter(item => !item.deletedAt).map(async item => ({ ...item,
      data: await decryptJSON(item.encryptedData, item.iv, key) })));
    this.guard(epoch, key);
    this.items = items; this.lastSyncedAt = new Date(this.now()).toISOString();
    const cache = { userId: this.session.user.id, apiUrl: this.apiUrl, savedAt: this.lastSyncedAt, items: data };
    this.writes = this.writes.catch(() => undefined).then(() => {
      this.guard(epoch, key); return this.storage.local.set({ [CACHE]: cache });
    });
    reason = 'storage';
    await this.writes;
    this.guard(epoch, key);
    console.info(JSON.stringify(structuredEvent('sync_result', { component: 'extension', operation: 'sync', outcome: 'success', requestId })));
    return this.status();
    } catch (error) {
      console.info(JSON.stringify(structuredEvent('sync_result', { component: 'extension', operation: 'sync', outcome: 'failure',
        reason: error?.status === 0 ? 'network' : reason, requestId })));
      throw error;
    }
  }
  async passkeyCandidates(request) {
    validatePasskeyRequest(request);
    const epoch = this.epoch, key = this.key;
    this.guard(epoch, key);
    await this.sync(); this.guard(epoch, key);
    return this.items.filter(item => item.data.type === 'passkey' && isStoredPasskey(item.data) &&
      item.data.rpId === request.rpId && (!request.allowCredentials?.length || request.allowCredentials.includes(item.data.credentialId)))
      .slice(0, 16).map(item => ({ itemId: item.id, title: item.data.title, username: item.data.username || '' }));
  }
  async performPasskey(operation, request, itemId, assertCurrent) {
    const epoch = this.epoch, key = this.key;
    const guard = () => { this.guard(epoch, key); assertCurrent(); };
    guard(); validatePasskeyRequest(request);
    await this.sync(); guard();
    if (operation === 'get') {
      const matches = this.items.filter(item => item.id === itemId && item.data.type === 'passkey');
      if (matches.length !== 1) throw new Error('Passkey kullanılamıyor.');
      const selected = matches[0].data;
      if (this.items.some(item => item.data.type === 'passkey' && item.data.credentialId === selected.credentialId &&
        (item.data.privateKey !== selected.privateKey || item.data.rpId !== selected.rpId || item.data.userHandle !== selected.userHandle || item.data.publicKey !== selected.publicKey))) {
        throw new Error('Passkey kullanılamıyor.');
      }
      const response = await signStoredPasskey(request, matches[0].data); guard();
      // Check the device again after signing; never return a signature after a
      // remote revocation or lock race. No signature is persisted or logged.
      await this.api('/auth/me'); guard(); return response;
    }
    if (operation !== 'create') throw new Error('Geçersiz passkey işlemi.');
    const { stored, response } = await createStoredPasskey(request, this.items.filter(item => item.data.type === 'passkey').map(item => item.data));
    guard();
    const encrypted = await encryptJSON({ type: 'passkey', title: request.rpId, username: request.user.name,
      ...stored, signCount: 0, transports: [] }, key);
    guard();
    await this.api('/vault', { method: 'POST', body: { encryptedData: encrypted.ciphertext, iv: encrypted.iv, folderId: null } });
    guard(); await this.sync(); guard(); return response;
  }
  async request(type, payload = {}) {
    await this.ready;
    const status = await this.status();
    if (type === 'VM_GET_VAULT_STATUS_REQUEST') return { ok: true, payload: status };
    if (!status.isAuthenticated || status.isLocked) return { ok: true, payload: { status: status.isAuthenticated ? 'locked' : 'logged_out' } };
    const epoch = this.epoch, key = this.key;
    const secretRequest = ['VM_GET_LOGIN_CREDENTIAL_REQUEST', 'VM_GET_PASSWORD_REQUEST', 'VM_GET_TOTP_CODE_REQUEST',
      'VM_GET_CREDIT_CARD_REQUEST', 'VM_GET_IDENTITY_REQUEST', 'VM_SAVE_LOGIN_REQUEST', 'VM_PREVIEW_LOGIN_SAVE_REQUEST'].includes(type);
    if (secretRequest || !this.lastSyncedAt || this.now() - Date.parse(this.lastSyncedAt) > 30000) await this.sync();
    else await this.api('/auth/me');
    this.guard(epoch, key);
    const item = this.items.find(entry => entry.id === payload.itemId);
    const matches = this.items.filter(entry => entry.data.type === 'login' && hostScore(payload.pageUrl, entry.data.url) > 0 &&
      (!payload.identifier || normalize(entry.data.username).includes(normalize(payload.identifier)) || normalize(entry.data.title).includes(normalize(payload.identifier))));
    const suggestions = matches.map(entry => ({ itemId: entry.id, title: entry.data.title, username: entry.data.username,
      url: entry.data.url, matchScore: 3, isExactIdentifierMatch: Boolean(payload.identifier) && normalize(entry.data.username) === normalize(payload.identifier), hasTotp: Boolean(entry.data.totpSecret) }))
      .sort((a, b) => Number(b.isExactIdentifierMatch) - Number(a.isExactIdentifierMatch)).slice(0, 6);
    let result = { status: 'no_match' };
    if (type === 'VM_LIST_LOGIN_SUGGESTIONS_REQUEST') result = { status: suggestions.length ? 'ready' : 'no_match', suggestions };
    if (type === 'VM_LOOKUP_PASSWORD_REQUEST') result = { status: suggestions.length ? 'ready' : 'no_match', suggestion: suggestions[0] };
    if (type === 'VM_VALIDATE_CREDENTIAL_DOMAIN_REQUEST') result = { valid: item?.data.type === 'login' && hostScore(payload.pageUrl, item.data.url) > 0 };
    if (type === 'VM_GET_LOGIN_CREDENTIAL_REQUEST' && item?.data.type === 'login') {
      const insecure = new URL(payload.pageUrl).protocol === 'http:' && new URL(item.data.url).protocol === 'https:';
      result = hostScore(payload.pageUrl, item.data.url) <= 0 && (!payload.forceFill || insecure)
        ? { status: 'domain_mismatch', itemId: item.id }
        : { status: 'ready', credential: { itemId: item.id, ...item.data, hasTotp: Boolean(item.data.totpSecret) } };
      // Never send stored TOTP seeds, notes or unrelated record fields to pages.
      if (result.credential) result.credential = { itemId: item.id, title: item.data.title, username: item.data.username,
        password: item.data.password, url: item.data.url, hasTotp: Boolean(item.data.totpSecret) };
    }
    if (type === 'VM_GET_PASSWORD_REQUEST' && item?.data.type === 'login' &&
      normalize(item.data.username) === normalize(payload.identifier) && hostScore(payload.pageUrl, item.data.url) > 0) result = { status: 'ready', password: item.data.password };
    if (type === 'VM_LIST_CREDIT_CARDS_REQUEST') result = { status: 'ready', cards: this.items.filter(entry => entry.data.type === 'credit_card').slice(0, 8).map(entry => ({ itemId: entry.id,
      title: entry.data.title, cardholderName: entry.data.cardholderName, last4: entry.data.cardNumber.slice(-4), expMonth: entry.data.expMonth, expYear: entry.data.expYear })) };
    if (type === 'VM_LIST_IDENTITIES_REQUEST') result = { status: 'ready', identities: this.items.filter(entry => entry.data.type === 'identity').slice(0, 8).map(entry => ({ itemId: entry.id, title: entry.data.title, fullName: entry.data.fullName, email: entry.data.email || '' })) };
    if (type === 'VM_GET_CREDIT_CARD_REQUEST' && item?.data.type === 'credit_card') result = { status: 'ready', card: item.data };
    if (type === 'VM_GET_IDENTITY_REQUEST' && item?.data.type === 'identity') result = { status: 'ready', identity: item.data };
    if (type === 'VM_GET_TOTP_CODE_REQUEST' && item?.data.type === 'login' && hostScore(payload.pageUrl, item.data.url) > 0 && item.data.totpSecret) {
      const totp = await generateTotpCode(item.data.totpSecret);
      result = { status: 'ready', totpCode: totp.code, expiresIn: totp.expiresIn };
    }
    if (type === 'VM_PASSKEY_BRIDGE_REQUEST') result = { status: 'consent_required', candidates: [], message: 'Kasa passkey imzalama henüz desteklenmiyor.' };
    if (['VM_SAVE_LOGIN_REQUEST', 'VM_PREVIEW_LOGIN_SAVE_REQUEST'].includes(type)) {
      const credential = payload.credential;
      const candidates = this.items.filter(entry => entry.data.type === 'login' && normalize(entry.data.username) === normalize(credential.username) && hostScore(credential.url, entry.data.url) > 0);
      if (credential.itemId) {
        const selected = candidates.find(entry => entry.id === credential.itemId);
        if (!selected) return { ok: false, payload: { status: 'save_conflict' } };
        candidates.splice(0, candidates.length, selected);
      }
      if (candidates.length > 1) return { ok: false, payload: { status: 'ambiguous_accounts' } };
      const existing = candidates[0];
      const preview = { operation: existing ? 'update' : 'create', itemId: existing?.id || null, encryptedData: existing?.encryptedData || null };
      if (type === 'VM_PREVIEW_LOGIN_SAVE_REQUEST') return { ok: true, payload: preview };
      if (payload.expectedSave && (payload.expectedSave.operation !== preview.operation || payload.expectedSave.itemId !== preview.itemId || payload.expectedSave.encryptedData !== preview.encryptedData)) {
        return { ok: false, payload: { status: 'save_conflict' } };
      }
      const data = existing ? { ...existing.data, password: credential.password } : { type: 'login', title: credential.title || new URL(credential.url).hostname,
        url: credential.url, username: credential.username, password: credential.password };
      const encrypted = await encryptJSON(data, key);
      this.guard(epoch, key);
      const saved = await this.api(existing ? `/vault/${existing.id}` : '/vault', { method: existing ? 'PUT' : 'POST',
        body: { encryptedData: encrypted.ciphertext, iv: encrypted.iv, folderId: existing?.folderId || null } });
      this.guard(epoch, key);
      await this.sync();
      result = { status: existing ? 'updated' : 'created', itemId: saved.data.id };
    }
    this.guard(epoch, key);
    return { ok: true, payload: result };
  }
}

export const nativeVault = typeof chrome !== 'undefined' ? new VaultSession() : null;
