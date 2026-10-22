# Sipariş değişiklikleri ve imalat — inceleme dalı

Bu geliştirme canlıya dağıtılmamıştır. Supabase üzerinde migration çalıştırılmamıştır. `ORDER_WORKFLOW_ENABLED` varsayılan olarak kapalıdır; mevcut kurulum yeni tabloları sorgulamaz. `main` dalı değiştirilmez.

## Kesinleştirilen roller

Veritabanındaki rol isimleri ve kullanıcı/birim ilişkileri korunur. `admin` ve `manager` profillerinde birim boş; operatörler Bahçe, Küçükpark, Evka3 veya İmalat birimine bağlıdır. Yeni bir rol veya örnek şube/kullanıcı oluşturulmaz.

| İşlem | Yönetici (`admin`) | Şube operatörü (`operator`) | İmalat sorumlusu (`manager`) | İmalat operatörü (`operator`, birim 4) |
| --- | --- | --- | --- | --- |
| Sipariş görme | Tüm şubeler, tüm durumlar | Kendi şubesi | Tüm şubeler, onaylanmış kayıtlar | Tüm şubeler, onaylanmış kayıtlar |
| Yeni sipariş | Şube seçerek | Kendi şubesi | Hayır | Hayır |
| Düzenleme, görsel, iptal | Açık siparişlerde onay sonrası da | Kendi şubesinde yalnızca onay öncesi | Hayır | Hayır |
| Onay / ret | Evet | Hayır | Hayır | Hayır |
| Üretim aşaması | Evet | Hayır | Evet | Evet; mevcut yetkisi korunur |
| İmalat notu / sorun | Evet | Hayır | Evet | Evet |
| Değişiklik bildirimi / inceleme | İşlem geçmişini görür | Kendi sipariş geçmişi | Bildirimleri okur ve inceler | İşlem geçmişini ve üretim kilidini görür |
| Ürün yönetimi | Evet | Hayır | Evet; mevcut yetkisi korunur | Hayır |
| Kullanıcı yönetimi | Evet | Hayır | Hayır | Hayır |

Önceki sürümde `manager` onaylayabiliyor ve onay bekleyen kayıtları da okuyabiliyordu. Ekli istekteki son karar bu iki yetkiyi kaldırdığı için 0004 migration ve API birlikte sınırlar. Onay öncesinde iptal edilen kayıt imalat ekranına açılmaz. Önceden onaylanıp sonradan tamamen iptal edilen kayıt imalat ve geçmiş ekranlarında görünmeye devam eder. Reddedilmiş veya tamamen iptal edilmiş sipariş yeniden açılmaz; geçmişi korunarak yeni sipariş oluşturulur. Teslim edilmiş kayıtların yönetici düzeltmeleri geçmişe ve bildirimlere işlenir; siparişi kendiliğinden üretime döndürmez.

## İş akışı

- Sipariş ayrıntısındaki **Siparişi düzenle** kalem, miktar, kişi sayısı, ürün açıklaması, sipariş notu ve teslim tarihini düzenler. Katalog ürünleri önceki ad/birim/kategori snapshot'ını korur. Yeni kalem eklenebilir; kaldırılan kalemin kalanı iptal olarak saklanır. İptal geçmişi olan kalemin ürününü değiştirmek yerine yeni kalem eklenir.
- **Kalem / kısmi iptal** kalan miktarın belirli bölümünü iptal eder. **Siparişi iptal et** tüm kalemlerin kalanını iptal eder. Gerekçe zorunludur. İptal miktarı kalanı aşamaz; adet/tepsi tam sayı, kg en fazla üç ondalıktır.
- Her değişiklikte sipariş sürümü denetlenir. Eski ekrandan işlem 409 ile durur; kullanıcı yeniler. Sipariş kilidi hem yarışan iptalleri hem üretim geçişleriyle eşzamanlı değişiklikleri sıralar. Başarısız işlem ve bildirim aynı transaction içinde geri alınır.
- Onay sonrası düzenleme/iptal/görsel değişikliği bir değişiklik olayı ve buna bağlı tek bildirim üretir. Eski/yeni açıklama, miktar, iptal, kalan, kişi sayısı, tarih ve görseller geçmişte görünür. Olay kimliği bildirimde benzersizdir; aynı değişiklik iki kez bildirilmez.
- Her imalat sorumlusunun okundu kaydı ayrıdır. **Okundu işaretle** üretim kilidini kaldırmaz. **Değişikliği İnceledim** değişikliği geri almadan inceleyen kişiyi/zamanı kaydeder. Yetkili imalat sorumlularından birinin incelemesi yeterlidir; siparişte başka bekleyen bildirim varsa kilit sürer. Tekrarlanan inceleme ikinci olay oluşturmaz.
- Tüm üretim geçişleri API çağrısında ve doğrudan SQL RPC çağrısında bekleyen incelemelerden dolayı durur. Yönetici veya İmalat operatörü de bu kilidi atlayamaz.
- Mevcut aşamalar korunur: **Onaylandı → Hazırlanıyor → Hazır → Teslim edildi**. **İmalat notu ekle** / **Sorun bildir** kalıcı işlem geçmişine kaydeder. Yönetici sipariş listesinde üretim sorunu işaretini ve ayrıntıdaki açıklamayı görür.
- Açık sayfalar 30 saniyede bir yenilenir; açık form ve odaklanmış giriş kesilmez. **Yenile** ile anında kontrol yapılabilir. Bu sistem uygulama içi bildirimdir; e-posta veya telefon bildirimi göndermez.

## Özel sipariş görselleri

Sipariş kaydedildikten sonra ayrıntıdan **Görsel ekle / değiştir** kullanılır. Her aktif özel kalemde bir güncel PNG/JPEG/WebP görseli, en fazla 1 MB bulunabilir. Açıklama sipariş formundadır. Yeni görsel yüklemeden önceki sürümler silinmez; değişiklik geçmişinden erişilebilir. Onay sonrasında yalnızca yönetici değiştirebilir ve imalat bildirimi oluşturulur.

Bu başlangıç sürümü görselleri özel `order_images` tablosunda `bytea` olarak saklar. Küçük görseller için ayrı Storage bucket/servis anahtarı gerektirmez; veritabanı boyutuna ve yedeklerine dahildir. Yüksek görsel hacminde özel Supabase Storage'a ayrı geçiş planlanmalıdır. Görseller liste sorgularına/bildirim snapshot'larına gömülmez. Ham içerik için SELECT izni yoktur; yalnızca RLS kapsamını tekrar kontrol eden RPC ve oturumlu `/api/images/:id` rotası kullanılır. MIME, imza, boyut ve özel kalem denetimleri veritabanında yapılır; SVG kabul edilmez. Yanıtlar `private, no-store`, `nosniff` ve kısıtlı CSP taşır. Genel/public görsel bağlantısı oluşturulmaz.

## Üretim ve Excel raporları

**İmalat takip → Günlük üretim listesi** teslim gününe göre onaylandı/hazırlanıyor/hazır siparişleri listeler. **Tamamlanan üretim raporu** hazır/teslim edildi kayıtları imalat tamamlanma gününe göre listeler. Şube, tarih, durum ve ürün arama filtreleri ile tarihin sipariş/teslim/imalat tamamlanma günü olması seçilebilir. İmalat tamamlanma zamanı `ready` durum olayından alınır. Tüm günler Türkiye saatine göre hesaplanır.

Ekran, CSV ve gerçek `.xlsx` raporunda sipariş miktarı, iptal miktarı ve net kalan ayrı gösterilir. Ürün toplamları net kalana göre hesaplanır; pasta kişilikleri ve ölçü birimleri karışmaz. İlgili kayıtlar varsa Excel'de **İşlem geçmişi** sayfası eski/yeni değerleri ve gerekçeyi içerir. RLS tüm rapor ve görsellerde geçerlidir. Dosya başına 20.000 kalem ve Vercel sınırının altında 4 MB çıktı sınırı vardır; büyük raporda tarih aralığı daraltılır.

## Test ve kontrollü hazırlık

Bu dalı main'e birleştirmeden veya Vercel'e göndermeden inceleyin. Bu belgede canlı için çalıştırma talimatı/izni verilmez.

1. `npm ci` ve `npm test`; testler yerel PGlite PostgreSQL üzerinde gerçek migration/RLS/RPC'leri kullanır. Auth ve PostgREST taşıması test düzeneğidir, canlı Supabase değildir.
2. `npm run build` ile sunucu/istemci/rapor modülleri kontrol edilir.
3. Tarayıcı için `npx playwright install chromium` ardından `npm run test:browser`. Sistem Chromium'u varsa `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. Test sahte hesaplar ve geçici yerel veritabanı açıp kapatır; canlıya bağlanmaz.
4. Sonraki manuel hazırlık aşamasında **ayrı bir test Supabase projesi** kullanın. İlk üç migration ardından [0004_order_revisions.sql](../supabase/migrations/202610220004_order_revisions.sql) dosyasının tamamını uygulayın. Dosya mevcut kayıtları silmez ve tekrar uygulanabilir. Eksik migration durumunda yeni API eski izinlere geri dönmez, kurulum hatası verir.
5. Yalnızca bu test ortamında `ORDER_WORKFLOW_ENABLED=1` ayarlayın. Test projesine ait URL ve sunucu anahtarlarını güvenli ortam değişkenlerinde tutun. Canlı projenin anahtarlarını test ortamına taşımayın.
6. Gerçek Supabase/PostgREST, Vercel gövde sınırları ve yetkili test hesaplarıyla son kabul kontrolü tamamlandıktan sonra ayrı bir yayın kararı gerekir. Bu çalışma canlı rollout veya canlı RLS doğrulaması yapmaz.

Migration rol kapsamlarını da değiştirdiğinden uygulanmış veritabanında sadece özellik bayrağını kapatmak tam geri alma değildir. Canlı için yedekleme ve uygulama/veritabanı sürümünün birlikte yönetildiği yayın planı hazırlanmalıdır; bu dal otomatik geri alma/silme SQL'i içermez.

Ekran önizlemesi için tarayıcı komutuna `BROWSER_ARTIFACT_DIR=/tmp/topraktan-onizleme` eklenebilir. Beş gerçek ekran görüntüsü (şube düzenleme, imalat kontrolü, değişiklik bildirimi, tamamlanan üretim, mobil) ve tarayıcıdan indirilen örnek `.xlsx` bu dizine kaydedilir. Örnek 10 adet siparişten 3 iptal ve 7 kalan miktarı doğrular; canlı veri içermez.

## Bilgisayara kurulum yapmadan gerçek Supabase testi

[GitHub Actions](https://github.com/serhatgoktay/topraktan-siparis-takip/actions) içindeki **Isolated Supabase integration** görevi Ubuntu test sunucusunda geçici PostgreSQL/Auth/PostgREST başlatır. Başka bir hosted Supabase projesi veya kullanıcının bilgisayarında Docker gerekmez. Hiçbir repository/environment canlı Supabase sırrı kullanılmaz; canlı veritabanına bağlanılmaz.

Görev yalnızca `feature/order-revisions-production` dalındaki ilgili kod değişikliklerinde tetiklenir. Bu dalın Vercel otomatik dağıtımı `vercel.json` içinde kapalıdır; main değiştirilmez. Node testleri ve derleme ardından Supabase CLI 2.75.0 ile migration'lar geçici projeye uygulanır, sahte Auth hesapları oluşturulur ve uygulama gerçek yerel gateway üzerinden kontrol edilir. Test sonunda yalnızca bu geçici proje durdurulur.

`npm run test:supabase` komutu `LOCAL_SUPABASE_STATUS_FILE` ile CLI'nin yerel bağlantı dosyasını okur; hosted endpoint'leri reddeder. Canlı sunucunun HTTPS denetimi korunur. Test adaptörü yalnızca sentetik `https://topraktan-local.invalid` adresini loopback HTTP gateway'e taşır; hiçbir Auth/SQL yanıtı taklit edilmez. Başarılı kontrol özeti **isolated-supabase-test-result** artifact'ına kaydedilir; bağlantı dosyası ve anahtarlar artifact'a eklenmez. Actions sonucu yeşil olmadan gerçek Supabase kabul testi tamamlandı sayılmaz.
