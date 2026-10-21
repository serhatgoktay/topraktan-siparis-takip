# Topraktan — Sipariş ve üretim takibi

Bahçe, Küçükpark ve Evka3 şubelerinden İmalat'a sipariş, onay ve üretim takibi. Telefon ve bilgisayar uyumlu Türkçe web uygulaması.

## Güncel mimari

- Node.js 24 sunucusu (`supabase-server.js`) ve aynı kaynaktan sunulan HTML/CSS/JavaScript ekranları.
- Supabase Auth ile **e-posta + şifre** girişi. Yönetici de Supabase'de oluşturulan e-postasıyla giriş yapar; eski SQLite `admin` hesabı kullanılmaz.
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

Sunucunun **güvenli ortam değişkenlerine** `SUPABASE_SERVICE_ROLE_KEY` ekleyin. Bu alan için Supabase Settings → API Keys → Legacy API Keys altındaki **service_role JWT** kullanılır. `sb_publishable_...` yeterli değildir; `sb_secret_...` bu adaptörün legacy Authorization başlığı için kullanılmamalıdır. Değeri sohbete, Git'e veya ön yüz koduna koymayın; `VITE_`/`NEXT_PUBLIC_` gibi genel değişken adları kullanmayın.

Bu değişken olmadan giriş, ürünler, siparişler, geçmiş, raporlar ve mevcut profillerin rol/birim/aktiflik yönetimi kullanılabilir. **Yeni kullanıcı oluşturma ve şifre yenileme** açık bir kurulum mesajıyla engellenir. Sayfa üzerinden yeni kayıt için e-posta ve en az 12 karakterli şifre girilir. Kullanıcılar Supabase Auth'da oluşturulur; başlangıçtaki pasif profil yalnızca yöneticinin RPC çağrısıyla etkinleştirilir. Auth hesabı oluşturulup profil güncellemesi başarısız olursa hesap pasif kalır ve kullanıcıya kısmi işlem açıklanır; tekrar hesap oluşturmadan mevcut profil düzenlenmelidir.

Giriş e-postası Supabase Authentication üzerinden yönetilir. Uygulama kullanıcı listesi profil adlarını gösterir; diğer hesapların Auth e-postalarını topluca getirmez. Şifre yenileme eski erişim JWT'lerinin anında iptal edildiği anlamına gelmez; JWT ömrü Supabase ayarlarına bağlıdır. Hesap pasifleştirme ve rol değişimleri her istekte profil/RLS ile kontrol edilir.

### İlk yönetici

Bu projenin veritabanı ve ilk yönetici kurulumu kullanıcı tarafından Supabase panelinde tamamlandı. Sıfırdan farklı bir proje kurulacaksa `supabase/README.md` adımlarını izleyin. **Başarılı ilk migration'ı yeniden çalıştırmayın.** Sunucu yönetici hesabı oluşturmaz veya şifre atamaz. Giriş sorununda e-postayı/şifreyi kullanıcı panelde kontrol etmelidir; sohbette şifre istemeyin.

## Vercel üzerinden yayın

Depo kökünde `vercel.json` ve Node işlevi `api/index.js` hazırdır. `public/` statik çıktı, `/api/*` istekleri sunucu işlevine yönlendirilir.

1. Kodları GitHub deposuna gönderin.
2. Vercel'de **Add New → Project** ile depoyu içe aktarın.
3. Framework **Other**, Root Directory depo kökü, Node.js **24.x**, Build Command `npm run build`, Output Directory `public` kullanın. `npm ci` kurulumunu kullanın.
4. Vercel projesinin güvenli Environment Variables alanına `SUPABASE_SERVICE_ROLE_KEY` ekleyin. URL/Publishable key config.js içinde hazırdır; istenirse aynı isimli ortam değişkenleriyle verilebilir.
5. Deploy edin. Ortam değişkeni sonradan eklendiyse yeniden deploy edin.
6. Oluşan HTTPS adresinde kendi Supabase hesabınızla giriş yapın. Ürün ekleme, şube kullanıcısı oluşturma, şubeyle normal/özel sipariş, yönetici onayı, imalatla hazırlama/teslim ve diğer şubenin kayıtlarını görememe kontrollerini yapın.

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

`server.js`, `scripts/setup.sh` ve ilgili testler önceki yerel sürüm içindir; veriler varsa `data/` dizini korunur. Manuel kullanım: `npm run setup:sqlite`, ardından `npm run start:sqlite`. Güncel e-posta ekranı Supabase için tasarlandığından eski SQLite sürümü aktif yayın hedefi değildir. Otomatik SQLite → Supabase veri aktarımı yapılmaz.
