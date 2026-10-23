import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from '../test-support/supabase-fixture.js';
import {buildProductionUpdate,verificationSQL} from '../scripts/build-production-update.mjs';
const source=readFileSync(new URL('../supabase/migrations/202610220004_order_revisions.sql',import.meta.url),'utf8');
async function result(db,sql){return (await db.exec(sql)).flatMap(r=>r.rows).find(r=>r.durum);}
test('Tek islemli kurulum eksik secimde basari bildirmez; tam kurulum ve tekrari dogrulanir',async t=>{
 const f=await fixture();t.after(()=>f.close());
 assert.equal((await result(f.db,verificationSQL)).durum,'KURULUM_EKSIK');
 const sql=buildProductionUpdate(source);assert.ok(!sql.includes('$$'));
 assert.equal((await result(f.db,sql)).durum,'GUNCELLEME_TAMAMLANDI');
 assert.equal((await result(f.db,sql)).durum,'GUNCELLEME_TAMAMLANDI');
 const names=(await f.sql(null,'select username from public.profiles order by username')).rows;assert.equal(names.length,6);
});
test('Kurulumun ortasindaki hata yeni tablo ve alanlari tamamen geri alir',async t=>{
 const f=await fixture();t.after(()=>f.close());
 const broken=source.replace('commit;','select public.nonexistent_topraktan_function();\ncommit;');
 await assert.rejects(f.db.exec(buildProductionUpdate(broken)),/nonexistent_topraktan_function/);
 assert.equal((await result(f.db,verificationSQL)).durum,'KURULUM_EKSIK');
 assert.equal((await f.sql(null,"select to_regclass('public.order_images') as name")).rows[0].name,null);
 assert.equal((await f.sql(null,"select count(*) as n from information_schema.columns where table_schema='public' and table_name='orders' and column_name='revision'")).rows[0].n,0);
});
