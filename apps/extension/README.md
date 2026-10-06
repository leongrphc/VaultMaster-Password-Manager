# VaultMaster Autofill extension

The extension has its own encrypted vault session. Sign in and unlock from its
popup; a VaultMaster web tab is not required. Autofill discovers supported forms,
but filling needs your approval. Filling, submitting, saving and updating are
separate actions. See the shared [glossary](../../docs/TERMINOLOGY.md) for English
and Turkish UI terms, including **kasa**, **öğe**, **giriş bilgisi**, **otomatik
doldurma**, **Doldur**, **Kaydet**, **Şifreyi Güncelle**, **Kasayı Kilitle** and
**Kasanın Kilidini Aç**.

## Setup and installation

Chrome 127+ is required. Edge 127+ uses the unpacked Chromium installation path,
but manual Edge release validation remains outstanding. Firefox, file URLs,
browser-internal/restricted pages and extension offline unlock/fill are unsupported.
Use a synthetic account and disposable profile for development/release checks.

From the repository root, with the committed lockfile, Node 22 and pnpm 9.15.0:

```sh
pnpm install --frozen-lockfile
pnpm --filter @vaultmaster/crypto build
pnpm --filter @vaultmaster/extension build
```

The development API defaults to `http://localhost:4000/api`. For another deployment,
set public `VAULTMASTER_APP_URL` and `VAULTMASTER_API_URL` before building; the API
URL must end in `/api`. Use HTTPS outside loopback development. These are public
origins, never tokens or server secrets. See [deployment](../../DEPLOYMENT.md) for
API CORS and the exact `WEBAUTHN_EXTENSION_ORIGINS` configuration. Rebuild after
origin changes; the packaged CSP restricts connections to the configured API.

1. Open `chrome://extensions` (or `edge://extensions`), enable Developer mode,
   choose the browser's **Load unpacked** action and select `apps/extension/dist`.
   For a reviewed ZIP, verify its checksum/inventory, extract to a stable directory
   and load that directory. Never load the source directory or the ZIP itself.
2. Confirm identity/version and permission warnings in browser details. Pin the
   toolbar icon. A ZIP/unpacked build is a manual installation, not store delivery.
3. Open the popup and choose **Giriş Yap** with your VaultMaster email, master
   password and configured TOTP/recovery code or security key. A second-factor
   challenge may require entering the master password again. The raw master
   password is not sent to the server; a client-derived authentication hash is.
4. For an authenticated locked session choose **Kasanın Kilidini Aç**. Open the
   target HTTP(S) site, focus the intended form, then reopen the popup. Review the
   source origin and select a saved login with **Doldur**. The page launcher,
   context menu and Ctrl+Shift+V (Command+Shift+V on macOS) open protected selection.
5. Use **Kasayı Kilitle** to remove usable keys/plaintext and pending fill/save
   state. **Çıkış Yap** ends the extension session. The extension locks five
   minutes after login/unlock (an absolute deadline, not an inactivity timer),
   and on device lock. Browser restart or extension reload/update requires a
   fresh sign-in. Web and extension sessions are independent; do not assume
   locking one locks the other.

There is no separate extension options page (`options_ui`/`options_page` are absent
from the manifest). Browser details control site access; the popup controls the
session. Web Settings manages imports, exports and account security. Web auto-lock
settings do not change the extension's fixed five-minute deadline.

## Permissions rationale

| Manifest capability | Why it is needed |
| --- | --- |
| `storage` | Local ciphertext/preferences and trusted, memory-only session state. |
| `contextMenus` | A user-invoked entry point to protected fill selection. |
| `alarms` | Lock-deadline and session/badge checks, alongside per-request checks. |
| `idle` | Lock the vault when the device locks; not activity-history collection. |
| `webNavigation` | Verify active documents, exact frame/ancestor origins and invalidate stale SPA selections. |
| `http://*/*`, `https://*/*` host access | Detect forms/capture trusted submissions on user-chosen sites and reach the configured API. Broad access may trigger browser warnings. |
| `all_frames` HTTP(S) content scripts | Discover forms per document; injection does not grant permission to fill a foreign frame. |
| `passkey-injected.js` web-accessible resource | Consent-only WebAuthn metadata notice; no vault keys or third-party passkey signing. |

Site-access controls can withhold access, preventing detection/fill; reload the
target after changing them. This release does not require file/incognito access.
No browsing history is stored. Permission minimization, CSP, identity and packaging
checks are detailed in the [release checklist](../../docs/EXTENSION_STORE_PREPARATION.md).

## Trust, origin and form limitations

Check the exact destination before filling: the receiving page can read filled
credentials. Malicious same-origin code is within that page's trust boundary.
Selection/generation occurs in the protected extension popup with trusted clicks;
a page-owned launcher cannot authorize a secret. Browser-verified document IDs,
source origins and form tokens are rechecked after asynchronous retrieval. Missing,
stale or unsupported targets fail closed; reopen the popup after navigation.

Saved-host matching permits the saved hostname and its subdomains, not parent
hosts, deceptive suffixes or unrelated hosts. Frame origin equality separately
requires scheme, hostname and port to match **every ancestor**. HTTPS logins
cannot fill on HTTP, even with mismatch confirmation/forced fill. A mismatch
confirmation cannot override a frame, document, lock or HTTPS downgrade rejection.
HTTP-saved logins can fill on HTTP/HTTPS; prefer a controlled HTTPS destination.

Same-origin HTTP(S) iframe ancestor chains and nested **open Shadow DOM** login
forms are supported. Cross-origin frames, same-origin grandchildren behind foreign
ancestors, opaque/sandboxed frames, `about:blank`, `srcdoc` and **closed Shadow DOM**
are unsupported with no override. Open-root inputs must remain in the selected
form/root; split-root/custom layouts may need manual entry. Card/identity detection
is retained, without a promise to support arbitrary shadow layouts. Multiple forms
need explicit focus/selection. See the [autofill security policy](../../docs/ADVANCED_AUTOFILL_SECURITY.md).

A two-step login can continue a prior selection for 20 seconds in the original
tab/frame/exact origin, including full-page navigation. Only selection metadata
is retained; the password is retrieved again with fresh API/lock checks. This is
not general unattended filling. The API must be reachable for sign-in, unlock,
sync and secret fills; persistent ciphertext does not enable offline extension use.

## Password changes, save and update

1. Focus a supported password-change form and select the intended saved login in
   the popup. Only the current-password field receives the saved password. New
   and confirmation fields never receive that saved password.
2. Enter the new password yourself or use **Yeni Şifre Üret (24 karakter)** in the
   popup. Generation fills matching empty new/confirmation fields, does not
   overwrite existing values, and neither submits nor saves. Site length/pattern
   constraints may reject it; inspect the form before proceeding.
3. Submit using an actual button click or Enter. All identified new/confirmation
   fields must agree. A trusted HTML submit can create an encrypted two-minute
   draft; script-only/custom fetch submissions and ambiguous fields may not.
4. Check whether the site accepted the change. Only then approve **Şifreyi
   Güncelle** for an existing login or **Kaydet** for a new login. Submission or
   a success route alone never writes the vault. Dismiss or choose never-save
   when inappropriate. Generation is not password escrow; retain the new value
   yourself if you must leave before saving.

Save previews show source origin and masked username. Draft ciphertext and its
random AES-GCM session key live together in trusted `chrome.storage.session`,
separate from master-key vault encryption; this protects transient browser-session
storage, not a compromised browser. Drafts expire after two minutes and are cleared
on save/dismissal, expiry checks, tab closure, lock/logout or browser exit. The
content script receives only a draft ID/display metadata. Failed saves remain
retryable until expiry. Confirmation requires the original tab/frame/origin,
unlocked vault and a trusted click.

Updates resync/check the previewed ciphertext and retain unrelated fields (URL,
notes, TOTP). A changed item needs a new submission/approval. There is no atomic
cross-client compare-and-swap; a remote write between check and write can race.
Page-owned save prompts can be hidden/relabelled by page code, although their
handlers cannot retarget the frozen draft. SPA route changes invalidate fill
approvals; a trusted-submit draft may survive the site's success route. See the
[password-change policy](../../docs/PASSWORD_CHANGE_AUTOFILL.md) for custom-form,
username-free, duplicate-account and concurrency limits.

## Import and export

Use the unlocked **web vault → Settings → İçe Aktar / Dışa Aktar**; the extension
has no file import/export UI. After a web import/update, choose **Yenile** in the
unlocked popup to sync. CSV and legacy encrypted JSON cover supported active items;
portable encrypted full backups additionally preserve folders, trash, history and
attachments. Legacy JSON depends on the original vault key; a portable backup uses
its own backup password. Plaintext CSV/selected JSON exposes secrets: handle the
file privately and remove it when no longer needed. Explicit exports require
online sensitive-action reauthentication, including configured MFA.

Review before approval: exact duplicates skip automatically; conflicts default
to skip, with explicit keep-both or eligible update. Import update replaces the
**whole supported payload**, tags/folder/favorite, with a separate overwrite
checkbox; old content is retained in encrypted history. Incoming history/attachments,
trash and ambiguous destinations cannot be overwritten. Stale review must be
cancelled/recreated; retrying the same approved transport is receipt-bound rather
than duplicating a commit. No automatic field merge or deletion is promised.
See [import conflicts](../../docs/IMPORT_CONFLICT_RESOLUTION.md) and
[sensitive-action security](../../docs/SENSITIVE_ACTION_SECURITY.md).

## Health-report privacy

The health report is in the web UI, not the extension. Strength/reuse analysis is
local. Breach checking is opt-in: it sends five hexadecimal SHA-1 prefix characters
to HIBP, with padding requested and cookies/referrer omitted. The password, full
hash/suffix, vault key and item metadata are not sent. HIBP still sees the prefix,
public IP and timing; this is not anonymity or proof of password safety.

Report rows show temporary item numbers, never credentials or titles/URLs. Results
are memory-only; optional telemetry excludes provider URL breadcrumbs. Cancel
stops further work/discards partial results but cannot recall sent prefixes, erase
provider logs or guarantee memory erasure. Navigating away/locking invalidates the
run. See [health-report privacy](../../docs/HEALTH_REPORT_PRIVACY.md).

## Troubleshooting

| Symptom | Check / next step |
| --- | --- |
| No suggestions or launcher | Unlock the extension; verify HTTP(S), browser site access and saved URL. Reload, focus the intended visible form, reopen the popup. Unsupported frames/closed roots require manual entry or a top-level site tab. |
| Fill rejected after navigation | Selection/form/document became stale. Reopen and review the new target; do not bypass origin checks. |
| Server unavailable / sync fails | Check network and the configured API origin/CSP/CORS. The extension cannot fill offline; retry **Yenile** once connected. |
| Security-key sign-in fails | Verify configured MFA and exact extension ID in API `WEBAUTHN_EXTENSION_ORIGINS`; use another configured factor, never a wildcard origin. |
| Unexpected lock / sign-in after restart | Five minutes is an absolute extension deadline. Reload/update/browser restart clears session memory; worker restart can retain only unexpired session state. |
| No save prompt | Check trusted HTML submit, equal new/confirmation values, unlocked vault and never-save host preference. Custom handlers/ambiguous forms may require manual web editing. |
| Update conflict / expired draft | Check the site result, resubmit if appropriate and obtain a new preview/approval. Never assume a failed save changed the vault. |
| Generated password rejected | Inspect site constraints; generation has a fixed alphabet/length. Enter a suitable password manually and save after site success. |

When reporting a problem, provide version, browser/OS, fixed error text and a
synthetic reproduction. Redact site/account metadata. Never share passwords,
tokens, recovery codes, keys, real drafts, vault dumps, populated form screenshots
or unreviewed network/storage logs. This guide adds no diagnostic upload feature.

## Release and update guidance

Version 1.3.0 is a local candidate. No store upload, publication, approval,
automatic store update, production deployment or independent audit is claimed.
The ZIP is a manual unpacked channel; a checksum detects changes, not publisher
authenticity. For packaging, checksum/inventory verification, exact store-ID review,
manual Edge prerequisites and submission materials, follow the
[installation/update checklist](../../docs/EXTENSION_STORE_PREPARATION.md).

For a manual update, verify the new archive, replace contents in the **same stable
unpacked directory**, keep the public identity key, then Reload. Do not remove the
extension to update; removal/reinstall can lose local preferences/ciphertext.
Confirm unchanged ID, increased version, retained local data, cleared session and
fresh sign-in/fill in a disposable profile first. Store identity/delivery remains
unverified until an operator checks a real dashboard item and its update channel.
Rollback releases need a higher version for store clients and compatible reviewed
code; never weaken origin/consent boundaries or reset vault data as troubleshooting.

## Regression and documentation checks

From the repository root (build before browser checks; run packaging serially):

```sh
pnpm --filter @vaultmaster/extension test
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @vaultmaster/web test
pnpm test:docs
pnpm typecheck
pnpm lint
VAULTMASTER_STATIC_EXPORT=1 pnpm build
pnpm exec playwright install chromium
pnpm test:extension:browser
pnpm test:web:browser
```

Browser tests use the real MV3 extension in isolated Chromium and synthetic local
API/form fixtures with real encryption; they require no live account/database.
Extension JavaScript has no dedicated lint/typecheck task; syntax checks and its
unit/browser suites cover it. [P1-6 verification](../../docs/EXTENSION_DOCUMENTATION.md)
records actual results and limits; no hosted CI or live provider/store test is implied.
