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

Login submissions are captured before navigation. A pending save is encrypted
with a random AES-GCM key in extension-only `chrome.storage.session`; its session
key is stored alongside the ciphertext to survive service-worker restarts. This
is transient browser-session protection, separate from the vault's master-key
encryption. The content script receives only a draft ID and display metadata.
Drafts expire after two minutes and are removed on save, dismissal, expiry checks,
tab closure or browser exit. Confirmation requires the original tab, frame and
origin, a real user click, and an unlocked vault. A failed save remains retryable.
Both web-bridge response naming conventions are supported.

Secret requests require an active HTTP(S) content-script document and use Chrome's
`MessageSender.url`, rather than trusting an origin in the request. Inline login,
card, identity and forced-fill buttons ignore synthetic page-script clicks.
HTTPS logins cannot automatically match an HTTP page; any override still needs
an explicit trusted click on the security warning. These safeguards are covered
by the real-extension browser test as well as unit tests.
