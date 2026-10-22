import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from '../test-support/supabase-fixture.js';
const sql=readFileSync(new URL('../supabase/checks/release_preflight.sql',import.meta.url),'utf8');
async function check(f){return (await f.db.exec(sql)).flatMap(r=>r.rows).find(r=>r.kontrol_sonucu);}
test('Yayın ön kontrolü salt okunurdur; mevcut ve yeni sürümü ayırt eder',async t=>{
 const current=await fixture();t.after(()=>current.close());
 const result=await check(current);assert.equal(result.kontrol_sonucu,'ON_KONTROL_UYUMLU_YAYIN_HENUZ_ONAYLANMADI');assert.equal(result.aktif_imalat_sorumlusu,1);assert.equal(result.mevcut_rls_acik,true);assert.equal(result.dogrudan_yazma_kapali,true);
 assert.equal((await current.sql(null,"select to_regclass('public.production_notifications') as table_name")).rows[0].table_name,null);
 await current.sql(null,"update public.profiles set active=false where role='manager'");
 assert.equal((await check(current)).kontrol_sonucu,'KULLANICI_YETKILERI_TAMAMLANMALI');
 const updated=await fixture({workflowMigration:true});t.after(()=>updated.close());
 assert.equal((await check(updated)).kontrol_sonucu,'YENI_SURUM_IZI_VAR_AYRICA_INCELENECEK');
});
