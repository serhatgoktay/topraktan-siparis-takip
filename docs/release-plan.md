# Topraktan — yayın hazırlığı

Durum: hazırlık. Bu dosya canlı migration veya dağıtım işlemi yapmaz. Mevcut iki Supabase projesi kullanılmaya devam eder. Geliştirme `feature/order-revisions-production` dalındadır; main veya Vercel'e gönderilmemiştir.

## 1. Mevcut kurulumun salt okunur kontrolü

Supabase'de mevcut Topraktan projesinin seçili olduğunu doğrulayın (proje kimliği `bsjicijtxoufyuhppxuj`). SQL Editor → New query alanında [release_preflight.sql](../supabase/checks/release_preflight.sql) dosyasının tamamını çalıştırın. Bu sorgu salt okunur transaction kullanır; şema, kullanıcı, yetki ve sipariş verisi değiştirmez. Çıktı yalnızca kontrol işaretleri ve kayıt adetleridir, şifre/e-posta/gizli anahtar içermez.

- `ON_KONTROL_UYUMLU_YAYIN_HENUZ_ONAYLANMADI`: önceki şema parçaları ve rol hesapları bulunuyor. Bu sonuç tek başına yayın onayı veya gerçek hesaplarla erişim testi değildir.
- `KULLANICI_YETKILERI_TAMAMLANMALI`: aktif yönetici/imalat sorumlusu veya operatörün kullanıcı adı/birim ilişkisi eksik. İmalat sorumlusu yokken yeni üretim inceleme kilitleri açılamaz. Kullanıcılar mevcut uygulamadaki yönetici ekranından tamamlanır.
- `SEMA_VE_YETKILER_INCELENECEK`: şema, birim veya temel izin kontrolünde farklılık var. Migration uygulanmadan neden incelenir.
- `YENI_SURUM_IZI_VAR_AYRICA_INCELENECEK`: yeni geliştirmeye ait parçalar zaten mevcut veya kısmen uygulanmış olabilir. Yeniden kurulum yapılmadan durum incelenir.

Gerçek canlı projenin RLS kapsamları ve özelleştirilmiş fonksiyon gövdeleri bu metadata sorgusuyla bütünüyle doğrulanmış sayılmaz. Canlı SQL çıktısı henüz alınmamıştır.

## 2. Yedek ve gerçek Supabase kabul kontrolü

Yeni ücretli/bulut projesi oluşturmadan resmi Supabase yerel geliştirme ortamı başka bir seçenektir: Docker üzerinde PostgreSQL, Auth ve PostgREST ile ayrı test kurulumu. Bu çalışma alanındaki PGlite test düzeneği Auth/PostgREST'i taklit eder; gerçek Supabase kabul testi yerine geçirilmez. Resmi yerel ortam veya erişilebilir başka bir izole Supabase ortamı sağlanmadan gerçek servis testi tamamlandı diye raporlanmaz.

Yayın öncesinde güncel şema, veri ve rol/izin bilgilerini kapsayan, geri yükleme yöntemi belirli PostgreSQL yedeği alınır. Kullanılan yedekleme aracının Auth kullanıcıları ve uygulama profilleri arasındaki kimlik ilişkisini koruduğu teyit edilir. Ücretsiz planda indirilebilir/otomatik yedek bulunduğu varsayılmaz. Tek başına tablo CSV'leri eksiksiz PostgreSQL yedeği sayılmaz. Yedekler ve erişim bilgileri sohbete veya Git'e yüklenmez. Geri yükleme izole ortamda doğrulanır.

Gerçek servis üzerinde kabul senaryoları: Bahçe operatörünün Küçükpark kayıtlarını/API/görsellerini okuyamaması; imalat sorumlusunun onay öncesi kayıtları görememesi veya onaylayamaması; sipariş onayı; 10 adetten 3 iptal → 7 net; revizyon çakışması; görsel yükleme/gizlilik; bildirimde okundu ve incelemenin ayrılması; incelenmeden üretim geçişinin engellenmesi; tamamlanan üretim ve Excel. Canlı iş kayıtları test verisi olarak değiştirilmez.

## 3. Ayrı yayın kararı sonrası uygulanacak sıra

Bu bölüm bir hazırlık sırasıdır; şu anda canlı uygulama üzerinde yürütülmemiştir.

1. Ön kontrol sonucu, yedek ve izole gerçek servis kabul sonuçları birlikte incelenir.
2. Son kod sürümü ve veritabanı değişikliği birlikte değerlendirilerek yayın kararı alınır. Vercel'e bağlı dallar/Preview ayarları kontrol edilir; inceleme için yapılan push'un istenmeyen dağıtım oluşturmadığı doğrulanır.
3. Kısa yayın aralığında ekibin sipariş düzenlemeyi ve üretim geçişlerini durdurması sağlanır. Eski ve yeni istemcilerin eşzamanlı çalışması sınırlandırılır.
4. Mevcut projede yalnızca `202610220004_order_revisions.sql` uygulanır. Yeni/boş test projesine ait birleşik `topraktan-test-kurulum.sql` canlıda kullanılmaz; ilk üç migration yeniden çalıştırılmaz.
5. Uygulamanın hazırlanmış sürümü ve `ORDER_WORKFLOW_ENABLED=1` ayarı birlikte yayınlanır. Bayrak tek başına migration yerine geçmez. Üretim ortamı anahtarları Preview/genel istemci değişkenlerine kopyalanmaz.
6. Migration sonrası aktif yönetici ve imalat sorumlusu hesaplarıyla oturum, mevcut kayıt okuma, bildirim ve normal üretim erişimi kontrol edilir. Temsilî yazma kabul testleri önceden izole ortamda tamamlanmış olmalıdır.
7. Kayıt sayıları, geçmiş ve raporlar karşılaştırılır. Kullanıcılara sayfayı yenilemeleri söylenir; yeni rol ayrımı açıklanır.

## 4. Sorun çıkarsa

Migration transaction içinde çalışır; işlem hatasında transaction tamamen geri alınır. Migration başarılı olduktan sonra yalnızca Vercel sürümünü geri almak veya özellik bayrağını kapatmak tam geri alma değildir: rol kapsamları ve SQL fonksiyonları da değişmiştir. Sipariş düzenleme/iptallerini durdurup belirlenmiş yedek/geri yükleme planı ve sonradan girilen kayıtlar birlikte değerlendirilir. Geçmiş/bildirim/görselleri silen otomatik geri alma SQL'i hazırlanmamıştır.

## Hazır olanlar / bekleyenler

Hazır: kaynak kod, 0004 migration, yerel PostgreSQL/RLS/RPC testleri, tarayıcı akışı, ekran önizlemesi ve örnek Excel, salt okunur ön kontrol.

Bekleyen: canlı ön kontrol çıktısı; doğrulanmış yedek; izole gerçek Supabase/Auth/PostgREST kabul kontrolü; ardından ayrıca yayın kararı. Canlı veritabanında değişiklik ve canlı dağıtım yapılmamıştır.

## Kullanıcının seçtiği geçiş yolu

23 Ekim 2026: Kullanıcı ek PostgreSQL/Docker kurulumu ve manuel yedek alma adımını istemedi; yedeksiz geçişin geri dönüş riskinin arttığı açıklandıktan sonra testlerden sonra uygulama yolunu kabul etti. Gerçek Supabase CI çalışmasının tüm adımlarının yeşil olduğu kullanıcı tarafından bildirildi; hazırlık kontrolünde 1 yönetici, 1 imalat sorumlusu, 1 operatör, 4 sipariş, 7 kalem, 205 ürün ve uyumlu temel izinler görüldü. Yedek alındığı veya canlı SQL'in tamamlandığı varsayılmaz.

Bu geçişte sıralama: yalnızca 0004 SQL dosyası kullanıcı tarafından mevcut projede uygulanır; sonuç alındıktan sonra hazırlanmış uygulama sürümü main'e gönderilir. Vercel API girişinde yeni akış varsayılan açık hazırlanmıştır; bu yüzden ek bir ortam değişkeni girişi gerekmez. Önceden açıkça `ORDER_WORKFLOW_ENABLED=0` tanımlanmışsa kaldırılması/değiştirilmesi gerekir. Bu Vercel varsayılanı yerel sunucunun kapalı varsayılanını değiştirmez. Geliştirme dalının Vercel dağıtımı kapalıdır. SQL sonucu beklenirken main'e yayın yapılmaz.
