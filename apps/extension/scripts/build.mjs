import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const srcDir = resolve(root, "src");
const distDir = resolve(root, "dist");

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

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(srcDir, distDir, { recursive: true });

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
  manifest.host_permissions = ["<all_urls>"];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

console.log("Extension build complete:", distDir, "App origin:", appUrl.origin);
