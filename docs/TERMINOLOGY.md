# VaultMaster terminology

This is the single glossary for current extension/web UI, user documentation and
release/security explanations. English documentation uses the English column;
Turkish UI uses the Turkish column (normal grammatical inflections and title case
are allowed). Identifiers, protocol fields, browser-owned labels and historical
verification records are not renamed. VaultMaster Autofill remains the product name.

| English | Turkish UI | Meaning and usage |
| --- | --- | --- |
| vault | kasa | Encrypted collection of items. Use **Kasa Kilitli** / **Kasa Kilidi Açık** for state; do not mix `Vault` into Turkish state text. |
| item | öğe | Any saved login, card, identity, note or passkey metadata. Use **Yeni Öğe**, not “record/kayıt” as a competing generic item label. “Kayıt ol” still means account registration. |
| login | giriş bilgisi | A saved username/password item. **Giriş Yap** means sign in to an account; it does not name the saved item. |
| autofill | otomatik doldurma | The feature that discovers supported forms and offers approved filling. It does not promise unattended filling or submission. |
| fill | doldur | Put approved values into the selected form. **Doldur** does not save an item or submit the site form. |
| save | kaydet | Create a new vault item after approval. **Kaydet** does not prove the target site accepted a login/password change. |
| update | güncelle | Change an existing item after approval. Use **Şifreyi Güncelle** for an extension password update. Import update replaces the full reviewed payload; it is not a field merge. |
| import | içe aktar | Review a supported file in the unlocked web vault, then approve adding/updating items. The extension does not import files. |
| export | dışa aktar | Prepare/download a file from the web vault. Explicitly distinguish encrypted backups from plaintext CSV/JSON. The extension does not export files. |
| lock | kasayı kilitle | Clear usable vault keys/plaintext and pending extension decisions. Lock is distinct from signing out and does not delete encrypted server data. |
| unlock | kasanın kilidini aç | Restore access to encrypted items in an existing authenticated session. Use **Kasanın Kilidini Aç**, not “Kasayı Aç”; opening the web app is **VaultMaster'ı Aç**. |

A password is **şifre**, and the master password is **ana şifre**. An origin is
**köken** (scheme, hostname, port); a hostname is **alan adı**. Do not use “same
site” to imply same origin. A health/report row uses **Öğe 1**, an ephemeral number,
not an item title, ID or proof that an item is safe.

Security copy must keep these distinctions: sign in/unlock, fill/submit,
save/update, encrypted/plaintext export, same-origin/saved-host matching, and
prepared/downloaded/published release. No terminology edit changes authorization,
lock deadlines, encryption, draft lifetime, consent, matching or conflict policy.

Read the [extension guide](../apps/extension/README.md),
[release checklist](EXTENSION_STORE_PREPARATION.md),
[autofill boundaries](ADVANCED_AUTOFILL_SECURITY.md),
[password-change policy](PASSWORD_CHANGE_AUTOFILL.md),
[import policy](IMPORT_CONFLICT_RESOLUTION.md),
[health privacy](HEALTH_REPORT_PRIVACY.md) and
[sensitive-action policy](SENSITIVE_ACTION_SECURITY.md).
