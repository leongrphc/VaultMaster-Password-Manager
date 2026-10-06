# Extension popup layout — 1.3.1

The popup uses a 400 × 600 px shell, with a 360 px narrow layout. The active
hostname, vault state/actions and footer stay outside the suggestions scroller.
Login and unlock show their form and status without a redundant empty-item panel.
Long titles and domains wrap inside their card; the fill action keeps its width.
Repeated per-card explanation is replaced by the shared no-submit instruction.

Unsupported frames and non-main frames without a form remain available under a
collapsed diagnostic disclosure, after usable form targets. No frame's supported
state is changed. Per-frame origin labels remain visible, suggestions retain
their hostname tags, and no selection or force-fill approval is automated.

The presentation diff was reviewed against the offline-disabled boundary:
only popup layout/rendering and extension version metadata changed. Native
authentication, expiry, sync, storage, message authorization, origin/document
checks and trusted-click handlers retain their existing behavior. The two
affected source fingerprints were refreshed after this review; P2-4 stays
blocked, `enabled: false`, with no approval or offline capability added.

Visual verification uses synthetic data with 184 unsupported about:blank frames,
two matching items, login and locked states at 360/400 px. The outer document has
no horizontal/vertical overflow, footer actions remain visible and expanding
diagnostics scrolls within the suggestion area. Existing real MV3 regression
checks cover login, MFA, lock/unlock, protected fills, frame/Shadow DOM handling,
password changes, passkeys and synthetic-click denial.

On this Windows host the offline-gate symlink fixture cannot create a file
symlink without OS privileges (EPERM). The real disabled invariant and other
gate cases run locally; full symlink coverage belongs to the existing Linux CI.
No security gate is bypassed and no new symlink privilege is requested.
