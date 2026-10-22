-- SALT OKUNUR KONTROL: tablo, kullanıcı, sipariş veya yetki değiştirmez.
-- Mevcut Topraktan projesinde SQL Editor'da dosyanın tamamını çalıştırın.
-- Sonuç yalnızca hazırlık durumunu ve toplam sayıları içerir; kişisel bilgi/anahtar içermez.
begin transaction read only;
set local statement_timeout='10s';
with required_tables(name) as (
 values('units'),('profiles'),('products'),('orders'),('order_items'),('order_events')
), required_columns(tab,col) as (
 values('profiles','username'),('products','category'),('products','subcategory'),
 ('order_items','category'),('order_items','subcategory'),('order_items','servings')
), required_functions(signature) as (
 values('public.create_order_v2(smallint,date,jsonb,text)'),
 ('public.save_product_v2(text,text,text,text,bigint,boolean)'),
 ('public.change_order_status(bigint,text,text)'),
 ('public.resolve_login_username(text)'),
 ('public.admin_set_profile_v2(uuid,text,text,smallint,boolean,text)')
), checks as (
 select
 (select bool_and(to_regclass('public.'||name) is not null) from required_tables) as tablolar_hazir,
 (select bool_and(exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=r.tab and c.column_name=r.col)) from required_columns r) as onceki_guncellemeler_hazir,
 (select bool_and(to_regprocedure(signature) is not null) from required_functions) as islevler_hazir,
 (select count(*)=6 and bool_and(c.relrowsecurity) from required_tables t join pg_class c on c.oid=to_regclass('public.'||t.name)) as mevcut_rls_acik,
 (select not bool_or(has_table_privilege('authenticated',c.oid,'INSERT') or has_table_privilege('authenticated',c.oid,'UPDATE') or has_table_privilege('authenticated',c.oid,'DELETE')) from required_tables t join pg_class c on c.oid=to_regclass('public.'||t.name)) as dogrudan_yazma_kapali,
 (select count(*) from public.profiles where active and role='admin') as aktif_yonetici,
 (select count(*) from public.profiles where active and role='manager') as aktif_imalat_sorumlusu,
 (select count(*) from public.profiles where active and role='operator') as aktif_operator,
 (select count(*) from public.orders) as siparis_sayisi,
 (select count(*) from public.order_items) as kalem_sayisi,
 (select count(*) from public.products) as urun_sayisi,
 (select count(*)=4 from public.units where (id=1 and name='Bahçe' and kind='branch') or (id=2 and name='Küçükpark' and kind='branch') or (id=3 and name='Evka3' and kind='branch') or (id=4 and name='İmalat' and kind='production')) as birimler_uyumlu,
 (select count(*) from public.profiles where active and (username is null or (role='operator' and unit_id is null))) as eksik_aktif_profil,
 (select bool_or(to_regclass('public.'||name) is not null) from (values('order_images'),('production_notifications'),('notification_reads')) n(name)) as yeni_tablo_var,
 (select exists(select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='revision')) as yeni_surum_alani_var,
 to_regprocedure('public.create_order_v3(smallint,date,jsonb,text)') is not null as yeni_islev_var
)
select
 case
  when yeni_tablo_var or yeni_surum_alani_var or yeni_islev_var then 'YENI_SURUM_IZI_VAR_AYRICA_INCELENECEK'
  when not(tablolar_hazir and onceki_guncellemeler_hazir and islevler_hazir and mevcut_rls_acik and dogrudan_yazma_kapali and birimler_uyumlu) then 'SEMA_VE_YETKILER_INCELENECEK'
  when aktif_yonetici=0 or aktif_imalat_sorumlusu=0 or eksik_aktif_profil>0 then 'KULLANICI_YETKILERI_TAMAMLANMALI'
  else 'ON_KONTROL_UYUMLU_YAYIN_HENUZ_ONAYLANMADI'
 end as kontrol_sonucu,
 *
from checks;
commit;
