# Firefox desktop support (P2-3)

The extension supports Firefox desktop **153+**, with local browser validation on
release Firefox 157.0.1, Linux, geckodriver 0.36.0. See the shared
[glossary](TERMINOLOGY.md) and [extension guide](../apps/extension/README.md).
This is a local candidate; no production deployment, AMO publication, signed
installation/update, hosted CI result or independent audit is claimed.

## Build, identity and installation

Use Node 22+ and pnpm 9.15.0 with the committed lockfile. Set the public
`VAULTMASTER_APP_URL` and `VAULTMASTER_API_URL` before both build and packaging
for another deployment, just as for Chromium. Never put tokens in build origins.

```sh
pnpm install --frozen-lockfile
pnpm --filter @vaultmaster/crypto build
pnpm build:extension:firefox
pnpm package:extension:firefox
pnpm verify:extension test-results/vaultmaster-firefox.zip
node scripts/package-extension.mjs test-results/firefox-second.zip firefox
cmp test-results/vaultmaster-firefox.zip test-results/firefox-second.zip
```

The Firefox build lives in `apps/extension/dist-firefox`. Its stable Gecko ID is
`vaultmaster@mozkan.com.tr`; it has no Chromium public key, Chrome minimum version
or service worker. A module event background page loads `background.js`. The
minimum version is deliberate: Firefox 153 introduced native document IDs for
navigation and message targeting. Older Firefox/ESR builds are unsupported; no
frame-ID-only fallback delivers secrets. See Mozilla's
[153 API changes](https://blog.mozilla.org/addons/2026/07/23/firefox-153-webextensions-api-updates/)
and [background manifest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).

For development, open `about:debugging#/runtime/this-firefox`, choose **Load
Temporary Add-on**, and select the built `manifest.json`, or verify/extract the
Firefox ZIP and select its manifest. Allow access to the intended HTTP(S) sites
in the extension's permissions. A temporary add-on disappears when Firefox
restarts: reinstall temporarily and sign in again. The Chromium archive is a
separate artifact; the existing web download still serves Chromium.

The ZIP uses the same allowlist, fixed timestamps, sorted entries, embedded
SHA-256 inventory and checksum verifier as Chromium. The checksum verifies bytes,
not publisher authenticity. Firefox Release requires Mozilla signing for normal
persistent distribution. No unsigned ZIP is presented as a permanent installation
or automatic update channel. Obtain AMO signing and verify the real signed
install/upgrade consent flow before distribution. Keep the Gecko ID and increase
the numeric version for future signed updates. Temporary same-ID replacement
checks retained local preferences and cleared session state, but cannot certify
AMO delivery. No signed Firefox XPI or AMO signing credentials were supplied in
this environment, so persistent signed installation, real permission/data-consent
dialogs and store update delivery cannot be verified here. See [Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

## Permissions, trust and sessions

Permissions remain `storage`, `contextMenus`, `alarms`, `idle`, `webNavigation`
and HTTP(S) host access. There is no `tabs`, clipboard, scripting, file access,
`<all_urls>` or web-accessible resource permission. Host access enables forms and
native document checks across sites; users may restrict it. Restricted browser
pages, file URLs, cross-origin ancestor chains, closed Shadow DOM and ambiguous
forms remain unsupported. Native document ID, current frame/ancestor URL, exact
origin and popup identity checks remain required. Explicit non-active lifecycle
values are denied; Firefox's current navigation APIs omit Chromium lifecycle
fields, so current native document lookup supplies the freshness check.

The manifest declares required `personallyIdentifyingInfo`, `authenticationInfo`,
`browsingActivity` and `websiteContent` data categories. Account email/authentication
hashes reach the configured API; approved vault uploads contain encrypted login,
site URL and form content. Encryption does not justify a `none` transmission
claim. No extension diagnostic upload was added. See Mozilla's
[data-consent definitions](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
The temporary automation explicitly grants HTTP(S) access; it does not test the
signed installation's displayed permission/data-consent dialogs.

Firefox uses promise APIs and browser-owned in-memory session storage, which is
not exposed to content scripts. Chromium still calls `setAccessLevel` with
`TRUSTED_CONTEXTS`; Firefox has no such method. The fallback is accepted only
with Firefox's native document API. Keys/tokens are cleared by browser restart
and extension replacement; five-minute absolute deadline, per-request checks,
alarm and idle guards remain. There is no offline unlock/fill. See
[session storage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session).

Native hardware WebAuthn account MFA and PRF local unlock have not been exercised
in this headless environment: no physical authenticator is available. TOTP-style
extension challenge handling is checked against a synthetic API. Do not add the
fixture's fixed `moz-extension` UUID to a production allowlist: Firefox assigns
installation-specific UUIDs, unlike the stable Gecko ID. Native MFA deployment
needs an exact reviewed origin and a separate physical-device check; use a
configured alternative factor meanwhile. Vault-stored ES256 passkeys are checked
with independent registration/assertion verification; required UV remains native.
No hardware protection, universal WebAuthn compatibility or Android support is
claimed. Edge and Firefox 153 itself were not manually tested.

## Checks and recovery

Build the static web app before browser/recovery checks. Install stock Firefox
153+ and geckodriver supporting `--allow-system-access` on PATH. The driver uses
Marionette/WebDriver with disposable profiles. Playwright's installed Firefox
150.0.2 lacks the required document APIs and cannot supply this check; its
Chromium extension runner is retained separately.

```sh
VAULTMASTER_STATIC_EXPORT=1 NODE_ENV=production pnpm build
pnpm build:extension:firefox
pnpm test:extension:firefox
pnpm test:web:browser
pnpm test:extension:browser
pnpm test:firefox:recovery
bash scripts/key-exchange-checks.sh
pnpm drill:backup-restore
pnpm test:backup-drill-safety
pnpm test:docs
```

Run database drills serially. They discard inherited database/telemetry/preload
settings, create their own Unix-socket PostgreSQL cluster with TCP disabled and
remove private profiles/dumps after cleanup. No deployment URL is accepted.
Firefox recovery includes all API regression tests, a real API/PostgreSQL web
scenario and the shared backup/restore verifier. Successful reports are generated
under ignored `test-results`; a failed run removes stale success evidence.

## Local verification — 6 October 2026

The [secret-free evidence](evidence/p2-3-firefox-checks.json) pins the tested
implementation and recovery results. Its revision is the pre-commit base; file
hashes identify the working tree that was tested.

- Frozen install, workspace typecheck/lint and static web/API/extension build passed.
  Lint retains two existing Next.js navigation warnings.
- 71 API, 119 web, 24 crypto and 83 extension unit/integration tests passed.
  Node 26 web tests used `NODE_OPTIONS=--no-experimental-webstorage` so jsdom
  supplies storage; browser checks ran without this flag.
- Both Firefox extension/package tests passed: synthetic MFA/sign-in, wrong/right
  unlock, real top-level/same-origin iframe/open Shadow DOM fill, foreign-frame
  denial, generated password/change approval, same-URL document replacement,
  SPA navigation, independently verified ES256 registration/assertion, protected
  click/cancel/native required-UV routing, sharing shortcut, unlocked same-ID
  version replacement retaining preferences and same-profile browser restart
  with fresh sign-in after temporary reinstallation. The popup is opened as an
  extension tab under WebDriver; actual toolbar layout/shortcut affordances and
  automatic event-page suspension are not separately exercised.
- Real Firefox web sharing and emergency approval/import checks passed against
  the isolated API/PostgreSQL cluster. Send cancellation created no grant; send,
  accept and decrypt required separate approval, import required explicit review,
  repeat delivery offered duplicate skipping, revocation stopped delivery, an
  emergency request had no envelope before owner approval, and expiry/lock/unlock
  checks passed. The synthetic wait was advanced only in the disposable database.
- Chromium's 24 extension checks, three web/proxy checks and dedicated sharing/
  emergency API/browser/recovery scenario passed. The existing Chromium runners
  and identity remain in use.
- Firefox and standalone personal/database recovery passed, comparing all 21
  public tables and verifying recovered passkey signatures, device-key wrapping
  and authenticated emergency ciphertext. Cleanup was verified. PostgreSQL
  recovery cryptography uses the shared Node verifier after the browser scenario;
  this does not claim a Firefox UI round-trip for downloading/uploading backup files.
- Dependency review in all/prod/dev scopes and the critical-advisory gate passed:
  two reviewed high advisory constraints remain, with zero unreviewed findings.
  Documentation, observability/privacy, historical rollback denial and all six
  drill isolation guards passed. The historical rollback artifact is still denied.
- Two fresh ZIPs per browser compared byte-for-byte and passed checksum/inventory
  policy. A separate HTTPS-origin Firefox pair also matched and verified.

The earlier API-regression process kill and failing Firefox dialog/label harness
checks were not treated as passes. Sequential retries and corrected WebDriver
dialog/visible-label handling produced the results above. External signing,
physical-authenticator, other OS/ESR/minimum-version and publication limitations
remain as described above; no local required check remains blocked.
