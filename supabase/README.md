# Supabase kurulumu ve geçiş durumu

Proje URL'si `config.js` içinde tanımlıdır. Publishable key genel bağlantı bilgisidir. Şifreler ve service_role anahtarı kaynak kodunda bulunmaz.

## Bu projede tamamlanan panel adımları

Kullanıcı, `migrations/202610210001_initial.sql` şemasını Supabase SQL Editor'da başarıyla çalıştırdığını bildirdi. İlk Auth hesabının `profiles` kaydı `admin`, `active=true` olarak güncellendi. Bu kurulum script'ini aynı projede yeniden çalıştırmayın. Kullanıcı tarafından bildirilen panel sonuçları canlı API doğrulaması yerine geçmez.

## Uygulama bağlantısı

`npm start` artık `supabase-server.js` çalıştırır. E-posta/şifre Supabase Auth'a gider, siparişler ve ürünler RLS/RPC üzerinden PostgreSQL'de tutulur. Yetkili veri çağrıları kullanıcının doğrulanmış JWT'siyle yapılır. Yerel SQLite çalışma zamanı varsayılan değildir.

Yeni hesap açma/şifre yenileme için sunucu ortamında legacy `SUPABASE_SERVICE_ROLE_KEY` gerekir. Değeri yalnızca güvenli ortam ayarlarına girin. Ayrıntılar kök README'dedir. Tarayıcıya yönetici anahtarı gönderilmez. Diğer işlemler yalnızca Publishable key ve kullanıcı oturumuyla çalışır.

## Yeni bir proje kurulacaksa

1. Supabase'de yeni proje oluşturun.
2. SQL Editor → New query içinde migration dosyasının **tamamını**, `begin;` ile `commit;` arasında tek sorgu olarak çalıştırın. Kodun ön izlemesinden ilk 100 satırı almak eksik fonksiyon tanımı hatasına yol açar.
3. `units`, `profiles`, `products`, `orders`, `order_items`, `order_events` tablolarını doğrulayın.
4. Authentication → Users → Add user ile kendi yönetici hesabınızı oluşturun. Auto Confirm User etkin olmalıdır. Şifreyi paylaşmayın.
5. SQL Editor'da doğru User UID ile yalnızca bu hesabın `profiles` kaydını `role='admin',active=true,unit_id=null` yapın.
6. `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` ortam değişkenlerini yeni projeye göre ayarlayın.

Migration tek transaction içindedir; mevcut tabloları silmez. Aynı adlı tablo/trigger varsa durur. Kullanıcı metadata'sındaki rol/aktiflik alanları dikkate alınmaz; yeni hesaplar pasif, birime atanmamış operatör profiliyle başlar.

## Doğrulama

`npm test` yerel PostgreSQL/PGlite üzerinde RLS'yi ve Supabase adaptörünü test eder. Auth bu testlerde taklit edilir. Gerçek giriş, ağ erişimi, Supabase Auth yapılandırması ve canlı yayın ayrıca doğrulanmalıdır. Ürün, birim, miktar snapshot'ları ve işlem geçmişi RPC içinde atomik yazılır. Genel raporlar da erişimi kısıtlanan sipariş verisinden hesaplanır.

## Kategori güncellemesi (canlıda uygulanması bekleniyor)

Uygulama artık `202610210002_catalog_servings.sql` dosyasındaki `save_product_v2` / `create_order_v2` işlevlerini kullanır. Dosyanın tamamını mevcut projede SQL Editor → New query → Run ile çalıştırın. İlk migration'ı tekrarlamayın. Bu yeni migration mevcut veriyi korur ve tekrar uygulanabilir. Yerel testlerde migration'ın iki kez çalıştırılması, eski ürün/siparişlerin korunması, yetki kontrolleri ve 4/6/8/Diğer kişilik seçenekleri doğrulanmıştır; canlı projede uygulanması henüz doğrulanmamıştır.

GitHub dosyasını açarken **Copy raw file** düğmesini kullanın; bir ön izleme ekranının yalnızca ilk 100 satırını kopyalamayın. Son satır `commit;` olmalıdır.
