# P1-1: iframe and Shadow DOM autofill

Terminology: [shared glossary](TERMINOLOGY.md). User steps and current combined
limitations: [extension guide](../apps/extension/README.md). Historical verification
sections below describe their original feature scope.

Implemented on `feature/p1-1-advanced-autofill`, 6 October 2026. This is a
local implementation and regression record, not a deployment or independent
security audit. P1-2 password-change detection is outside this change.

## Supported policy

| Target | Decision |
| --- | --- |
| Active HTTP/HTTPS top-level document | Supported, subject to saved-host and scheme checks |
| HTTP/HTTPS iframe with the same exact origin as **every** ancestor | Supported; choose the frame's account in extension UI |
| Cross-origin iframe, including a same-origin grandchild behind a foreign ancestor | Unsupported, including forced fill; open its site separately in a top-level tab |
| `about:blank`, `srcdoc`, sandboxed opaque origin, data/file URL, inactive or missing document | Unsupported; no origin inheritance or fallback injection |
| Open Shadow DOM, including nested open roots | Login discovery and filling supported; focus chooses the form/root |
| Closed Shadow DOM | Unsupported; no attachShadow interception, MAIN-world hooks or privileged closed-root inspection |

Frame origin equality includes scheme, hostname and port. This is distinct
from the existing saved-login match rule: the saved hostname and its subdomains
may match, but parent domains, deceptive suffixes and unrelated hosts do not.
HTTP records may fill on HTTP or HTTPS; HTTPS records cannot fill on HTTP,
even after mismatch confirmation. Frame permission cannot be overridden by a
credential mismatch confirmation.

## Source and selection boundaries

The worker resolves active frames using Chrome `webNavigation.getAllFrames`.
It verifies the document lifecycle, document ID, parent frame/document chain,
HTTP/HTTPS URL and exact origin of every ancestor. Credential requests use
Chrome's `MessageSender.url`; a claimed origin cannot substitute another source.
When present, `MessageSender.origin` must agree, rejecting opaque senders.
The source document is checked again after asynchronous vault/API work before
returning secrets. Missing frame data, navigation races or browser API errors
fail closed.

The popup shows each frame's exact source origin and supported/unsupported
decision. Login, card and identity choices live in the extension popup, not in
page DOM, an embedded extension iframe or a page-owned shadow tree. Page scripts
cannot inspect, relabel or retarget these buttons. The page launcher has no
account ID or fill authority: even a real launcher click only opens the popup.
Toolbar, shortcut and context-menu entry points open that same selection UI.
This intentionally adds a protected selection step to the old one-click launcher.

Selections and mismatch confirmation require `event.isTrusted`. The worker
accepts target-selection requests only from its own `popup.html`, rechecks the
active tab and current frame policy, and delivers to the exact `documentId`.
The content listener accepts messages only from this extension's trusted
context (not another tab/content script). A random form token binds approval to
the currently selected input elements. Replacement forms and stale documents
are rejected rather than selecting a fallback frame/form. After asynchronous
vault retrieval, removed inputs or inputs moved to another root are rejected;
the chosen context is retained instead of following a changed focus.

The existing two-step login continuation remains: a prior explicit selection
can complete its password step within 20 seconds in the same tab/frame/origin,
with a fresh vault/API/domain check. Its storage contains item metadata, not a
password. Lock, expiry, tab/frame/origin separation and worker restart checks
remain covered. New unrelated fill decisions always need protected selection.

## Limitations

- Closed roots and cross-origin/opaque frames have no override. A frame can be
  invisible to discovery due to browser restrictions; it is not silently filled.
- Open-root discovery is for login fields. Pairing stays inside the nearest form
  or current root. Inputs split across different roots, slot-distributed forms,
  and dynamically attaching a shadow root without a detectable focus/activity
  may require focusing a field and reopening the popup. Existing card/identity
  detection is retained; it is not expanded to arbitrary shadow layouts.
- When multiple forms exist, focus the intended field before opening the popup.
  No password-change/new-password classification, generator, save/update redesign
  or SPA expansion is included. Existing submit-save prompts and consent-only
  passkey notices remain separate flows; this change protects autofill selection.
- The receiving page can read credentials after the user authorizes filling.
  Same-origin frames share that page's trust boundary; malicious same-origin
  code is not isolated by this policy. Page scripts can hide/spoof a launcher,
  but it cannot select an account or release a secret.
- `webNavigation` is the added permission, used for active document/ancestor
  verification and targeted selection. No navigation history/logging is added.
  `all_frames` injects per-document content scripts; origin fallback flags remain
  disabled. Chrome 127+ is required for ordinary `action.openPopup` support.
  The public extension identity key is unchanged. Store preparation remains P1-5.
- No production deployment is claimed. These historical P1-1 checks did not
  cover Firefox; current support and verification are documented in
  [Firefox support](FIREFOX_SUPPORT.md).

API references: [Chrome webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation),
[MessageSender](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender),
[document-targeted tab messaging](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-sendMessage),
[opening the action popup](https://developer.chrome.com/docs/extensions/reference/api/action#method-openPopup).

## Verification

Synthetic data only; extension API traffic uses a loopback fixture server and
form navigation is intercepted in real Chromium with the built MV3 extension.
The unit baseline was 50 passing extension tests before changes.

Final checks:

- 60 extension unit tests and 82 web tests passed.
- Real Chromium extension suite: 11 focused subtests plus the existing independent
  login/lock/unlock/worker-restart/two-step/encrypted-save regression (12 passes).
  Cases include same-origin and cross-origin frames, foreign ancestors, opaque
  documents, open/closed roots, deceptive hosts, forged content-world origins,
  HTTP record support, forced HTTPS downgrade rejection, synthetic/real clicks,
  protected card/identity selection, replaced forms and stale document approval.
- Three web Chromium/proxy checks passed.
- Workspace typecheck, lint and static production build passed. Lint retains
  two existing Next navigation warnings. Extension sources are JavaScript and
  have no separate TypeScript/lint script; JavaScript syntax checks also passed.
- Initial browser setup used an incorrect custom executable path; rerunning with
  installed Chromium resolved it. Chromium exposed an HTTP-only randomUUID
  failure; form tokens now use random bytes. No required check remains blocked.

Reproduce from the repository root:

```sh
pnpm --filter @vaultmaster/extension test
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @vaultmaster/web test
pnpm typecheck
pnpm lint
VAULTMASTER_STATIC_EXPORT=1 pnpm build
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 pnpm test:extension:browser
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 pnpm test:web:browser
```

The platform override is needed on this host's Ubuntu 26.04; Chromium is installed
in Playwright's default cache. These checks do not require a production account
or database. Rollback can replace the extension with the prior build; no API,
vault format or database migration is involved. A rollback restores the earlier
page-DOM selection boundary and removes iframe/Shadow DOM support.
