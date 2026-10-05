# VaultMaster Autofill Extension

Build:

```bash
pnpm --filter @vaultmaster/extension build
```

Load unpacked extension from `apps/extension/dist`.

Behavior:

- User types the email/username manually on the target site
- Extension detects a matching VaultMaster login for that site
- Extension asks whether the password should be filled
- Password is filled only after user approval

Requirements:

- Keep a VaultMaster web tab open at `http://localhost:3000`
- Keep the vault unlocked while using autofill

Regression checks (from the repository root):

```bash
pnpm --filter @vaultmaster/extension test
pnpm exec playwright install chromium
pnpm test:extension:browser
```

The browser checks load the actual Manifest V3 extension in an isolated Chromium
profile and use a mocked vault bridge. They need no live database or account.
Autofill retrieves credentials on demand and rechecks the vault lock for each
fill. Multi-step logins retain only selection metadata for 20 seconds, bound to
the original tab, frame and exact origin; the password is requested again when
the password field appears, including after a full-page navigation.
