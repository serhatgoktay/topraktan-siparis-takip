import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from '../test-support/supabase-fixture.js';
import {createApp} from '../supabase-server.js';
import {pendingSnapshot} from '../public/pending-edit.js';
async function app(t,items=true){
 const f=await fixture({pendingEditingMigration:true,pendingItemsMigration:items});t.after(()=>f.close());const {handler}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'}),cookies={};
 async function req(who,path,body){let status,output;const headers={};await handler({url:'/api/'+path,method:body?'POST':'GET',headers:{host:'localhost',cookie:cookies[who]||''},...(body?{body}:{})},{setHeader(k,v){headers[k]=v;},writeHead(code,h){status=code;Object.assign(headers,h);},end(value){output=value;}});return {status,data:JSON.parse(String(output)),cookie:(headers['Set-Cookie']||[]).map(s=>s.split(';')[0]).join('; ')};}
 for(const username of ['admin','manager','bahce','park']){const r=await req('', 'login',{username,password:'fixture-password-123'});assert.equal(r.status,200);cookies[username]=r.cookie;}
 const get=async()=>{const r=await req('bahce','orders');assert.equal(r.status,200);return r.data[0];};
 return {f,req,get};
}
const cake={name:'Eski pasta',quantity:2,measure:'adet',category:'Pastalar',subcategory:'Cheesecake',servings:8};
const custom={name:'Çikolata',quantity:1.125,measure:'kg',category:'Çikolatalar'};
const patch=(o,items)=>({expected:pendingSnapshot(o),delivery:'2099-12-12',note:o.note||'',reason:'Ürün değişikliği',items});

test('Yeni ürün SQLi yokken mevcut miktar düzenlemesi çalışır; ekleme zorlanmaz',async t=>{
 const {req,get}=await app(t,false);assert.deepEqual((await req('bahce','capabilities')).data,{pendingOrderEditing:true,pendingOrderItemsEditing:false,customOrderDetails:false});
 assert.equal((await req('bahce','orders',{delivery:'2099-12-12',items:[cake]})).status,201);const o=await get();
 assert.equal((await req('bahce',`orders/${o.id}/edit-pending`,patch(o,[custom]))).status,503);
 assert.equal((await get()).items[0].id,o.items[0].id);
 assert.equal((await req('bahce',`orders/${o.id}/edit-pending`,{...patch(o,undefined),quantities:[{id:o.items[0].id,quantity:3}]})).status,200);
});

test('Ürün ekle/çıkar: katalog snapshotı, özel kg ürün, kalan kimlikler, geçmiş ve yetkiler',async t=>{
 const {req,get,f}=await app(t);assert.deepEqual((await req('bahce','capabilities')).data,{pendingOrderEditing:true,pendingOrderItemsEditing:true,customOrderDetails:false});
 await req('admin','products',{name:'Yeni pasta',measure:'adet',category:'Pastalar',subcategory:'Cheesecake'});const product=(await req('bahce','products')).data[0];
 await req('bahce','orders',{delivery:'2099-12-12',items:[cake,{name:'Çıkarılacak ürün',quantity:1,measure:'tepsi',category:'Tuzlu kurabiyeler'}]});
 const o=await get(),items=[{id:o.items[0].id,quantity:3},{product_id:product.id,name:'Sahte ad',measure:'kg',quantity:1,servings:6},custom];
 assert.equal((await req('park',`orders/${o.id}/edit-pending`,patch(o,items))).status,404);assert.equal((await req('manager',`orders/${o.id}/edit-pending`,patch(o,items))).status,403);
 const saved=await req('bahce',`orders/${o.id}/edit-pending`,patch(o,items));assert.equal(saved.status,200,JSON.stringify(saved.data));
 const after=await get();assert.equal(after.items.length,3);assert.equal(after.items[0].id,o.items[0].id);assert.equal(after.items[0].quantity,3);assert.equal(after.items[0].servings,8);
 assert.ok(!after.items.some(i=>i.id===o.items[1].id));const added=after.items.find(i=>i.product_id===product.id);assert.equal(added.name,'Yeni pasta');assert.equal(added.measure,'adet');assert.equal(added.servings,6);assert.equal(after.items.find(i=>i.name==='Çikolata').quantity,1.125);
 const history=after.events.map(e=>e.note).join('\n');assert.match(history,/ÖNCEKİ ÜRÜNLER/);assert.match(history,/Çıkarılacak ürün/);assert.match(history,/YENİ ÜRÜNLER/);assert.match(history,/Yeni pasta/);assert.match(history,/6 kişilik/);
 assert.equal((await req('bahce',`orders/${o.id}/edit-pending`,patch(o,items))).status,409);
 assert.equal((await req('manager',`orders/${o.id}/status`,{status:'approved'})).status,200);
 assert.equal((await req('admin',`orders/${o.id}/edit-pending`,patch(after,items))).status,409);
 const actor=[...f.accounts.values()].find(a=>a.email==='park@example.test').id;
 await assert.rejects(f.sql(actor,'select public.edit_pending_order_v2($1,$2::jsonb,$3::date,$4,$5::jsonb,$6)',[o.id,JSON.stringify(pendingSnapshot(after)),'2099-12-12','',JSON.stringify(items),'Yetkisiz']),e=>e.code==='42501');
});

test('Boş sipariş, geçersiz/yabancı kalem ve kişi sayısı reddedilir; hata tüm değişiklikleri geri alır',async t=>{
 const {req,get}=await app(t);await req('admin','products',{name:'Katalog pasta',measure:'adet',category:'Pastalar',subcategory:'Cheesecake'});const product=(await req('bahce','products')).data[0];
 await req('bahce','orders',{delivery:'2099-12-12',items:[cake]});const o=await get(),id=o.items[0].id;
 for(const items of [[],[{id,quantity:3},{id,quantity:4}],[{id,quantity:2.5}],[{id:987654,quantity:1}],[{id,quantity:99},{product_id:product.id,quantity:1}],[{product_id:987654,quantity:1}],[{...custom,servings:4}]]){
  const result=await req('bahce',`orders/${o.id}/edit-pending`,patch(o,items));assert.equal(result.status,400,JSON.stringify(result.data));
  const after=await get();assert.deepEqual(after.items,o.items);assert.deepEqual(after.events,o.events);
 }
 const result=await req('bahce',`orders/${o.id}/edit-pending`,patch(o,[custom]));assert.equal(result.status,200);assert.equal((await get()).items[0].name,'Çikolata');
});

test('Ürün uzantısı mevcut şema, RLS ve önceki düzenleme işlevini değiştirmez; tekrar uygulanır',async t=>{
 const f=await fixture({pendingEditingMigration:true});t.after(()=>f.close());
 const snapshot=async()=>({policies:(await f.sql(null,'select * from pg_policies order by schemaname,tablename,policyname')).rows,columns:(await f.sql(null,"select table_name,column_name,data_type from information_schema.columns where table_schema='public' order by table_name,ordinal_position")).rows,previous:(await f.sql(null,"select prosrc from pg_proc where oid='public.edit_pending_order(bigint,jsonb,date,text,jsonb,text)'::regprocedure")).rows});
 const before=await snapshot(),sql=readFileSync(new URL('../supabase/migrations/202610230006_pending_order_items.sql',import.meta.url),'utf8');await f.db.exec(sql);await f.db.exec(sql);assert.deepEqual(await snapshot(),before);
});
