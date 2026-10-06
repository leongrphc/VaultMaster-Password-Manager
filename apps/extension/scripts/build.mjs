import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const srcDir = resolve(root, "src");
const distDir = resolve(process.argv[2] || resolve(root, 'dist'));
if (![resolve(root, 'dist'), resolve(root, '.package-build')].includes(distDir)) throw new Error('Invalid extension output directory');

if (!existsSync(srcDir)) {
  throw new Error("Source directory not found.");
}

const appUrl = new URL(process.env.VAULTMASTER_APP_URL || "http://localhost:3000");
if (appUrl.protocol !== "https:" && !(appUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(appUrl.hostname))) {
  throw new Error("VAULTMASTER_APP_URL must be HTTPS (or local HTTP for development).");
}
if (appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
  throw new Error("VAULTMASTER_APP_URL must be an origin without a path or credentials.");
}

const metadata = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const sourceManifest = JSON.parse(readFileSync(resolve(srcDir, 'manifest.json'), 'utf8'));
if (metadata.version !== sourceManifest.version) throw new Error('Extension package/manifest version mismatch');
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
// Explicit release allowlist: never recursively copy source or local artifacts.
for (const file of ['manifest.json', 'background.js', 'config.js', 'content.js',
  'form-detector.js', 'passkey-injected.js', 'popup.js', 'popup.html', 'popup.css', 'vault-session.js']) {
  cpSync(resolve(srcDir, file), resolve(distDir, file));
}
const cryptoDir = resolve(distDir, 'crypto');
mkdirSync(cryptoDir, { recursive: true });
for (const file of ['key-derivation.js', 'password-hash.js', 'vault-key.js', 'encryption.js', 'utils.js', 'totp.js']) {
  const compiled = readFileSync(resolve(root, '../../packages/crypto/dist', file), 'utf8');
  writeFileSync(resolve(cryptoDir, file), compiled.replace(/^\/\/# sourceMappingURL=.*(?:\r?\n|$)/gm, ''));
}
const apiUrl = new URL(process.env.VAULTMASTER_API_URL || (appUrl.protocol === 'https:'
  ? 'https://vaultmaster-api.onrender.com/api' : 'http://localhost:4000/api'));
if ((apiUrl.protocol !== 'https:' && !(apiUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(apiUrl.hostname))) ||
  apiUrl.username || apiUrl.password || apiUrl.pathname !== '/api' || apiUrl.search || apiUrl.hash) throw new Error('VAULTMASTER_API_URL must be HTTPS /api (or local HTTP).');
writeFileSync(resolve(distDir, 'config.js'), `export const API_URL = ${JSON.stringify(apiUrl.href)};\n`);
const builtManifest = JSON.parse(readFileSync(resolve(distDir, 'manifest.json'), 'utf8'));
builtManifest.content_security_policy = { extension_pages: `script-src 'self'; object-src 'none'; connect-src ${apiUrl.origin}; base-uri 'none'; frame-src 'none'` };
writeFileSync(resolve(distDir, 'manifest.json'), JSON.stringify(builtManifest, null, 2));

if (process.env.VAULTMASTER_APP_URL) {
  const origins = JSON.stringify([appUrl.origin]);
  const backgroundPath = resolve(distDir, "background.js");
  writeFileSync(backgroundPath, readFileSync(backgroundPath, "utf8")
    .replace('"http://localhost:3000/vault"', JSON.stringify(`${appUrl.origin}/vault/`))
    .replace('["http://localhost:3000/*", "http://127.0.0.1:3000/*"]', JSON.stringify([`${appUrl.origin}/*`])));
  const contentPath = resolve(distDir, "content.js");
  writeFileSync(contentPath, readFileSync(contentPath, "utf8")
    .replace('["http://localhost:3000", "http://127.0.0.1:3000"]', origins));
  const manifestPath = resolve(distDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://*/*", "https://*/*"];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

console.log("Extension build complete:", distDir, "App origin:", appUrl.origin);
