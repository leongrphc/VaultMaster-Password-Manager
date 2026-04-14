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
