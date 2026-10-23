import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const verificationSQL=`with checks as (
 select
 to_regclass('public.order_images') is not null as gorsel_tablosu,
 exists(select 1 from pg_constraint where conrelid=to_regclass('public.order_images') and confrelid=to_regclass('public.orders') and contype='f') as siparis_iliskisi,
 to_regclass('public.production_notifications') is not null as bildirim_tablosu,
 to_regclass('public.notification_reads') is not null as okundu_tablosu,
 to_regprocedure('public.create_order_v3(smallint,date,jsonb,text)') is not null as yeni_siparis_islevi,
 to_regprocedure('public.edit_order(bigint,integer,date,text,jsonb,text)') is not null as duzenleme_islevi,
 to_regprocedure('public.cancel_order_items(bigint,integer,jsonb,text)') is not null as iptal_islevi,
 to_regprocedure('public.production_message(bigint,text,boolean)') is not null as imalat_notu_islevi,
 to_regprocedure('public.read_production_notification(bigint,boolean)') is not null as inceleme_islevi,
 to_regprocedure('public.set_order_image(bigint,integer,bigint,text,text,text)') is not null as gorsel_yukleme_islevi,
 to_regprocedure('public.get_order_image(bigint)') is not null as gorsel_okuma_islevi,
 (select count(*)=3 from information_schema.columns where table_schema='public' and table_name='orders' and column_name in ('revision','approved_at','production_hold')) as siparis_alanlari
)
select case when gorsel_tablosu and siparis_iliskisi and bildirim_tablosu and okundu_tablosu and yeni_siparis_islevi and duzenleme_islevi and iptal_islevi and imalat_notu_islevi and inceleme_islevi and gorsel_yukleme_islevi and gorsel_okuma_islevi and siparis_alanlari
 then 'GUNCELLEME_TAMAMLANDI' else 'KURULUM_EKSIK' end as durum, checks.* from checks;`;

export function buildProductionUpdate(source){
 // PostgreSQL executes the entire migration inside one atomic DO statement.
 // The fixed Base64 payload is exactly the reviewed canonical migration, without
 // its outer transaction commands. It performs no download or external access.
 const inner=source.replace(/^begin;[ \t]*$/gmi,'').replace(/^commit;[ \t]*$/gmi,'');
 const sha=createHash('sha256').update(source).digest('hex');
 const encoded=Buffer.from(inner,'utf8').toString('base64');
 return `-- TOPRAKTAN: mevcut proje icin tek islemli 0004 guncellemesi.\n-- Kaynak: supabase/migrations/202610220004_order_revisions.sql\n-- Kaynak SHA256: ${sha}\n-- DOSYANIN TAMAMINI calistirin. Sonucta durum ve tum kontrolleri paylasin.\n-- Yalnizca Success yazisini tam kurulum kaniti olarak kullanmayin.\nDO 'BEGIN\n EXECUTE convert_from(decode(''${encoded}'',''base64''),''UTF8'');\n IF to_regclass(''public.order_images'') IS NULL OR to_regclass(''public.production_notifications'') IS NULL OR to_regprocedure(''public.edit_order(bigint,integer,date,text,jsonb,text)'') IS NULL THEN\n  RAISE EXCEPTION ''Kurulum eksik; islem geri alindi'';\n END IF;\nEND';\n\n${verificationSQL}\n`;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const source=readFileSync(new URL('../supabase/migrations/202610220004_order_revisions.sql',import.meta.url),'utf8');
 const target=process.argv[2]||fileURLToPath(new URL('../supabase/releases/order_workflow.sql',import.meta.url));
 writeFileSync(target,buildProductionUpdate(source));console.log('Tek islemli SQL dosyasi olusturuldu.');
}
