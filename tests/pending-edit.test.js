import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from '../test-support/supabase-fixture.js';
import {createApp} from '../supabase-server.js';
import {pendingSnapshot} from '../public/pending-edit.js';
async function app(t,migration){
 const f=await fixture({pendingEditingMigration:migration});
 const {handler}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'});
 t.after(()=>f.close());const cookies={};
 async function req(who,path,body){
  let status,output;const headers={};
  const response={setHeader(k,v){headers[k]=v;},writeHead(code,values){status=code;Object.assign(headers,values);},end(value){output=value;}};
  await handler({url:'/api/'+path,method:body?'POST':'GET',headers:{host:'localhost',...(cookies[who]?{cookie:cookies[who]}:{})},...(body?{body}:{})},response);
  return {status,data:JSON.parse(String(output)),cookie:(headers['Set-Cookie']||[]).map(s=>s.split(';')[0]).join('; ')};
 }
 for(const username of ['admin','manager','bahce','park','imalat']){const r=await req('', 'login',{username,password:'fixture-password-123'});assert.equal(r.status,200);cookies[username]=r.cookie;}
 return {f,req};
}
const body={delivery:'2099-12-12',items:[{name:'Test pasta',quantity:10,measure:'adet',category:'Pastalar',subcategory:'Cheesecake',servings:8}]};
const update=o=>({expected:pendingSnapshot(o),delivery:'2099-12-13',note:'Yeni not',quantities:o.items.map(i=>({id:i.id,quantity:7})),reason:'Şube talebi'});

test('Yeni SQL yokken giris/siparis/urunler/raporlar calisir; istege bagli duzenleme kapalidir',async t=>{
 const {req}=await app(t,false);
 assert.deepEqual((await req('bahce','capabilities')).data,{pendingOrderEditing:false,pendingOrderItemsEditing:false,customOrderDetails:false,customOrderItemDetails:false});
 assert.equal((await req('bahce','orders',body)).status,201);
 const order=(await req('bahce','orders')).data[0];assert.equal(order.items[0].quantity,10);
 const result=await req('bahce',`orders/${order.id}/edit-pending`,update(order));assert.equal(result.status,503);assert.match(result.data.error,/henüz etkinleştirilmemiş/);
 assert.equal((await req('bahce','orders')).data[0].items[0].quantity,10);
 assert.equal((await req('bahce','products')).status,200);
 assert.equal((await req('manager',`orders/${order.id}/status`,{status:'approved'})).status,200);
});

test('Onay oncesi duzenleme: ayni kalem/kimlik, eski-yeni gecmisi, sube siniri ve cakis engeleme',async t=>{
 const {f,req}=await app(t,true);
 assert.deepEqual((await req('bahce','capabilities')).data,{pendingOrderEditing:true,pendingOrderItemsEditing:false,customOrderDetails:false,customOrderItemDetails:false});
 assert.equal((await req('bahce','orders',body)).status,201);
 const o=(await req('bahce','orders')).data[0],patch=update(o);
 assert.equal((await req('park',`orders/${o.id}/edit-pending`,patch)).status,404);
 for(const role of ['manager','imalat'])assert.equal((await req(role,`orders/${o.id}/edit-pending`,patch)).status,403);
 const result=await req('bahce',`orders/${o.id}/edit-pending`,patch);assert.equal(result.status,200,JSON.stringify(result.data));
 const edited=(await req('bahce','orders')).data[0];assert.equal(edited.items[0].id,o.items[0].id);assert.equal(edited.items[0].quantity,7);assert.equal(edited.items[0].servings,8);assert.equal(edited.created_at,o.created_at);assert.equal(edited.status,'pending');assert.equal(edited.note,'Yeni not');
 const notes=edited.events.map(e=>e.note).join('\n');assert.match(notes,/10\.000 → 7 adet/);assert.match(notes,/Şube talebi/);
 assert.equal((await req('bahce',`orders/${o.id}/edit-pending`,patch)).status,409);
 const invalid=update(edited);invalid.quantities[0].quantity=1.5;assert.equal((await req('admin',`orders/${o.id}/edit-pending`,invalid)).status,400);assert.equal((await req('bahce','orders')).data[0].items[0].quantity,7);
 assert.equal((await req('manager',`orders/${o.id}/status`,{status:'approved'})).status,200);
 assert.equal((await req('admin',`orders/${o.id}/edit-pending`,update(edited))).status,409);
 const actor=[...f.accounts.values()].find(a=>a.email==='park@example.test').id;
 await assert.rejects(f.sql(actor,'select public.edit_pending_order($1,$2::jsonb,$3::date,$4,$5::jsonb,$6)',[o.id,JSON.stringify(patch.expected),patch.delivery,patch.note,JSON.stringify(patch.quantities),patch.reason]),e=>e.code==='42501');
 const direct=f.calls.filter(c=>c.path.endsWith('/edit_pending_order'));assert.ok(direct.every(c=>c.apikey!=='fixture-service-key'&&c.token.startsWith('Bearer access-')));
});

test('Ekleme mevcut tablo, islev ve RLS tanimlarini degistirmez; uzun not gecmisi kaybolmaz',async t=>{
 const f=await fixture();t.after(()=>f.close());
 const schema=async()=>({policies:(await f.sql(null,'select * from pg_policies order by schemaname,tablename,policyname')).rows,columns:(await f.sql(null,"select table_name,column_name,data_type from information_schema.columns where table_schema='public' order by table_name,ordinal_position")).rows,functions:(await f.sql(null,"select p.oid,p.proname,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') order by p.oid")).rows});
 const before=await schema();const sql=readFileSync(new URL('../supabase/migrations/202610230005_pending_order_edit.sql',import.meta.url),'utf8');await f.db.exec(sql);await f.db.exec(sql);
 const after=await schema();assert.deepEqual(after.policies,before.policies);assert.deepEqual(after.columns,before.columns);assert.deepEqual(after.functions.filter(p=>before.functions.some(b=>b.oid===p.oid)),before.functions);
 const actor=[...f.accounts.values()].find(a=>a.email==='bahce@example.test').id;
 await f.sql(actor,"select public.create_order_v2(1::smallint,'2099-12-12'::date,$1::jsonb,$2)",[JSON.stringify(body.items),'A'.repeat(2000)]);
 const {rows:[o]}=await f.sql(actor,'select * from public.orders');const {rows:items}=await f.sql(actor,'select * from public.order_items');
 const expected=pendingSnapshot({...o,items});await f.sql(actor,'select public.edit_pending_order($1,$2::jsonb,$3::date,$4,$5::jsonb,$6)',[o.id,JSON.stringify(expected),'2099-12-12','B'.repeat(2000),JSON.stringify(items.map(i=>({id:i.id,quantity:10}))),'Not değişti']);
 const events=(await f.sql(actor,'select note from public.order_events order by id')).rows.slice(1);assert.ok(events.length>1);assert.ok(events.every(e=>e.note.length<=2000));
 const text=events.map(e=>e.note.replace(/^Düzenleme kaydı \(\d+\/\d+\)\n/,'')).join('');assert.ok(text.includes('A'.repeat(2000)));assert.ok(text.includes('B'.repeat(2000)));
});
