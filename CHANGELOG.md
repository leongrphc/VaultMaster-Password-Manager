# Changelog

Dates below describe recorded releases, not a fresh check of production.
Extension versions identify the Chromium and Firefox packages; web/API releases
are identified by Git SHA and provider deployment IDs in
[deployment evidence](DEPLOYMENT.md). Web/API package version `1.0.0` is not
a claim that every deployment is the same release.

## Unreleased

### Fixed

- Extension ZIP verification now rejects inconsistent local/central headers,
  incorrect CRC32 and decompressed lengths, incomplete compressed streams,
  invalid directory offsets/counts, truncated records and trailing data.
- Offline-gate tests exercise Windows directory junction rejection separately
  from file symlinks. Only Windows file-symlink creation denied with `EPERM`
  is skipped; Linux continues to exercise the file-symlink assertion.

### Documentation

- Added a [release runbook](docs/RELEASE_RUNBOOK.md) and this versioned record.
  P2-5 remains incomplete: independent review, the project-wide threat model
  and security policy still require separate work.

## 1.3.1 — 2026-10-06

Chromium and unsigned Firefox extension package patch; the deployed web/API
application retained the consolidated release below.

- Kept popup session controls and footer visible around one suggestions
  scroller, wrapped long item titles/domains, and collapsed unsupported-frame
  diagnostics.
- Preserved origin labels, protected selection and existing online-only
  authentication/fill behavior.
- Published replacement ZIPs for manual installation. Firefox packages remain
  unsigned; this is not store delivery or automatic installation.

Evidence: [popup layout](docs/EXTENSION_POPUP_LAYOUT.md) and
[deployment record](DEPLOYMENT.md#extension-popup-patch--2026-10-06).

## 1.3.0 — 2026-10-06

Extension packages shipped with the consolidated web/API release identified
by `aa582f4af519269d3cb0a5d060c2313b6574bb35`. This section summarizes the
consolidated delivery; individual features were implemented earlier.

- Added protected iframe/Shadow DOM filling and password-change workflows,
  import conflict review, cancellable health reports, and encrypted snapshot
  cleanup controls.
- Consolidated chunked backups, sensitive-action reauthentication, durable
  abuse limits, client key exchange and vault-stored passkey support.
- Added reproducible extension packaging, Firefox temporary-installation
  support and installation/security documentation.
- Kept offline extension unlock/fill blocked. Monitoring delivery, store
  signing/publication and independent security review remained outstanding.

Evidence: [consolidated deployment](DEPLOYMENT.md#verified-release--2026-10-06)
and [feature history](CURRENT_DEVELOPMENT_ROADMAP.md).

## Earlier releases

Older deployments are recorded in [deployment history](DEPLOYMENT.md).
This changelog does not infer missing tags, version numbers, release dates or
store approvals from commit dates.
