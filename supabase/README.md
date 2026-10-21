# Supabase kurulumu ve geçiş durumu

Proje URL'si `config.js` içinde tanımlıdır. Publishable key genel bağlantı bilgisidir. Şifreler ve service_role anahtarı kaynak kodunda bulunmaz.

## Bu projede tamamlanan panel adımları

Kullanıcı, `migrations/202610210001_initial.sql` şemasını Supabase SQL Editor'da başarıyla çalıştırdığını bildirdi. İlk Auth hesabının `profiles` kaydı `admin`, `active=true` olarak güncellendi. Bu kurulum script'ini aynı projede yeniden çalıştırmayın. Kullanıcı tarafından bildirilen panel sonuçları canlı API doğrulaması yerine geçmez.

## Uygulama bağlantısı

`npm start` artık `supabase-server.js` çalıştırır. Giriş kullanıcı adı/şifreyle yapılır. Sunucu, kullanıcı adının e-posta eşlemesini yalnız service_role yetkili RPC'den alıp Supabase Auth'a iletir; siparişler ve ürünler RLS/RPC üzerinden PostgreSQL'de tutulur. Yetkili veri çağrıları kullanıcının doğrulanmış JWT'siyle yapılır. Yerel SQLite çalışma zamanı varsayılan değildir.

Kullanıcı adıyla giriş ve yeni hesap açma/şifre yenileme için sunucu ortamında legacy `SUPABASE_SERVICE_ROLE_KEY` gerekir. Değeri yalnızca güvenli ortam ayarlarına girin. Ayrıntılar kök README'dedir. Tarayıcıya yönetici anahtarı gönderilmez. Sipariş ve katalog işlemleri Publishable key ve kullanıcı oturumuyla çalışır.

## Yeni bir proje kurulacaksa

1. Supabase'de yeni proje oluşturun.
2. SQL Editor → New query içinde migration dosyasının **tamamını**, `begin;` ile `commit;` arasında tek sorgu olarak çalıştırın. Kodun ön izlemesinden ilk 100 satırı almak eksik fonksiyon tanımı hatasına yol açar.
3. `units`, `profiles`, `products`, `orders`, `order_items`, `order_events` tablolarını doğrulayın.
4. Authentication → Users → Add user ile kendi yönetici hesabınızı oluşturun. Auto Confirm User etkin olmalıdır. Şifreyi paylaşmayın.
5. SQL Editor'da doğru User UID ile yalnızca bu hesabın `profiles` kaydını `role='admin',active=true,unit_id=null` yapın.
6. `202610210002_catalog_servings.sql` ve ardından `202610210003_usernames.sql` dosyalarını tam metin olarak çalıştırın. İlk yöneticinin kullanıcı adı `hakan` olur.
7. `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` ortam değişkenlerini yeni projeye göre ayarlayın.

Migration tek transaction içindedir; mevcut tabloları silmez. Aynı adlı tablo/trigger varsa durur. Kullanıcı metadata'sındaki rol/aktiflik alanları dikkate alınmaz; yeni hesaplar pasif, birime atanmamış operatör profiliyle başlar.

## Doğrulama

`npm test` yerel PostgreSQL/PGlite üzerinde RLS'yi ve Supabase adaptörünü test eder. Auth bu testlerde taklit edilir. Gerçek giriş, ağ erişimi, Supabase Auth yapılandırması ve canlı yayın ayrıca doğrulanmalıdır. Ürün, birim, miktar snapshot'ları ve işlem geçmişi RPC içinde atomik yazılır. Genel raporlar da erişimi kısıtlanan sipariş verisinden hesaplanır.

## Kategori güncellemesi (kullanıcı başarı bildirdi)

Uygulama artık `202610210002_catalog_servings.sql` dosyasındaki `save_product_v2` / `create_order_v2` işlevlerini kullanır. Dosyanın tamamını mevcut projede SQL Editor → New query → Run ile çalıştırın. İlk migration'ı tekrarlamayın. Bu yeni migration mevcut veriyi korur ve tekrar uygulanabilir. Yerel testlerde migration'ın iki kez çalıştırılması, eski ürün/siparişlerin korunması, yetki kontrolleri ve 4/6/8/Diğer kişilik seçenekleri doğrulanmıştır; kullanıcı canlı panelde başarılı sonucu ve arayüzde yeni alanları gördüğünü bildirmiştir; bağımsız canlı API testi yapılmamıştır.

GitHub dosyasını açarken **Copy raw file** düğmesini kullanın; bir ön izleme ekranının yalnızca ilk 100 satırını kopyalamayın. Son satır `commit;` olmalıdır.

## Kullanıcı adı güncellemesi (canlıda uygulanması bekleniyor)

`202610210003_usernames.sql` dosyasını SQL Editor'da tam metin olarak çalıştırın. Ürün/sipariş tablolarına veya Auth şifrelerine dokunulmaz. `profiles.username` eklenir; ilk yönetici `hakan`, operatörler birimlerine göre ad alır. Dosya tekrar çalıştırılabilir ve var olan kullanıcı adlarını korur. Giriş artık e-posta kabul etmez. Sunucu ortamında önceden tanımlanan `SUPABASE_SERVICE_ROLE_KEY` kullanıcı adı eşlemesi için de gereklidir; anahtarı sohbette paylaşmayın. Yönetici Kullanıcılar ekranından benzersiz adları değiştirebilir.
