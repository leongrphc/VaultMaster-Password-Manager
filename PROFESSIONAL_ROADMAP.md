# VaultMaster — bireysel kullanım için geliştirme yol haritası

İnceleme tarihi: 5 Ekim 2026. İlk hedef: güvenli kişisel kasa ve güvenilir otomatik doldurma.
Bu belge kod incelemesinin ve otomatik testlerin sonucudur; bağımsız güvenlik denetimi veya ürün sertifikası değildir.

## Çalışan temel

- Kasa verileri istemcide AES-256-GCM ile şifreleniyor; sunucuya şifreli içerik gönderiliyor.
- İstemci anahtar türetimi PBKDF2-SHA256 / 600.000 tur kullanıyor. Sunucu kimlik doğrulama hash'ini ayrıca Argon2id ile saklıyor.
- TOTP, 2FA kurtarma kodları, hesap için WebAuthn ve destekleyen cihazlarda WebAuthn PRF ile yerel kilit açma bulunuyor.
- Şifre üretici, zayıf/tekrar kullanılan şifre raporu ve HIBP üzerinden hash ön ekiyle sızıntı kontrolü var.
- Şifreli dışa aktarma, içe aktarma, çöp kutusu, kayıt geçmişi, şifreli ekler ve şifreli çevrimdışı önbellek bulunuyor.
- Pano temizleme zaten var; kullanıcı başka bir içerik kopyaladıysa onu silmemeyi deniyor. Tarayıcı izinleri nedeniyle başarısız olabilmesi ayrıca test edilmeli.

Bir özelliğin arayüzde bulunması, tüm hata ve güvenlik senaryolarının tamamlandığı anlamına gelmiyor.

## Bu geliştirme turunda tamamlananlar

| Geliştirme | Doğrulama |
| --- | --- |
| Web sekmesi olmadan eklentide giriş, TOTP/kurtarma/WebAuthn, kasa kilidi ve şifreli senkronizasyon | Gerçek MV3 popup girişi, worker durdurup yeniden başlatma, yanlış şifre, oturum iptali, senkronizasyon yarışları ve kalıcı depolamada sır bulunmaması |
| Web için HttpOnly/Secure çerez oturumu, aynı köken API proxy ve hash tabanlı CSP | JWT içermeyen web yanıtları, CSRF kaynak reddi, çerez yenileme/iptal, izinsiz script engeli ve gerçek Chromium akışları |
| Sekmeler arasında kilit/çıkış/hesap değişimi ve Web Locks ile oturum yenileme eşgüdümü | Çözülmüş verinin temizlenmesi, depolama döngüsünün engellenmesi ve iki sekmeli tarayıcı kilit/çıkış testi |
| Taşınabilir tam kişisel kasa yedeği; bağımsız yedek şifresi ve atomik eklemeli geri yükleme | Kaynak hesap silindikten sonra yeni anahtarla geçmiş/çöp/ek çözme; tekrar denemede kopya engeli; rollback ve tarayıcı indirme/geri yükleme |
| Sabit kasa anahtarı ve sürümlü ana şifre zarfı; eski hesapların veri yazmadan geçişi | Geçmiş/çöp/ek ciphertext koruması, gerçek şifre çözme, eşzamanlı değişim, çevrimdışı kilit açma ve kayıp HTTP yanıtı testleri |
| Anahtarın yalnızca bellekte tutulması; eski düz metin `sessionStorage` anahtarının kaldırılması | Girişten kasaya istemci geçişi, tam yenilemeden sonra kilit, yanlış/doğru şifre ve eski depolama sürümleri |
| Kilit/çıkış/hesap değişiminden sonra eski işlemlerin çözülmüş veriyi geri getirmesinin engellenmesi | Gecikmiş API yüklemesi, çevrimdışı yükleme, kayıt oluşturma, kilit açma ve token yenileme yarışları |
| Otomatik doldurmada Chrome'un kaynak adresinin kullanılması | Sahte köken, başka frame adresi, eksik/inaktif belge ve gerçek eklenti testleri |
| Sayfa kodunun yapay tıklamalarının engellenmesi; HTTPS girişini HTTP sayfasında otomatik doldurmanın reddedilmesi | Normal doldurma ve uyarıdaki zorla doldurma için gerçek Chromium tıklamaları |
| Cihaza bağlı token'lar ve sonraki API isteğinde oturum iptali | Çıkış, diğer cihazları iptal etme, şifre değişimi, token tekrar kullanımı ve veritabanı hataları |
| Aynı saniyede üretilen token'ların benzersiz olması; amaç/algoritma/issuer/audience doğrulaması | JWT birim testleri ve gerçek PostgreSQL ile API entegrasyon testleri |
| Next.js 16.3.8 güncellemesi | Statik üretim derlemesi, web testleri ve gerçek tarayıcı testi; kritik bağımlılık bulgusu 3'ten 0'a indi |
| Geçici PostgreSQL üzerinde GitHub CI; test veritabanının açıkça seçilmesi | Gerçek migrations, derleme, lint/typecheck, birim/entegrasyon testleri ve iki tarayıcı testi |

Önceki turda kilit kontrolünü atlayan şifre önbelleği kaldırıldı; iki aşamalı giriş ve sayfa geçişinde şifrelenmiş kaydetme taslakları düzeltildi.
Bu geliştirmeler 5 Ekim 2026'da `d1aaa23` sürümüyle canlıya alındı. API migration'ları,
web/eklenti yayını ve geçici hesapla canlı doğrulama tamamlandı; test hesapları silindi.
Eski web oturumları için yeniden giriş gerekiyor. 174 birim/entegrasyon testi ve gerçek
tarayıcı testleri geçti. GitHub Actions'ın çalıştırıcı kesintisi nedeniyle CI yeniden
başlatıldı; yayın doğrulaması yerel testler ve ayrı Neon test veritabanıyla tamamlandı.
Dağıtım kimlikleri ve doğrulama kapsamı: [DEPLOYMENT.md](DEPLOYMENT.md).

## İlk sürümden önce öncelikli eksikler

| Öncelik | Eksik / kodda görülen durum | Tamamlanma koşulu |
| --- | --- | --- |
| P0 | Bağımlılık taramasında hâlâ yüksek/orta/düşük bulgular var. Kritik sayısının sıfır olması tüm bulguların giderildiği anlamına gelmez. | Doğrudan/dolaylı ve üretim/geliştirme bağımlılıklarını ayırıp düzeltme veya somut uygulanabilirlik değerlendirmesi; düzenli güncellemeler. |
| P0 | Tam kişisel kasa yedeği canlıda; P0-1 ile 64 MiB için sürüm 4 parça desteği eklendi. Operasyonel sunucu yedekleri ayrı iş. | Kişisel yedek için 64 MiB parça desteği tamamlandı; planlı sunucu yedek ve geri dönüş tatbikatı bekliyor. Hesap güvenliği ve paylaşım ayarları bu kişisel arşive dahil değil. |
| P1 | Bağımsız eklenti çekirdeği tamamlandı; mağaza dağıtımı ve çevrimdışı kullanım sonraki kapsam. | Chrome/Edge ZIP paketi mevcut. Şu an giriş/açma/doldurma için API gerekir; tarayıcı yeniden başlayınca yeni giriş gerekir. Mağaza kimliği ve izin/otomatik güncelleme süreci ayrı doğrulanmalı. |
| P1 | iframe ve Shadow DOM formları yeterince desteklenmiyor; inline panel hedef sayfanın DOM'unda. | Frame seçimi ve kaynak doğrulaması; başka kökenden frame için açık karar; Shadow DOM testleri ve sayfanın değiştiremeyeceği seçim arayüzü. Sadece `all_frames` eklemek yeterli değil. |
| P1 | Yeni hesap/şifre değiştirme formlarında birden çok şifre alanı ve SPA geçişleri tam ele alınmıyor. | `current-password` / `new-password` ayrımı, formdan şifre üretme, güvenilir güncelleme teklifi ve farklı form türleri için geniş fixture seti. |
| P1 | KDF verileri hesapta mevcut, fakat giriş/kilit açma akışı 600.000 tur ve e-posta salt varsayımına bağlı. | Sürümlü KDF metadatası, mevcut hesaplarla uyumlu güvenli parametre geçişi ve cihazlarda süre/bellek ölçümü. Algoritmayı doğrudan değiştirmek mevcut kasaları bozabilir. |
| P1 | Hassas işlemlerde yeniden doğrulama, hesap e-postası doğrulaması, saldırı sınırlama ve kullanıcı bildirimleri tamamlanmalı. | Silme/dışa aktarma/şifre değişimi için tutarlı yeniden doğrulama; kalıcı ve hesap/IP bazlı saldırı sınırlaması; oturum ve güvenlik değişikliklerinde anlaşılır bildirimler. |
| P1 | Üretim gözlemleme araçları var; alarm ve geri dönüş süreci uçtan uca doğrulanmış değil. | Sağlık kontrolü, başarısız senkronizasyon alarmı, gizli veri içermeyen loglar, dağıtım geri alma ve veri kurtarma tatbikatı. |
| P2 | Kasa içindeki passkey kaydı ve eklenti köprüsü gerçek passkey oluşturma/imzalama yapmıyor. | Açık deneysel durum; tam WebAuthn yaşam döngüsü, anahtar üretimi, sayaç ve kullanıcı onayı testleri. Hesaba WebAuthn ile giriş özelliği bundan ayrı. |
| P2 | Paylaşım ve acil erişimde kullanıcıdan şifreli içerik/anahtar metinleri isteniyor. | Gerçek istemci anahtar paylaşımı, alıcı kimliği doğrulama, anlaşılır davet/iptal akışı. Bireysel ilk sürümün odağına alınmayacak. |

Klasör adları, hesap e-postası, IP/cihaz bilgileri gibi bazı metaveriler sunucuda açık.
Bu yüzden "sunucu hiçbir bilgiyi bilmiyor" şeklinde bir ürün iddiası kullanılmamalı.
Tarayıcı/işletim sistemi ele geçirilmesini veya kullanıcı onayıyla bir sayfaya doldurulan şifrenin o sayfa tarafından okunmasını yalnızca kasa şifrelemesi önleyemez.

## Önerilen sıra

1. **Veri kaybını önleme:** canlıdaki kişisel yedeği büyük kasalara genişletmek; operasyonel yedek ve geri dönüş tatbikatını tamamlamak.
2. **Üretim güvenliği:** kalan uygulanabilir bağımlılık açıkları, saldırı sınırlaması ve hassas işlem doğrulaması.
3. **Otomatik doldurma:** bağımsız eklentiyi iframe, Shadow DOM ve şifre değiştirme form desteğiyle genişletmek; mağaza dağıtımını hazırlamak.
4. **Günlük kullanım:** kaydet/güncelle akışları, şifre üretme, arama, içe aktarma ve hata mesajlarını gerçek kullanım senaryolarıyla iyileştirmek.
5. **Yayın ölçütleri:** bağımsız güvenlik incelemesi, geri dönüş tatbikatı, geniş tarayıcı testleri ve kontrol edilen sürümlü dağıtımlar.

## Dayanaklar ve doğrulama

- [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): parola doğrulama hash'lerinin korunması. Kasa içeriğini şifrelemek ayrı bir gereksinimdir.
- [OWASP HTML5 Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html): JavaScript'in okuyabildiği tarayıcı depolamasında oturum tanımlayıcıları ve hassas veriler.
- [Chrome MessageSender](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender) ve [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage): kaynak belge bilgisi ve eklenti oturum depolaması.
- [Next.js güvenlik duyurusu](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j): ilgili sunucu özelliği için düzeltilmiş sürüm. Statik dağıtımın gerçekten kullandığı özellikler ayrıca değerlendirilir.
- Test komutları ve oturum biçiminin dağıtım etkisi: [DEPLOYMENT.md](DEPLOYMENT.md).


## P0-1 — sürümlü parçalı kişisel yedek (6 Ekim 2026)

- [x] Sürüm 4: 1 MiB AES-256-GCM parçaları, doğrulanmış sıra/toplam boyut,
  64 MiB kasa sınırı, hesapla sınırlı kalıcı aktarım ve atomik eklemeli geri yükleme.
  Sürüm 3 dosyaları ve eski API uçları korunuyor. Geçmiş/çöp/ekler atlanmıyor;
  şifre, kaynak veri anahtarı ve çözülmüş kasa sırları API'ye gönderilmiyor.

Doğrulama: 14 crypto, 74 web, 5 gerçek PostgreSQL yedek entegrasyonu, 1 mevcut
rate-limit testi ve 1 Chromium akışı geçti; typecheck/lint/statik üretim derlemesi
geçti (lint: mevcut 3 uyarı). Bellekte birleştirme, 64 MiB sınırı, aktarım süresi
ve sayfa yenilemesinde otomatik devam olmaması: [DEPLOYMENT.md](DEPLOYMENT.md).
Operasyonel sunucu yedeği ve diğer yol haritası maddelerine başlanmadı.
`CURRENT_DEVELOPMENT_ROADMAP.md` bu dalın başlangıcında bulunmadığı için P0-1'in
kontrol listesi burada kaydedildi.
