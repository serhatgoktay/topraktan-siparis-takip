# Topraktan — Sipariş ve üretim takibi

Bahçe, Küçükpark ve Evka3 şubelerinden İmalat'a sipariş, onay ve üretim takibi. Telefon ve bilgisayar uyumlu Türkçe web uygulaması.

## Güncel mimari

- Node.js 24 sunucusu (`supabase-server.js`) ve aynı kaynaktan sunulan HTML/CSS/JavaScript ekranları.
- **Kullanıcı adı + şifre** girişi. İlk yönetici hesabının adı kullanıcı adı migration'ı sonrasında `hakan` olur; mevcut şifre korunur. Supabase Auth içeride aynı hesap/e-posta kimliğini kullanır, ancak uygulama girişinde e-posta kabul edilmez.
- PostgreSQL ve RLS: şube izolasyonu, onay, ürün düzenleme, özel siparişler ve işlem geçmişi veritabanında korunur.
- Oturum erişim/yenileme belirteçleri HttpOnly/SameSite=Strict çerezlerinde tutulur; tarayıcı JavaScript'ine veya localStorage'a verilmez. Sunucu her istekte Supabase Auth kimliğini ve aktif profili doğrular. Yetkili tablo/RPC isteklerinde **kullanıcının JWT'si** kullanılır.
- Yönetici anahtarı yalnızca Supabase Auth Admin API'de kullanıcı oluşturma ve şifre yenileme için kullanılır; siparişlerin RLS kurallarını atlamak için kullanılmaz.

## Başlatma

```bash
npm ci --cache /tmp/topraktan-npm-cache
npm test
npm start
```

Varsayılan port 3000, `PORT` ile değiştirilebilir. Geliştirmede `npm run dev` kullanılır. `npm run build` dağıtılacak kodların sözdizimini kontrol eder; derleme gerektiren bir ön yüz çatısı yoktur. Node 24'ün ortam proxy desteği `npm start` içinde etkindir.

Proje URL'si ve kullanıcı tarafından sağlanan Publishable key `config.js` içinde tanımlıdır. Bunlar genel bağlantı bilgileridir. Başka proje için `SUPABASE_URL` ve `SUPABASE_PUBLISHABLE_KEY` ortam değişkenleriyle geçersiz kılınabilir. Yerel `.env` dosyası varsa npm start/dev tarafından okunur; Git'e dahil edilmez.

### Kullanıcı yönetiminin tamamlanması

Kullanıcı adıyla giriş ve hesap yönetimi için sunucunun **güvenli ortam değişkenlerine** `SUPABASE_SERVICE_ROLE_KEY` ekleyin. Bu alan için Supabase Settings → API Keys → Legacy API Keys altındaki **service_role JWT** kullanılır. `sb_publishable_...` yeterli değildir; `sb_secret_...` bu adaptörün legacy Authorization başlığı için kullanılmamalıdır. Değeri sohbete, Git'e veya ön yüz koduna koymayın; `VITE_`/`NEXT_PUBLIC_` gibi genel değişken adları kullanmayın.

Bu değişken olmadan **kullanıcı adıyla yeni giriş**, kullanıcı oluşturma ve şifre yenileme açık bir kurulum mesajıyla engellenir. Daha önce açılmış geçerli oturumlarda veri işlemleri kullanıcının JWT'siyle devam eder. Yeni hesap için benzersiz kullanıcı adı, e-posta ve en az 12 karakterli şifre girilir; e-posta hesap altyapısı içindir, girişte kullanıcı adı kullanılır. Kullanıcılar Supabase Auth'da oluşturulur; başlangıçtaki pasif profil yalnızca yöneticinin RPC çağrısıyla etkinleştirilir. Auth hesabı oluşturulup profil güncellemesi başarısız olursa hesap pasif kalır ve kullanıcıya kısmi işlem açıklanır; tekrar hesap oluşturmadan mevcut profil düzenlenmelidir.

Yönetici, Kullanıcılar ekranından kullanıcı adlarını değiştirebilir. Kullanıcı listesi ad ve kullanıcı adını gösterir; diğer hesapların Auth e-postalarını topluca getirmez. Kullanıcı adı/e-posta eşlemesi `resolve_login_username` RPC'siyle yalnız sunucuya açıktır; bu işlevi anonim veya normal oturumlar çağıramaz. Şifre yenileme eski erişim JWT'lerinin anında iptal edildiği anlamına gelmez; JWT ömrü Supabase ayarlarına bağlıdır. Hesap pasifleştirme ve rol değişimleri her istekte profil/RLS ile kontrol edilir.

### İlk yönetici

Bu projenin veritabanı ve ilk yönetici kurulumu kullanıcı tarafından Supabase panelinde tamamlandı. Sıfırdan farklı bir proje kurulacaksa `supabase/README.md` adımlarını izleyin. **Başarılı ilk migration'ı yeniden çalıştırmayın.** Sunucu yönetici hesabı oluşturmaz veya şifre atamaz. Giriş sorununda kullanıcı adını Kullanıcılar ekranından, hesabın e-posta bilgisini gerektiğinde Supabase panelinden kontrol edin; sohbette şifre istemeyin.

## Vercel üzerinden yayın

Depo kökünde `vercel.json` ve Node işlevi `api/index.js` hazırdır. `public/` statik çıktı, `/api/*` istekleri sunucu işlevine yönlendirilir.

1. Kodları GitHub deposuna gönderin.
2. Vercel'de **Add New → Project** ile depoyu içe aktarın.
3. Framework **Other**, Root Directory depo kökü, Node.js **24.x**, Build Command `npm run build`, Output Directory `public` kullanın. `npm ci` kurulumunu kullanın.
4. Vercel projesinin güvenli Environment Variables alanına `SUPABASE_SERVICE_ROLE_KEY` ekleyin. URL/Publishable key config.js içinde hazırdır; istenirse aynı isimli ortam değişkenleriyle verilebilir.
5. Deploy edin. Ortam değişkeni sonradan eklendiyse yeniden deploy edin.
6. Oluşan HTTPS adresinde `hakan` kullanıcı adı ve mevcut yönetici şifresiyle giriş yapın. Ürün ekleme, şube kullanıcısı oluşturma, şubeyle normal/özel sipariş, yönetici onayı, imalatla hazırlama/teslim ve diğer şubenin kayıtlarını görememe kontrollerini yapın.

Bu dosyaların hazır olması **GitHub'a gönderim veya Vercel dağıtımı yapıldığı anlamına gelmez**. Şu aşamada canlı uygulama adresi oluşturulmamıştır. Bulut geliştirme ortamını yayımlamak uygulamayı Vercel'de yayımlamaz. Sunucu Vercel'de Secure çerez kullanır; başka barındırmada HTTPS ve `NODE_ENV=production` veya `COOKIE_SECURE=1` gereklidir.

## Roller ve sipariş akışı

| İşlem | Yönetici | İmalat sorumlusu | Şube operatörü | İmalat operatörü |
| --- | --- | --- | --- | --- |
| Kullanıcı yönetimi | Evet | Hayır | Hayır | Hayır |
| Ürün düzenleme / pasifleştirme | Evet | Evet | Hayır | Hayır |
| Sipariş oluşturma | Tüm şubeler | Tüm şubeler | Kendi şubesi | Hayır |
| Onay / ret | Evet | Evet | Hayır | Hayır |
| Üretim ve teslim durumları | Evet | Evet | Hayır | Evet |
| Geçmiş ve raporlar | Tümü | Tümü | Kendi şubesi | Onaylanmış üretim kayıtları |

Akış: **Onay bekliyor → Onaylandı → Hazırlanıyor → Hazır → Teslim edildi**. Ret gerekçesi zorunludur. Her işlem kullanıcı ve zaman bilgisiyle kaydedilir. Adet/tepsi tam sayı, kg en fazla 3 ondalıklı miktar kabul eder. Katalog dışı özel sipariş girilebilir; ürün adı/birimi sipariş anında saklanır. Tamamlanan veya reddedilen kayıt değiştirilemez.

Raporlar teslim tarihi, şube, durum ve ürün aramasına göre filtrelenir; ölçü birimleri ayrı toplanır. CSV filtrelenen kalemleri içerir; hesap tablosu formül girdilerine karşı metin koruması uygulanır. Varsayılan rapor reddedilenler dahil tüm durumları kapsar; üretim planı için durum filtresi kullanın. Sunucu PostgREST sayfalamasını takip ederek geçmişi ilk API sayfasında kesmez; 100.000 kayıt sınırında sessizce eksiltmek yerine hata bildirir. Ekranlar işlem sonrası veya **Yenile** düğmesiyle güncellenir; Realtime bildirimi eklenmemiştir.

## Testler ve sınırlar

`npm test` aşağıdaki doğrulamaları gerçek HTTP istekleri ve geçici yerel veritabanlarında çalıştırır:

- SQL/RLS: şubeler arası sipariş, kalem ve geçmiş izolasyonu; metadata ile rol yükseltme engeli; onay, üretim zinciri, ret ve atomik kayıt.
- Supabase sunucu adaptörü: Auth/cookie/refresh protokolü, rol ve hesap aktifliği, PostgREST/RPC parametreleri, eksiksiz sayfalama, yönetici anahtarının sadece Auth Admin'e gitmesi ve eksik anahtar davranışı.
- Önceki SQLite uygulamasının API/kalıcılık testleri.

PostgreSQL testi PGlite kullanır; Supabase Auth ve HTTP protokolü yerel test fixture'ında taklit edilir. **Canlı Supabase'de oturum açılması veya canlı sipariş oluşturulması bu testlerle doğrulanmış sayılmaz.** Tarayıcı kontrolleri de yerel PostgreSQL/fixture ile yapılmıştır. Bu çalışma ortamının Supabase adresine egress erişimi ilk denemede proxy tarafından 403 ile engellendi; alan adı izin listesi taslağına eklendi, canlı bağlantı henüz doğrulanamadı.

E-posta bildirimleri, dosya yükleme, sipariş revizyonu/iptali, şifre kurtarma akışı ve Realtime bu sürümde yoktur. Supabase yedekleme, Auth güvenlik/rate-limit ayarları ve canlı kabul testleri yayın öncesinde tamamlanmalıdır.

## Eski SQLite sürümü

`server.js`, `scripts/setup.sh` ve ilgili testler önceki yerel sürüm içindir; veriler varsa `data/` dizini korunur. Manuel kullanım: `npm run setup:sqlite`, ardından `npm run start:sqlite`. Güncel kullanıcı adı ekranı Supabase için tasarlandığından eski SQLite sürümü aktif yayın hedefi değildir. Otomatik SQLite → Supabase veri aktarımı yapılmaz.

## Kategori, pasta boyutu ve logo güncellemesi

Canlı projede ilk migration zaten çalıştırıldıysa **yalnızca** `supabase/migrations/202610210002_catalog_servings.sql` dosyasını Supabase SQL Editor'da tam metin olarak çalıştırın. Bu adım uzaktan otomatik uygulanmaz. Dosya tekrar çalıştırılabilir; mevcut ürün ve siparişler silinmez, örnek ürün eklenmez. Sıfırdan projede önce `202610210001_initial.sql`, sonra bu güncelleme çalıştırılır.

Kategori listesi: Çikolatalar, Pastalar, Tatlı kurabiyeler, Sütlü tatlılar, Şerbetli tatlılar, Tuzlu kurabiyeler. Pastalar altında Figürlü adet pastalar, Bebek ve çocuk pastaları, Kutlama pastaları, Vitrin pastaları, Adet pastalar ve Cheesecake bulunur. Katalog yönetiminde kategori/alt kategoriyle filtreleme ve ürün ekleme/düzenleme vardır. Ürünleri yönetici veya imalat sorumlusu kendisi ekler.

Bebek ve çocuk pastaları, Kutlama pastaları, Vitrin pastaları ve Cheesecake ürünleri için siparişte **4 / 6 / 8 kişilik / Diğer** seçilir. Diğer, 1–10.000 arası pozitif tam sayı kabul eder. Kişi sayısı pasta boyutudur; örneğin miktar 2, kişi sayısı 6, iki adet altı kişilik pasta demektir. Figürlü adet pastalar, Adet pastalar ve diğer ana kategorilerde kişilik alanı gösterilmez. Özel siparişler de kategori ve kişilik kurallarından geçer. Mevcut kategorisiz ürünler korunur ve sınıflandırılana kadar sipariş edilebilir; yeni ürün için kategori zorunludur.

Sipariş kalemlerinde ürün adı/birimiyle birlikte kategori, alt kategori ve kişi sayısı snapshot olarak tutulur; katalogda sonraki düzenlemeler eski siparişleri değiştirmez. Üretim ayrıntıları, geçmiş, rapor ve CSV kişi sayısını gösterir. Aynı pastanın farklı kişilikleri ayrı rapor satırlarıdır. Yeni sunucu `save_product_v2` ve `create_order_v2` kullanır; eski RPC yazma izinleri doğrulamayı atlamamak için kaldırılır. Eksik migration açık bir kurulum mesajı verir; eski işlevlere sessiz dönüş yapılmaz.

Logo, kullanıcının sağladığı `topraktan-logo.tif` dosyasından renk/görünüm değiştirilmeden kayıpsız PNG'ye dönüştürüldü (`public/logo.png`, 2139×695). Giriş ekranı, yan menü ve site simgesi aynı görseli kullanır. Orijinal siyah zemin ve beyaz yazı korunmuştur.

## Kullanıcı adı geçişi

Canlı projede yalnızca `supabase/migrations/202610210003_usernames.sql` dosyasının tamamını Supabase SQL Editor'da çalıştırın. İlk kurulum ve kategori migration'ı daha önce kullanıcı tarafından başarıyla çalıştırıldı; bunları yeniden uygulamak gerekmez. Sıfırdan kurulumda üç dosya ad sırasıyla uygulanır. Kullanıcı adı migration'ı tekrar çalıştırılabilir; mevcut kullanıcı adlarını sıfırlamaz.

İlk yönetici `hakan`; ilk şube operatörleri `bahce`, `kucukpark`, `evka3`, `imalat`; imalat sorumlusu `imalat_sorumlusu` adını alır. Aynı rolde/birimde birden çok hesap varsa sayı eklenir (`bahce2` vb.). Hesap UUID'leri, e-postalar, şifreler, roller, aktiflik ve sipariş ilişkileri korunur. İşlemden sonra yönetici Kullanıcılar ekranından adları düzenleyebilir. Yeni kayıtlar pasif ve kullanıcı adı atanmamış olarak başlar; yalnız yönetici hesabı etkinleştirip ad atayabilir.

Kullanıcı adları 3–32 karakterdir; a-z, 0-9, nokta, tire ve alt çizgi kabul edilir. Büyük/küçük harf farkı yoktur; kullanıcı adları küçük harfe çevrilir ve tekil indeksle korunur. Aktif bir profilde kullanıcı adı bulunması zorunludur. Bilinmeyen, pasif veya şifresi yanlış hesaplar girişte aynı hata yanıtını verir. Kullanıcı adı eşlemesi/e-posta döndüren RPC yalnız `service_role` tarafından çağrılabilir; sipariş/RLS çağrıları yine kullanıcı JWT'siyle yapılır. Kullanıcı adı değişikliği mevcut oturum kimliğini veya şifreyi değiştirmez.

Bu yeni migration canlıda henüz doğrulanmamıştır; SQL ve Auth protokolü yerel testlerde doğrulanmıştır. Migration eksikken giriş e-postaya geri dönmez; açıklayıcı 503 kurulum hatası verir.

## Sipariş tarihi

Siparişin oluşturulduğu `created_at` zamanı sipariş tarihi olarak listelerde (genel bakış, siparişler ve geçmiş), ayrıntılarda ve CSV'de gösterilir. Teslim tarihi ayrı tutulur. Geçmiş/rapor tarih aralığında **Tarih alanı** seçilerek sipariş veya teslim tarihine göre filtrelenebilir; varsayılan teslim tarihidir. Oluşturma zamanı Türkiye saatine göre takvim gününe çevrilir; gece yarısı UTC farkı rapor gününü kaydırmaz. Sipariş tarihi otomatik kayıttır ve elle değiştirilmez. Yeni SQL migration'ı gerekmez; mevcut kayıtların oluşturma zamanı kullanılır.

Excel raporu **Raporlar → Excel indir** üzerinden gerçek `.xlsx` dosyası olarak indirilir. Siparişler, Ürün toplamları, Şube özeti ve Rapor bilgisi sayfalarını içerir. Ekrandaki tarih alanı, tarih aralığı, şube, durum ve arama filtreleri uygulanır. Sunucu kullanıcı oturumuyla RLS üzerinden okur; şube operatörü başka şubenin verisini indiremez. Tarihler Excel tarih hücresi, miktarlar sayısal hücre olarak yazılır; ürün metinleri formül olarak çalıştırılmaz. Dosya başına 20.000 sipariş kalemi sınırında daha dar tarih aralığı istenir. Dosya üretimi için sunucuda ExcelJS kullanılır.

### Küçük ekleme: onay öncesi sipariş düzenleme

Onay bekleyen siparişte yönetici veya ilgili şube operatörü teslim tarihini, notu ve mevcut kalem miktarlarını düzenleyebilir. Kalem/ürün/kişi sayısı/şube değiştirilmez; kalem silinmez. İmalat sorumlusunun ve diğer rollerin mevcut onay, üretim, katalog ve kullanıcı yetkileri korunur. Onaylanmış sipariş düzenlenemez. Eski ekrandan yazma `PT409` ile durdurulur; değişiklik gerekçesi ve eski/yeni değerler mevcut işlem geçmişine eklenir.

Bu özellik [202610230005_pending_order_edit.sql](supabase/migrations/202610230005_pending_order_edit.sql) içindeki yalnızca iki yeni fonksiyonu kullanır. Yeni tablo, kolon, ilişki, rol veya RLS politikası gerektirmez. SQL uygulanmamışken sipariş/katalog/giriş/rapor ekranları çalışmaya devam eder; `/api/capabilities` düzenlemeyi kapalı bildirir ve düğme görünmez. Kurulum sonucu `DUZENLEME_HAZIR` olmalı; genel Success mesajı kurulum kanıtı değildir. Eski büyük sipariş/iptal/görsel güncelleme dosyaları bu ekleme için kullanılmaz.

Testler: `node --test tests/pending-edit.test.js` sunucusuz Vercel işleyicisini doğrudan ve PostgreSQL/RLS üzerinde doğrular. `CHROMIUM_PATH=/usr/bin/chromium node scripts/check-pending-edit-browser.mjs` isteğe bağlı Playwright kurulumu olan ortamda SQL yokken ve varken tarayıcı akışını kontrol eder. GitHub Actions **Pending order edit compatibility** görevi geçici gerçek Supabase'de önce eski kurulumla, sonra yalnızca bu SQL eklemesiyle test eder; hosted projenin anahtarlarını kullanmaz.

### Onay öncesi ürün ekleme ve çıkarma

005 güncellemesinden sonra [202610230006_pending_order_items.sql](supabase/migrations/202610230006_pending_order_items.sql) uygulanır. Sonuç `URUN_DUZENLEME_HAZIR` olmalıdır. Bu ekleme yeni tablo, kolon, rol veya RLS politikası oluşturmaz; önceki düzenleme işlevini korur. SQL eksikken mevcut miktar düzenleme çalışır, ürün ekleme/çıkarma düğmeleri kapalı kalır.

Onay bekleyen siparişe katalog veya özel ürün eklenebilir. Çıkarılan kalem kaydetmeden önce geri alınabilir; siparişte en az bir ürün bulunmalıdır. Kalan kalemlerin kimlikleri ve ürün bilgileri korunur. Çıkarılan kalemlerin bilgileri dahil eski/yeni ürün listesi ve gerekçe mevcut işlem geçmişine kaydedilir. Yetkiler önceki düzenleme ile aynıdır; onaylanmış veya başka şubeye ait sipariş değiştirilemez.

`tests/pending-items.test.js` eski SQL ile uyumluluğu, ekleme/çıkarma, miktar ve kişi sayısı doğrulamasını, yetkileri, eşzamanlı değişiklikleri ve hatada işlemin geri alınmasını kontrol eder. Tarayıcı kontrolü SQL yokken, yalnız miktar düzenleme açıkken ve ürün düzenleme açıkken çalışır.

### Özel sipariş açıklaması ve referans fotoğrafı

[202610230007_custom_order_details.sql](supabase/migrations/202610230007_custom_order_details.sql) ayrı ve tekrar çalıştırılabilir küçük güncellemedir; sonuç `OZEL_SIPARIS_GORSEL_HAZIR` olmalıdır. Yeni `order_custom_details` tablosu yalnız sipariş açıklaması ve bir referans fotoğrafı saklar. Mevcut tablolar, sipariş oluşturma/düzenleme işlevleri, roller ve onların RLS politikaları değişmez. SQL eksikken yeni alanlar kapalıdır; mevcut sipariş akışı sürer.

Yeni siparişte en az bir özel ürün varsa açıklama, **Resim seç** ve **Kamerayla çek** alanları açılır. Açıklama isteğe bağlı, en fazla 2000 karakterdir; bir fotoğraf eklenebilir. Fotoğraf tarayıcıda en fazla 1600 piksele küçültülüp JPEG olarak sıkıştırılır; 20 MB kaynak dosya ve 450 KB kayıt sınırı bulunur. Fotoğraf önizlenebilir, kaldırılabilir veya değiştirilebilir. Kamera desteği mobil tarayıcıya bağlıdır; masaüstünde dosya seçimi açılabilir. HEIC dosyasını açamayan tarayıcıda JPG/PNG/WebP seçilmesi istenir. Yeni fotoğraf ve açıklama siparişle tek veritabanı işleminde kaydedilir; hata halinde kısmi sipariş oluşmaz.

Sipariş ayrıntısında açıklama ve büyütülebilen fotoğraf görünür. Fotoğraf yalnız oturumla ve mevcut sipariş okuma yetkisiyle açılır; imalat operatörünün mevcut onay sonrası okuma kuralı korunur. Fotoğraflar sipariş listelerine veya rapor yüküne katılmaz. Ayrıntılar kayıttan sonra bu güncellemeyle düzenlenmez; mevcut sipariş ürün düzenlemesi referans ayrıntılarını korur. Doğrudan tablo yazımı kapalıdır.

`node tests/custom-order.test.js` gerçek PostgreSQL/RLS üzerinde kayıt, fotoğraf yanıtı, şube ayrımı, üretim erişimi, anonim erişim reddi, geçersiz veri, tekrar kurulum ve eski SQL uyumluluğunu doğrular. `scripts/check-custom-order-browser.mjs` önizleme, galeri/kamera dosya girdileri, fotoğraf kaldırma, mobil taşma ve ayrıntı görüntüleme akışları için hazırlanmıştır. Gerçek telefon kamerasıyla çekim cihaz üzerinde kontrol edilmelidir.
