# VaultMaster Development Roadmap

Bu dosya VaultMaster Password Manager icin incelenen gelistirme maddelerini takip etmek icin kullanilir. Maddeler sirayla tamamlandikca isaretlenecek.

## Faz 1 - Guvenlik ve veri sizintisi riskleri

- [x] Plaintext export guvenligini duzelt
  - [x] CSV export oncesi danger confirmation modal ekle
  - [x] Bulk export'u sifreli hale getir veya plaintext riskini acikca onaylat
  - [x] Export sonrasi kullaniciya dosya guvenligi uyarisi goster
- [x] Backend folder ownership kontrolu ekle
  - [x] Vault item create sirasinda `folderId` ayni kullaniciya ait mi dogrula
  - [x] Vault item update sirasinda `folderId` ayni kullaniciya ait mi dogrula
  - [x] Bu davranis icin test ekle veya mevcut test komutuyla dogrula
- [x] Refresh token guvenligini artir
  - [x] Refresh token'i DB'de hashli sakla
  - [x] Token rotation modelini guclendir
  - [x] Reuse detection stratejisini ekle
- [x] Hassas endpoint'lere ozel rate limit ekle
  - [x] 2FA verify/disable endpoint'leri
  - [x] Recovery code regenerate endpoint'i
  - [x] Change password/delete account endpoint'leri
  - [x] Refresh endpoint'i
- [x] Extension sifre maruziyetini azalt
  - [x] Sifre prefetch/cache davranisini azalt veya kaldir
  - [x] Pending autofill icinde sifre yerine `itemId + nonce` kullan
  - [x] TOTP/CVV gibi yuksek hassasiyetli alanlari prefetch disinda tut
- [x] Extension bridge guvenligini artir
  - [x] `window.postMessage(..., "*")` yerine origin-bound hedef kullan
  - [x] Cevaplarda `event.origin` kontrolu ekle
  - [x] Runtime message payload validation ekle

## Faz 2 - Web UX ve erisilebilirlik

- [x] Ortak modal/danger modal altyapisi kur
  - [x] `role="dialog"`, `aria-modal`, `aria-labelledby` destegi
  - [x] Focus trap, Escape ile kapatma, focus return
  - [x] Dirty form kapanisinda veri kaybi onleme
- [x] Vault kartlarini klavye ile erisilebilir yap
  - [x] Kart secimi icin semantic button veya `role`, `tabIndex`, Enter/Space destegi
  - [x] Nested button event davranisini dogrula
- [x] Mobil sidebar/layout davranisini duzelt
  - [x] Mobilde main margin'i sifirla
  - [x] Sidebar'i mobil drawer/overlay olarak calistir
  - [x] Overlay, Escape ve scroll lock davranisini dogrula
- [x] Form label ve aria baglantilarini guclendir
  - [x] Input/select/textarea icin `id` + `htmlFor`
  - [x] Hata mesajlari icin `aria-describedby`
- [x] Ikon-only butonlara erisilebilir isim ekle
  - [x] `aria-label`
  - [x] Toggle butonlarda `aria-pressed`
- [x] Master password kayit UX'ini guclendir
  - [x] Strength meter veya guclu parola rehberi
  - [x] Kurtarma yok onay checkbox'i
  - [x] Caps Lock uyarisi
- [x] 2FA recovery code akisini guclendir
  - [x] Kodlari kaydettim onayi
  - [x] Recovery code indirme secenegi
  - [x] Kodlar tekrar gosterilemiyorsa acik uyari
- [x] Reduced motion destegi ekle
  - [x] `prefers-reduced-motion` global CSS kurali
- [x] Clipboard auto-clear feedback ekle
  - [x] Kopyalama toast'inda temizleme suresi
  - [x] Temizleme basarisiz olursa non-blocking uyari

## Faz 3 - Test, CI ve kalite kapilari

- [x] Root kalite scriptlerini ekle
  - [x] `typecheck`
  - [x] `test`
  - [x] `test:coverage` veya kapsam stratejisi
  - [x] `ci`
- [x] GitHub Actions CI ekle
  - [x] Frozen install
  - [x] Build
  - [x] Lint
  - [x] Typecheck
  - [x] Test
- [x] API integration testlerini genislet
  - [x] Auth register/login
  - [x] 2FA enable/verify/disable
  - [x] Vault CRUD
  - [x] Folder ownership
  - [x] Refresh token rotation
  - [x] Rate limit davranisi
- [x] Web testlerini ekle
  - [x] Login/register flow
  - [x] Vault lock/unlock
  - [x] Add/edit/delete item
  - [x] Export warning modal
- [ ] Extension testlerini ekle
  - [ ] Form detector fixture testleri
  - [ ] Domain match/phishing warning testleri
  - [ ] Autofill user-action testleri
- [ ] E2E smoke test ekle
  - [ ] Kayit ol, item olustur, cikis/giris yap
  - [ ] Extension autofill smoke
  - [ ] Export/import smoke

## Faz 4 - Urun polish

- [ ] Health report progress/cancel/privacy aciklamasi ekle
- [ ] Import duplicate detection ekle
- [ ] Import drag/drop metnini davranisla tutarli hale getir
- [ ] Extension UI dil tutarliligini sagla
- [ ] Extension README'yi genislet
- [ ] Fontlari self-host etmeyi degerlendir
- [ ] Offline snapshot temizleme UI'i ekle

## Faz 5 - Release readiness

- [ ] Prisma migration surecini production'a uygun hale getir
- [ ] Security policy ekle
- [ ] Threat model dokumani ekle
- [ ] Deployment/release runbook ekle
- [ ] Versioning/changelog sureci kur
- [ ] Extension store hazirlik checklist'i ekle

## Calisma notu

Sirayla ilerleme onerisi:

1. Plaintext export guvenligi
2. Backend folder ownership kontrolu
3. Refresh token hash/rotation
4. Ortak modal/danger modal altyapisi
5. Mobil sidebar/layout duzeltmesi

Her tamamlanan madde bu dosyada `[x]` olarak isaretlenecek.
