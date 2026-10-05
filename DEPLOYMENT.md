# VaultMaster deployment

The web app runs as a Next.js static export using Cloudflare Workers Static Assets. The Express API
runs on Render Free and connects to a new Neon PostgreSQL database. Secrets belong
in Render environment variables, never in the web build or repository.

Current deployment:

- Web: https://vaultmaster.mozkan.com.tr
- API: https://vaultmaster-api.onrender.com/api
- Render service: `srv-db1touh42hec73e7qkg0`, Frankfurt, Free.
- Neon project: `young-shape-45320139`, AWS Frankfurt, organization Free.
- Cloudflare Worker: `vaultmaster-web`, configured in `wrangler.web.jsonc`.
- Deployment branch: `deploy/free-hosting` (Render auto-deploys this branch).

The Pages fallback is `https://vaultmaster-mozkan.pages.dev`. Its hostname was
unreachable from the local network during setup, so the primary deployment uses
the existing `mozkan.com.tr` zone. Wrangler creates the custom-domain DNS record
and certificate for the Worker; no new domain purchase is needed.

## API

Use `render.yaml` to create the service from this repository. Supply:

- `DATABASE_URL`: Neon's pooled PostgreSQL connection URL with TLS.
- `DATABASE_DIRECT_URL`: Neon's direct connection URL with TLS.
- `CORS_ORIGIN`: the primary HTTPS production origin first, without a trailing slash.
  Current value: `https://vaultmaster.mozkan.com.tr,https://vaultmaster-mozkan.pages.dev`.

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
$env:NEXT_PUBLIC_API_URL = 'https://vaultmaster-api.onrender.com/api'
pnpm --filter @vaultmaster/web... build
npx wrangler deploy --config wrangler.web.jsonc
```

Changes to the API URL require rebuilding the web app. The web deployment is
currently a direct upload: pushing to GitHub redeploys the API, but does not
automatically publish a new web build. Run the build and Wrangler commands above
for web changes. To publish the optional Pages fallback, run
`npx wrangler pages deploy apps/web/out --project-name vaultmaster-mozkan --branch main`.

## Extension

```powershell
$env:VAULTMASTER_APP_URL = 'https://vaultmaster.mozkan.com.tr'
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


## Session security regression checks

The web vault's master key stays in memory. Client navigation after login retains
the unlocked vault; a full page reload restores authentication with the vault
locked. Legacy plaintext session keys are removed. Offline snapshots and lock
verifiers remain encrypted. Delayed loads, saves, downloads and unlocks are
invalidated when their unlocking session changes.

```powershell
pnpm --filter @vaultmaster/web test
$env:VAULTMASTER_STATIC_EXPORT = "1"
pnpm --filter @vaultmaster/web build
pnpm test:web:browser
```

The browser test serves the static export locally and intercepts all API calls;
it does not use production accounts or data.


API session tokens now carry a device ID, token purpose, issuer, audience and a
random JWT ID. Protected requests check that device's current authorization;
logout, device revocation and refresh-token reuse block its next API request.
A master-password change revokes other devices. Deploying this token format
requires existing sessions to sign in again. No database migration is needed.
