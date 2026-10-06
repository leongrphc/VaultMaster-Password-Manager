(() => {
  // Account MFA and local-unlock authenticators stay on the native browser
  // path. A vault-held key must not become its own locked-vault login factor.
  const APP_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
  if (APP_ORIGINS.includes(location.origin)) return;
  const credentials = navigator.credentials;
  if (!credentials || window.__vaultmasterPasskeyInjected) return;
  window.__vaultmasterPasskeyInjected = true;
  const SOURCE = 'vaultmaster-passkey-injected', CONTENT = 'vaultmaster-passkey-content';
  const encode = value => {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;
    if (!bytes || bytes.length > 4096) throw new TypeError('Invalid credential buffer');
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  };
  const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)).buffer;
  function serialize(operation, options) {
    const key = options.publicKey;
    const rpId = (operation === 'create' ? key.rp?.id : key.rpId) || location.hostname;
    // Leave unsupported native capabilities to the browser; never synthesize UV,
    // PRF, conditional mediation, platform attestation, or cross-origin results.
    if (!window.isSecureContext || window.top !== window || rpId !== location.hostname ||
      options.mediation === 'conditional' || options.mediation === 'silent' ||
      Object.keys(key.extensions || {}).some(name => operation !== 'create' || name !== 'credProps') ||
      (operation === 'create' ? key.authenticatorSelection?.userVerification : key.userVerification) === 'required' ||
      (operation === 'create' && ((key.attestation && key.attestation !== 'none') || key.authenticatorSelection?.authenticatorAttachment !== undefined ||
        !key.pubKeyCredParams?.some(param => param.type === 'public-key' && param.alg === -7)))) return null;
    const descriptors = values => {
      if (!values) return [];
      if (!Array.isArray(values) || values.length > 64 || values.some(value => value.type !== 'public-key')) throw new TypeError('Invalid credential descriptors');
      return values.map(value => encode(value.id));
    };
    return { origin: location.origin, rpId, challenge: encode(key.challenge),
      ...(operation === 'create' ? { user: { id: encode(key.user.id), name: key.user.name }, credProps: key.extensions?.credProps === true, excludeCredentials: descriptors(key.excludeCredentials) }
        : { allowCredentials: descriptors(key.allowCredentials) }) };
  }
  function credential(json) {
    const registration = Boolean(json.response.attestationObject);
    const response = Object.create(registration ? AuthenticatorAttestationResponse.prototype : AuthenticatorAssertionResponse.prototype);
    for (const [name, value] of Object.entries(json.response)) {
      if (['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'userHandle'].includes(name)) Object.defineProperty(response, name, { value: value ? decode(value) : null });
    }
    if (registration) {
      Object.defineProperties(response, { getTransports: { value: () => [] }, getPublicKey: { value: () => decode(json.response.publicKey) },
        getPublicKeyAlgorithm: { value: () => -7 }, getAuthenticatorData: { value: () => decode(json.response.authenticatorData) } });
    }
    const result = Object.create(PublicKeyCredential.prototype);
    Object.defineProperties(result, { id: { value: json.id }, rawId: { value: decode(json.rawId) }, type: { value: 'public-key' },
      response: { value: response }, authenticatorAttachment: { value: null },
      getClientExtensionResults: { value: () => structuredClone(json.clientExtensionResults) }, toJSON: { value: () => structuredClone(json) } });
    return result;
  }
  async function invoke(operation, options, native) {
    if (!options?.publicKey) return native.call(credentials, options);
    const request = serialize(operation, options);
    if (!request) return native.call(credentials, options);
    if (options.signal?.aborted) throw options.signal.reason || new DOMException('Cancelled', 'AbortError');
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, response) => {
        clearTimeout(timer); window.removeEventListener('message', listener); options.signal?.removeEventListener('abort', abort);
        if (error) {
          window.postMessage({ source: SOURCE, type: 'VM_PASSKEY_CANCEL', requestId }, location.origin); reject(error);
        } else { try { resolve(credential(response)); } catch { reject(new DOMException('Passkey response failed', 'NotAllowedError')); } }
      };
      const abort = () => finish(options.signal.reason || new DOMException('Cancelled', 'AbortError'));
      const listener = event => {
        if (event.source !== window || event.origin !== location.origin || event.data?.source !== CONTENT ||
          event.data.type !== 'VM_PASSKEY_RESULT' || event.data.requestId !== requestId) return;
        finish(event.data.response ? null : new DOMException('Passkey request cancelled or unavailable', 'NotAllowedError'), event.data.response);
      };
      const timer = setTimeout(() => finish(new DOMException('Passkey request expired', 'NotAllowedError')), Math.min(Math.max(options.publicKey.timeout || 60000, 1000), 60000));
      window.addEventListener('message', listener); options.signal?.addEventListener('abort', abort, { once: true });
      window.postMessage({ source: SOURCE, type: 'VM_PASSKEY_REQUEST', operation, requestId, request }, location.origin);
    });
  }
  const wrapped = Object.create(credentials);
  wrapped.create = options => invoke('create', options, credentials.create);
  wrapped.get = options => invoke('get', options, credentials.get);
  Object.defineProperty(navigator, 'credentials', { value: wrapped, configurable: true });
})();
