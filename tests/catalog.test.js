import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from '../test-support/supabase-fixture.js';
import {CATEGORIES,CAKE_SUBCATEGORIES,SERVING_SUBCATEGORIES,needsServings,summarizeProducts} from '../public/catalog.js';
const migration=readFileSync(new URL('../supabase/migrations/202610210002_catalog_servings.sql',import.meta.url),'utf8');
const account=(f,email)=>[...f.accounts.values()].find(a=>a.email===email+'@example.test').id;
async function product(f,id,category,subcategory=null,name=category){return Number((await f.sql(id,'select public.save_product_v2($1,$2,$3,$4) as id',[name,'adet',category,subcategory])).rows[0].id);}
async function order(f,id,items){return Number((await f.sql(id,"select public.create_order_v2(1::smallint,'2099-12-12',$1::jsonb) as id",[JSON.stringify(items)])).rows[0].id);}

test('Kategori güncellemesi eski veriyi korur ve tekrar çalıştırılabilir',async t=>{
 const f=await fixture({catalogMigration:false});t.after(()=>f.close());const admin=account(f,'admin');
 const oldProduct=Number((await f.sql(admin,"select public.save_product('Eski ürün','adet') as id")).rows[0].id);
 const oldOrder=Number((await f.sql(admin,"select public.create_order(1::smallint,'2099-12-12',$1::jsonb) as id",[JSON.stringify([{product_id:oldProduct,quantity:2}])])).rows[0].id);
 await f.db.exec(migration);await f.db.exec(migration);
 const row=(await f.sql(admin,'select * from public.order_items where order_id=$1',[oldOrder])).rows[0];assert.equal(row.name,'Eski ürün');assert.equal(Number(row.quantity),2);assert.equal(row.servings,null);assert.equal(row.category,null);
 assert.equal((await f.sql(admin,'select * from public.products')).rows.length,1);assert.equal((await f.sql(admin,'select * from public.order_events')).rows.length,1);
 await assert.rejects(f.sql(admin,"select public.save_product('Atlama','adet')"),/permission denied/);
 await assert.rejects(f.sql(admin,"select public.create_order(1::smallint,'2099-12-12','[]'::jsonb)"),/permission denied/);
 // Existing unclassified products remain orderable until the manager classifies them.
 assert.ok(await order(f,admin,[{product_id:oldProduct,quantity:1}]));
});

test('Altı kategori, altı pasta alt kategorisi ve dört kategoriye özel kişilik doğrulaması',async t=>{
 const f=await fixture();t.after(()=>f.close());const admin=account(f,'admin'),branch=account(f,'bahce'),manager=account(f,'manager');
 assert.equal((await f.sql(admin,'select * from public.products')).rows.length,0);
 assert.equal(CATEGORIES.length,6);assert.equal(CAKE_SUBCATEGORIES.length,6);
 for(const c of CATEGORIES.filter(c=>c!=='Pastalar'))assert.ok(await product(f,manager,c));
 await assert.rejects(product(f,branch,'Çikolatalar'),/yetkiniz yok/);
 for(const [cat,sub] of [[null,null],['Olmayan',null],['Pastalar',null],['Çikolatalar','Cheesecake'],['Pastalar','Olmayan']])await assert.rejects(product(f,admin,cat,sub));
 for(const subcategory of SERVING_SUBCATEGORIES){
  const p=await product(f,manager,'Pastalar',subcategory,subcategory+' ürünü');
  assert.equal(needsServings('Pastalar',subcategory),true);
  const id=await order(f,branch,[4,6,8,13].map(servings=>({product_id:p,quantity:2,servings})));
  const items=(await f.sql(branch,'select * from public.order_items where order_id=$1 order by id',[id])).rows;
  assert.deepEqual(items.map(i=>i.servings),[4,6,8,13]);assert.ok(items.every(i=>i.category==='Pastalar'&&i.subcategory===subcategory&&Number(i.quantity)===2));
  const before=(await f.sql(admin,'select count(*) as n from public.orders')).rows[0].n;
  for(const servings of [null,0,-1,1.5,10001,'NaN','Infinity','abc'])await assert.rejects(order(f,branch,[{product_id:p,quantity:1,servings}]));
  await assert.rejects(order(f,branch,[{product_id:p,quantity:1,category:'Çikolatalar',subcategory:null}]));
  assert.equal((await f.sql(admin,'select count(*) as n from public.orders')).rows[0].n,before);
  // Product edits do not rewrite historical category or serving snapshots.
  await f.sql(manager,"select public.save_product_v2('Yeni ad','adet','Çikolatalar',null,$1,true)",[p]);
  const saved=(await f.sql(branch,'select * from public.order_items where order_id=$1',[id])).rows;assert.ok(saved.every(i=>i.subcategory===subcategory&&i.name!== 'Yeni ad'));
 }
 for(const subcategory of ['Figürlü adet pastalar','Adet pastalar']){
  const p=await product(f,admin,'Pastalar',subcategory);assert.ok(await order(f,branch,[{product_id:p,quantity:1}]));
  await assert.rejects(order(f,branch,[{product_id:p,quantity:1,servings:4}]),/kişi sayısı seçilemez/);
 }
 // Special orders have the same category and serving rules as catalog items.
 assert.ok(await order(f,branch,[{name:'Özel doğum günü',measure:'adet',quantity:1,category:'Pastalar',subcategory:'Kutlama pastaları',servings:17}]));
 await assert.rejects(order(f,branch,[{name:'Eksik boyut',measure:'adet',quantity:1,category:'Pastalar',subcategory:'Vitrin pastaları'}]));
 await assert.rejects(order(f,branch,[{name:'Hatalı',measure:'adet',quantity:1,category:'Çikolatalar',servings:8}]));
 await assert.rejects(order(f,branch,[{name:'Kategorisiz özel',measure:'adet',quantity:1}]));
 assert.equal((await f.sql(account(f,'park'),'select * from public.order_items')).rows.length,0);
 // Constraints also protect privileged direct writes from inconsistent snapshots.
 await assert.rejects(f.sql(null,"insert into public.products(name,measure,category,subcategory) values('Geçersiz','adet',null,'Cheesecake')"),/check constraint/);
});

test('Raporlar aynı pastanın farklı kişiliklerini ve kategorilerini birleştirmez',()=>{
 const base={product_id:1,name:'Çikolatalı pasta',measure:'adet',category:'Pastalar',subcategory:'Vitrin pastaları'};
 const rows=summarizeProducts([{items:[{...base,servings:4,quantity:2},{...base,servings:8,quantity:1}]},{items:[{...base,servings:4,quantity:3},{...base,servings:13,quantity:2}]}]);
 assert.equal(rows.length,3);assert.deepEqual(rows.map(i=>[i.servings,i.quantity]),[[4,5],[8,1],[13,2]]);
});
