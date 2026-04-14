# VaultMaster Şifre Yöneticisi / Password Manager

VaultMaster, kullanıcıların hassas verilerini (şifreler, güvenli notlar, kredi kartları) uçtan uca şifreleme (E2EE) prensibiyle saklamalarını sağlayan, açık kaynak odaklı ve sıfır bilgi (zero-knowledge) mimarisine dayalı bir şifre yöneticisidir.

VaultMaster is an open-source password manager built with end-to-end encryption (E2EE) and a zero-knowledge architecture for storing sensitive data securely.

---

## 🇹🇷 Hızlı Başlangıç (TR)

### Özellikler

- Zero-knowledge mimari
- AES-256-GCM istemci şifreleme
- PBKDF2 (600.000 iterasyon)
- 2FA (TOTP + recovery code)
- Vault, klasör, geçmiş, cihaz ve audit yönetimi

### Gereksinimler

- Node.js 20+
- pnpm 9+
- PostgreSQL 14+

### Kurulum

```bash
pnpm install
```

Proje kökünde `.env` oluştur:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/vaultmaster"
DATABASE_DIRECT_URL="postgresql://USER:PASSWORD@HOST:5432/vaultmaster"
JWT_SECRET="32+ karakter"
JWT_REFRESH_SECRET="32+ karakter"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
API_PORT="4000"
NODE_ENV="development"
CORS_ORIGIN="http://localhost:3000"
APP_ENCRYPTION_KEY="BASE64_32_BYTE_KEY"
SENTRY_DSN=""
NEXT_PUBLIC_API_URL="http://localhost:4000/api"
NEXT_PUBLIC_SENTRY_DSN=""
```

Veritabanı:

```bash
pnpm db:generate
pnpm db:push
```

### Çalıştırma

```bash
pnpm dev
```

Alternatif:

```bash
pnpm dev:api
pnpm dev:web
```

### Test / Build

```bash
pnpm --filter @vaultmaster/api test
pnpm --filter @vaultmaster/crypto test
pnpm build
```

### Tarayıcı Eklentisi

```bash
pnpm --filter @vaultmaster/extension build
```

`apps/extension/dist` klasörünü **Load unpacked** ile yükleyin.

---

## 🇬🇧 Quick Start (EN)

### Highlights

- Zero-knowledge architecture
- Client-side AES-256-GCM encryption
- PBKDF2 (600,000 iterations)
- 2FA (TOTP + recovery codes)
- Vault, folder, history, device, and audit management

### Requirements

- Node.js 20+
- pnpm 9+
- PostgreSQL 14+

### Setup

```bash
pnpm install
```

Create `.env` in the project root:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/vaultmaster"
DATABASE_DIRECT_URL="postgresql://USER:PASSWORD@HOST:5432/vaultmaster"
JWT_SECRET="32+ characters"
JWT_REFRESH_SECRET="32+ characters"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
API_PORT="4000"
NODE_ENV="development"
CORS_ORIGIN="http://localhost:3000"
APP_ENCRYPTION_KEY="BASE64_32_BYTE_KEY"
SENTRY_DSN=""
NEXT_PUBLIC_API_URL="http://localhost:4000/api"
NEXT_PUBLIC_SENTRY_DSN=""
```

Database:

```bash
pnpm db:generate
pnpm db:push
```

### Run

```bash
pnpm dev
```

Alternatives:

```bash
pnpm dev:api
pnpm dev:web
```

### Test / Build

```bash
pnpm --filter @vaultmaster/api test
pnpm --filter @vaultmaster/crypto test
pnpm build
```

### Browser Extension

```bash
pnpm --filter @vaultmaster/extension build
```

Load `apps/extension/dist` using **Load unpacked**.
