# P1-2: password-change autofill

Implemented on `feature/p1-2-password-change-autofill`, 6 October 2026.
Synthetic local verification only; no production deployment or independent audit.
P1-3 is outside this change.

## Behavior and security

- `autocomplete` tokens distinguish current and new passwords. Explicit
  current/old/new/confirmation hints (including labels) provide a fallback.
  A single unmarked password retains ordinary login behavior. Multiple unmarked
  fields or multiple current-password fields are ambiguous: no password fill,
  generation or submit snapshot. Field order alone never determines a change.
- Saved account selection fills the current password only. New/confirmation
  fields never receive that password, including the existing two-step login
  continuation. New-only forms can receive a username, but do not start an
  automatic password continuation. Account metadata, without a password, binds
  forms without usernames to the account explicitly selected on that route.
- The protected extension popup offers a 24-character cryptographic generator
  for identified new-password fields. A trusted popup click is required. It
  fills matching empty new/confirmation fields, never the current field, and
  refuses to overwrite values or truncate to a shorter `maxlength`. Uniform
  random sampling uses uppercase/lowercase letters, digits and `-`/`_`, with
  rejection of candidates missing a category. Generation does not save or
  submit credentials, and does not display the password in page-owned controls.
- A native submit following a trusted submit-button click or Enter snapshots
  the new password when present, otherwise the login password. All identified
  new/confirmation fields must be nonempty and equal. Synthetic submit events
  and standalone script `requestSubmit()` do not capture credentials. Locked
  vaults do not retain new drafts. Snapshots remain encrypted in trusted Chrome
  session memory for at most two minutes; no plaintext password is persisted.
- Save prompts explicitly distinguish **create** from **update**, show the
  source origin and masked username, and require a trusted confirmation click.
  Dismiss/never-save also require trusted clicks. No write occurs on submission,
  generation, navigation, or synthetic confirmation. The preview is frozen;
  confirmation resyncs and rejects changed ciphertext, deleted accounts, or a
  create decision that became an update. An explicitly selected account resolves
  duplicate host/username matches; otherwise ambiguity is rejected. Updates
  retain URL, notes, TOTP and unrelated fields. Failures retain the draft until
  dismissal/expiry, and a conflict requires a new submission/approval.
- Browser `webNavigation` history/fragment events cover pushState, replaceState,
  hash and back/forward navigation without page-world History monkeypatches.
  Route changes reset discovery/cache/suppression and invalidate selection
  tokens even when the same elements survive. SPA submit handlers can prevent
  navigation and show a success route while the snapshot/prompt survives.
- The [P1-1 policy](ADVANCED_AUTOFILL_SECURITY.md) remains enforced: browser
  document IDs and exact source origin; same-origin ancestor chains; open roots;
  no cross-origin/opaque iframe or closed-root override; protected popup
  selection; host matching and HTTPS downgrade protection. Chrome may retain
  the original sender path after same-document navigation. The worker now
  resolves the current URL from the matching browser frame/document and still
  requires the sender's origin to agree. Claimed URLs cannot replace that source.
  Form/route/hint changes are rechecked after asynchronous secret retrieval.
  No manifest permission, host-match rule, API or encryption format changed.

## Limitations

- Ambiguous forms need autocomplete or recognizable hints. Inputs must be
  visible and in the selected form/root; split-root and closed-root layouts
  remain unsupported. Focus the intended form before opening the popup.
- A change form without a username needs a current-account selection on that
  route. The extension does not infer an account from an old password or use
  a previous route's selection. Unselected duplicate accounts require manual
  vault editing; no duplicate-resolution UI is added.
- Generation has a fixed length/alphabet. Site-specific password patterns may
  reject it; custom generator settings are outside scope. Reactive remounts or
  field changes during input events fail closed and may leave a partially
  filled form; inspect the form and reopen the popup.
- Capture requires an actual HTML form submit, within 1.5 seconds of its trusted
  submit action. Fetch-only buttons, delayed custom handlers, `form.submit()`,
  and noncomposed custom shadow events are unsupported. A submit does not prove
  the site accepted the change: confirm only after checking the site's result.
  Existing page-owned save prompts remain susceptible to page hiding/relabeling;
  their confirmation handlers require trusted clicks and cannot retarget the
  frozen draft. Autofill/generator selection stays in extension UI.
- The resync/ciphertext check detects changes observed before the confirmed
  write. The existing vault API has no atomic compare-and-swap; a concurrent
  remote write between that check and PUT can still race. This feature does not
  claim transactional cross-client conflict resolution or begin P1-3.
- Same-origin page code can read passwords after authorized filling and can
  modify its own forms. Generated passwords are not escrowed: save after the
  site's success, or retain them yourself before leaving the form.

## Verification

Baseline: 60 extension tests passed before edits. Final checks, using disposable
loopback API fixtures and intercepted synthetic sites in real Chromium:

- 72 extension unit tests: classification, source verification, protected
  generation, preview requirements, lock behavior, conflicts/duplicates, and
  existing login/two-step/session/encryption regressions.
- 82 web tests.
- 21 real Chromium extension checks (20 subtests plus the full session flow):
  current/new separation, matching generation and no overwrite, synthetic and
  trusted clicks, manual changes without usernames, save/update and concurrent
  edit prompts, SPA submit plus push/replace/hash/back changes, multiple new and
  ambiguous fields, same-origin frames/open roots, closed/foreign/opaque frame
  denial, phishing and forged capture/generation origins, HTTPS downgrade,
  stale forms/documents, lock/unlock/restart, ordinary login and encrypted save.
- Three Chromium web/proxy checks.
- Workspace typecheck, lint and static production build; JavaScript syntax and
  whitespace checks. Extension JavaScript has no separate TypeScript/lint task.
  Lint retains the two existing Next navigation warnings.

Reproduce:

```sh
pnpm --filter @vaultmaster/extension test
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @vaultmaster/web test
pnpm typecheck
pnpm lint
VAULTMASTER_STATIC_EXPORT=1 pnpm build
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 pnpm test:extension:browser
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 pnpm test:web:browser
```

The platform override selects installed Chromium on this Ubuntu 26.04 host.
Initial fixture failures exposed invalid email test data, identity-hint overlap,
SPA sender-path behavior, and tests racing popup loading; corrected runs passed.
No required local check remains blocked. Rollback replaces the extension build;
there is no server/database migration. P1-3 remains unstarted.
