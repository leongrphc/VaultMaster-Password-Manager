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
Değişiklikler geliştirme dalında. Canlı yayına geçiş ve mevcut oturumların yeni token biçimine geçişi ayrı bir dağıtım işidir.

## İlk sürümden önce öncelikli eksikler

| Öncelik | Eksik / kodda görülen durum | Tamamlanma koşulu |
| --- | --- | --- |
| P0 | Güvenli ana şifre değişimi geliştirme dalında tamamlandı; canlıya kontrollü geçiş gerekiyor. | Yeni migration ve API önce; web sonra. Mevcut eski oturumların yeniden girişi, şifre değişimi ve geçmiş/ek smoke testi. Eski istemciye doğrudan geri alma güvenli değil. |
| P0 | Erişim ve yenileme token'ları web `localStorage` içinde tutuluyor. Anahtarı belleğe taşımak tek başına XSS koruması sağlamaz. | Web için HttpOnly/Secure oturum tasarımı ve uygun aynı köken API erişimi; CSRF/CORS testleri; üretimde güçlü CSP ve veri sızıntısı testleri. |
| P0 | Bağımlılık taramasında hâlâ yüksek/orta/düşük bulgular var. Kritik sayısının sıfır olması tüm bulguların giderildiği anlamına gelmez. | Doğrudan/dolaylı ve üretim/geliştirme bağımlılıklarını ayırıp düzeltme veya somut uygulanabilirlik değerlendirmesi; düzenli güncellemeler. |
| P0 | Yedekleme ve kurtarma arayüzü var; tüm veri türlerinin, anahtar sürümlerinin ve sunucu kaybının geri dönüşü birlikte kanıtlanmış değil. | Sürümlü şifreli yedek biçimi; geçmiş/ekler/çöp kutusu dahil geri yükleme tatbikatı ve gerçek verilerden bağımsız testler. Kurtarma anahtarı tasarımı ana şifreyi sunucuya vermemeli. |
| P1 | Eklenti hâlâ açık ve kilitsiz web sekmesine bağımlı. | Eklenti içinde giriş, yerel kilit açma, şifreli senkronizasyon, otomatik kilit ve yeniden başlayan service worker için güvenli anahtar yaşam döngüsü. |
| P1 | iframe ve Shadow DOM formları yeterince desteklenmiyor; inline panel hedef sayfanın DOM'unda. | Frame seçimi ve kaynak doğrulaması; başka kökenden frame için açık karar; Shadow DOM testleri ve sayfanın değiştiremeyeceği seçim arayüzü. Sadece `all_frames` eklemek yeterli değil. |
| P1 | Yeni hesap/şifre değiştirme formlarında birden çok şifre alanı ve SPA geçişleri tam ele alınmıyor. | `current-password` / `new-password` ayrımı, formdan şifre üretme, güvenilir güncelleme teklifi ve farklı form türleri için geniş fixture seti. |
| P1 | Sekmeler arasında kilit ve yenileme eşgüdümü eksik. | Bir sekmenin çıkışı/kilidi diğer sekmelere taşınmalı; eşzamanlı yenilemeler meşru oturumları gereksiz yere iptal etmemeli. |
| P1 | KDF verileri hesapta mevcut, fakat giriş/kilit açma akışı 600.000 tur ve e-posta salt varsayımına bağlı. | Sürümlü KDF metadatası, mevcut hesaplarla uyumlu güvenli parametre geçişi ve cihazlarda süre/bellek ölçümü. Algoritmayı doğrudan değiştirmek mevcut kasaları bozabilir. |
| P1 | Hassas işlemlerde yeniden doğrulama, hesap e-postası doğrulaması, saldırı sınırlama ve kullanıcı bildirimleri tamamlanmalı. | Silme/dışa aktarma/şifre değişimi için tutarlı yeniden doğrulama; kalıcı ve hesap/IP bazlı saldırı sınırlaması; oturum ve güvenlik değişikliklerinde anlaşılır bildirimler. |
| P1 | Üretim gözlemleme araçları var; alarm ve geri dönüş süreci uçtan uca doğrulanmış değil. | Sağlık kontrolü, başarısız senkronizasyon alarmı, gizli veri içermeyen loglar, dağıtım geri alma ve veri kurtarma tatbikatı. |
| P2 | Kasa içindeki passkey kaydı ve eklenti köprüsü gerçek passkey oluşturma/imzalama yapmıyor. | Açık deneysel durum; tam WebAuthn yaşam döngüsü, anahtar üretimi, sayaç ve kullanıcı onayı testleri. Hesaba WebAuthn ile giriş özelliği bundan ayrı. |
| P2 | Paylaşım ve acil erişimde kullanıcıdan şifreli içerik/anahtar metinleri isteniyor. | Gerçek istemci anahtar paylaşımı, alıcı kimliği doğrulama, anlaşılır davet/iptal akışı. Bireysel ilk sürümün odağına alınmayacak. |

Klasör adları, hesap e-postası, IP/cihaz bilgileri gibi bazı metaveriler sunucuda açık.
Bu yüzden "sunucu hiçbir bilgiyi bilmiyor" şeklinde bir ürün iddiası kullanılmamalı.
Tarayıcı/işletim sistemi ele geçirilmesini veya kullanıcı onayıyla bir sayfaya doldurulan şifrenin o sayfa tarafından okunmasını yalnızca kasa şifrelemesi önleyemez.

## Önerilen sıra

1. **Veri kaybını önleme:** tamamlanan kasa anahtarı geçişini kontrollü yayımlamak; geçmiş/çöp/ekler dahil sürümlü şifreli yedekten geri dönüşü kanıtlamak.
2. **Web oturumu ve üretim güvenliği:** token saklama, CSP, sekmeler arası eşgüdüm ve kalan uygulanabilir bağımlılık açıkları.
3. **Bağımsız eklenti:** web sekmesi gerekmeyen giriş/kilit/senkronizasyon; ardından iframe, Shadow DOM ve şifre değiştirme form desteği.
4. **Günlük kullanım:** kaydet/güncelle akışları, şifre üretme, arama, içe aktarma ve hata mesajlarını gerçek kullanım senaryolarıyla iyileştirmek.
5. **Yayın ölçütleri:** bağımsız güvenlik incelemesi, geri dönüş tatbikatı, geniş tarayıcı testleri ve kontrol edilen sürümlü dağıtımlar.

## Dayanaklar ve doğrulama

- [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): parola doğrulama hash'lerinin korunması. Kasa içeriğini şifrelemek ayrı bir gereksinimdir.
- [OWASP HTML5 Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html): JavaScript'in okuyabildiği tarayıcı depolamasında oturum tanımlayıcıları ve hassas veriler.
- [Chrome MessageSender](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender) ve [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage): kaynak belge bilgisi ve eklenti oturum depolaması.
- [Next.js güvenlik duyurusu](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j): ilgili sunucu özelliği için düzeltilmiş sürüm. Statik dağıtımın gerçekten kullandığı özellikler ayrıca değerlendirilir.
- Test komutları ve oturum biçiminin dağıtım etkisi: [DEPLOYMENT.md](DEPLOYMENT.md).
