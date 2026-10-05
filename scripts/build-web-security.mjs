import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function buildWebSecurity(root) {
  const hashes = new Set();
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.name.endsWith('.html')) {
        const html = await readFile(path, 'utf8');
        for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
          if (!/\bsrc\s*=/i.test(match[1]) && match[2]) hashes.add(`'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
        }
      }
    }
  }
  await scan(root);
  if (!hashes.size) throw new Error('Static export has no inline script hashes');
  const connect = ["'self'", 'https://api.pwnedpasswords.com'];
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    const sentry = new URL(process.env.NEXT_PUBLIC_SENTRY_DSN);
    if (sentry.protocol !== 'https:') throw new Error('Sentry requires an HTTPS DSN');
    connect.push(sentry.origin);
  }
  const policy = ["default-src 'self'", `script-src 'self' ${[...hashes].sort().join(' ')}`,
    "script-src-attr 'none'", "style-src 'self' 'unsafe-inline' https://api.fontshare.com", "img-src 'self' data: blob: https://www.google.com",
    "font-src 'self' https://api.fontshare.com https://cdn.fontshare.com", `connect-src ${connect.join(' ')}`, "worker-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "frame-src 'none'"].join('; ');
  const path = join(root, '_headers');
  if (`  Content-Security-Policy: ${policy}`.length > 2000) throw new Error('CSP exceeds Cloudflare static header line limit');
  const headers = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
  await writeFile(path, headers.replace('/*\n', `/*\n  Content-Security-Policy: ${policy}\n`));
  return policy;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.VAULTMASTER_STATIC_EXPORT === '1') await buildWebSecurity(resolve('out'));
}
