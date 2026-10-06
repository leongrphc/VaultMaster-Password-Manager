import { createHash, createPublicKey } from 'node:crypto';
export const releaseFiles = ['background.js', 'config.js', 'content.js', 'form-detector.js',
  'manifest.json', 'observability.js', 'passkey-injected.js', 'popup.css', 'popup.html', 'popup.js', 'vault-session.js',
  ...['key-derivation', 'password-hash', 'vault-key', 'encryption', 'utils', 'totp', 'passkey'].map(name => `crypto/${name}.js`)].sort();
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function extensionId(key) {
  createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
  return sha256(Buffer.from(key, 'base64')).slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
}
export function validateManifest(manifest) {
  if (manifest.manifest_version !== 3 || manifest.minimum_chrome_version !== '127' ||
      extensionId(manifest.key) !== 'cajnckjhhpbgephllmoaceolbifmnkoa' ||
      !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(manifest.version) || manifest.version.split('.').some(n => Number(n) > 65535) || manifest.update_url ||
      JSON.stringify(manifest.permissions) !== JSON.stringify(['storage', 'contextMenus', 'alarms', 'idle', 'webNavigation']) ||
      JSON.stringify(manifest.host_permissions) !== JSON.stringify(['http://*/*', 'https://*/*']) ||
      JSON.stringify(manifest.content_scripts) !== JSON.stringify([{ matches: ['http://*/*', 'https://*/*'], js: ['form-detector.js', 'content.js'], run_at: 'document_start', all_frames: true }, { matches: ['http://*/*', 'https://*/*'], js: ['passkey-injected.js'], run_at: 'document_start', all_frames: false, world: 'MAIN' }]) ||
      manifest.web_accessible_resources !== undefined ||
      manifest.background?.service_worker !== 'background.js' || manifest.background?.type !== 'module' ||
      manifest.action?.default_popup !== 'popup.html' ||
      manifest.externally_connectable || manifest.optional_permissions || manifest.optional_host_permissions) {
    throw new Error('Extension identity/permission/manifest policy mismatch');
  }
}
export function validateFiles(files) {
  if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify(releaseFiles)) throw new Error('Extension file allowlist mismatch');
  for (const [name, bytes] of files) {
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|AKIA)[A-Za-z0-9_]{16,}|sourceMappingURL\s*=/.test(bytes.toString())) {
      throw new Error(`Secret or source map marker in ${name}`);
    }
  }
  const manifest = JSON.parse(files.get('manifest.json'));
  validateManifest(manifest);
  const config = files.get('config.js').toString().match(/^export const API_URL = ("[^"\n]+");\n$/);
  if (!config) throw new Error('Unexpected API configuration');
  const api = new URL(JSON.parse(config[1]));
  if ((api.protocol !== 'https:' && !(api.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(api.hostname))) ||
      api.username || api.password || api.pathname !== '/api' || api.search || api.hash ||
      manifest.content_security_policy?.extension_pages !== `script-src 'self'; object-src 'none'; connect-src ${api.origin}; base-uri 'none'; frame-src 'none'`) {
    throw new Error('Extension API/CSP policy mismatch');
  }
}
