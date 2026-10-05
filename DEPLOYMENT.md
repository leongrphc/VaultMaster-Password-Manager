# VaultMaster deployment

The web app runs as a Next.js static export on Cloudflare Pages. The Express API
runs on Render Free and connects to a new Neon PostgreSQL database. Secrets belong
in Render environment variables, never in the web build or repository.

## API

Use `render.yaml` to create the service from this repository. Supply:

- `DATABASE_URL`: Neon's pooled PostgreSQL connection URL with TLS.
- `DATABASE_DIRECT_URL`: Neon's direct connection URL with TLS.
- `CORS_ORIGIN`: the exact HTTPS Pages production origin, without a trailing slash.

Render generates the JWT and application encryption secrets. Keep those values
stable across deployments. `PORT` is supplied by Render. Startup applies committed
Prisma migrations before serving requests. `/api/health/ready` checks the database.

The initial migration is for a **new, empty database**. An existing database needs
its migration history baselined before deploying; do not reset existing vault data.
Render Free sleeps after inactivity, so the first API request may take longer.

## Web

From the repository root in PowerShell:

```powershell
$env:VAULTMASTER_STATIC_EXPORT = '1'
$env:NEXT_PUBLIC_API_URL = 'https://YOUR-API.onrender.com/api'
pnpm --filter @vaultmaster/web... build
npx wrangler pages deploy apps/web/out --project-name YOUR-PAGES-PROJECT --branch main
```

Use the actual Render service URL, not a guessed hostname. Changes to the API URL
require rebuilding the web app. For Cloudflare Git builds, set the two variables
above, build using `pnpm --filter @vaultmaster/web... build`, and publish
`apps/web/out` from the repository root.

## Extension

```powershell
$env:VAULTMASTER_APP_URL = 'https://YOUR-PAGES-PROJECT.pages.dev'
pnpm --filter @vaultmaster/extension build
```

Load `apps/extension/dist` as an unpacked extension in Chrome/Edge. Keep an unlocked
web vault tab at that exact origin. The extension does not yet unlock independently.
An origin change also requires rebuilding the extension and updating API CORS.
WebAuthn credentials and browser local unlock are tied to their original origin.

## Verification

Check API readiness, register a disposable account, create a login item, lock and
unlock the vault, and check autofill on a controlled test site. Delete the disposable
account afterward. Test the real browser extension in addition to automated tests.
