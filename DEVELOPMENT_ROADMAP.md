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
- [ ] Vault kartlarini klavye ile erisilebilir yap
  - [ ] Kart secimi icin semantic button veya `role`, `tabIndex`, Enter/Space destegi
  - [ ] Nested button event davranisini dogrula
- [ ] Mobil sidebar/layout davranisini duzelt
  - [ ] Mobilde main margin'i sifirla
  - [ ] Sidebar'i mobil drawer/overlay olarak calistir
  - [ ] Overlay, Escape ve scroll lock davranisini dogrula
- [ ] Form label ve aria baglantilarini guclendir
  - [ ] Input/select/textarea icin `id` + `htmlFor`
  - [ ] Hata mesajlari icin `aria-describedby`
- [ ] Ikon-only butonlara erisilebilir isim ekle
  - [ ] `aria-label`
  - [ ] Toggle butonlarda `aria-pressed`
- [ ] Master password kayit UX'ini guclendir
  - [ ] Strength meter veya guclu parola rehberi
  - [ ] Kurtarma yok onay checkbox'i
  - [ ] Caps Lock uyarisi
- [ ] 2FA recovery code akisini guclendir
  - [ ] Kodlari kaydettim onayi
  - [ ] Recovery code indirme secenegi
  - [ ] Kodlar tekrar gosterilemiyorsa acik uyari
- [ ] Reduced motion destegi ekle
  - [ ] `prefers-reduced-motion` global CSS kurali
- [ ] Clipboard auto-clear feedback ekle
  - [ ] Kopyalama toast'inda temizleme suresi
  - [ ] Temizleme basarisiz olursa non-blocking uyari

## Faz 3 - Test, CI ve kalite kapilari

- [ ] Root kalite scriptlerini ekle
  - [ ] `typecheck`
  - [ ] `test`
  - [ ] `test:coverage` veya kapsam stratejisi
  - [ ] `ci`
- [ ] GitHub Actions CI ekle
  - [ ] Frozen install
  - [ ] Build
  - [ ] Lint
  - [ ] Typecheck
  - [ ] Test
- [ ] API integration testlerini genislet
  - [ ] Auth register/login
  - [ ] 2FA enable/verify/disable
  - [ ] Vault CRUD
  - [ ] Folder ownership
  - [ ] Refresh token rotation
  - [ ] Rate limit davranisi
- [ ] Web testlerini ekle
  - [ ] Login/register flow
  - [ ] Vault lock/unlock
  - [ ] Add/edit/delete item
  - [ ] Export warning modal
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
