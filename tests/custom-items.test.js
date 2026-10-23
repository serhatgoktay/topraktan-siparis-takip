import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from '../test-support/supabase-fixture.js';
import {createApp} from '../supabase-server.js';
import {pendingSnapshot} from '../public/pending-edit.js';
const jpeg=n=>'data:image/jpeg;base64,'+Buffer.from([255,216,255,224,n,255,217]).toString('base64');
const custom=(description,photo)=>({name:'Aynı adlı özel pasta',quantity:1,measure:'adet',category:'Pastalar',subcategory:'Adet pastalar',custom_details:{description,photo}});
async function setup(t,installed=true){
 const f=await fixture({pendingItemsMigration:true,customDetailsMigration:true,customItemDetailsMigration:installed});t.after(()=>f.close());const {handler}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'}),cookies={};
 async function req(who,path,body){let status,output;const headers={};await handler({url:'/api/'+path,method:body?'POST':'GET',headers:{host:'localhost',cookie:cookies[who]||''},...(body?{body}:{})},{setHeader(k,v){headers[k]=v;},writeHead(code,h){status=code;Object.assign(headers,h);},end(value){output=value;}});return {status,data:Buffer.isBuffer(output)?output:JSON.parse(String(output)),headers,cookie:(headers['Set-Cookie']||[]).map(s=>s.split(';')[0]).join('; ')};}
 for(const who of ['admin','manager','bahce','park','imalat']){const r=await req('','login',{username:who,password:'fixture-password-123'});assert.equal(r.status,200);cookies[who]=r.cookie;}
 const orders=async()=> (await req('bahce','orders')).data;
 return {f,req,orders};
}
test('İki aynı adlı özel kalem kendi açıklaması ve fotoğrafına bağlanır; katalog kalemi ve şube sınırı',async t=>{
 const {f,req,orders}=await setup(t);assert.equal((await req('bahce','capabilities')).data.customOrderItemDetails,true);
 await req('admin','products',{name:'Katalog',measure:'adet',category:'Çikolatalar'});const catalog=(await req('bahce','products')).data[0];
 const result=await req('bahce','orders',{delivery:'2099-12-12',items:[custom('Ali, mavi',jpeg(1)),{product_id:catalog.id,quantity:2},custom('Ayşe, pembe',jpeg(2))]});assert.equal(result.status,201,JSON.stringify(result.data));
 const id=result.data.id,o=(await orders())[0],details=(await req('bahce',`orders/${id}/item-details`)).data;
 assert.deepEqual(details.items.map(i=>[i.item_id,i.description]),[[o.items[0].id,'Ali, mavi'],[o.items[2].id,'Ayşe, pembe']]);assert.equal(details.legacy,null);
 for(const [index,entry] of details.items.entries()){
  const image=await req('bahce',`orders/${id}/custom-item-photo/${entry.id}`);assert.equal(image.status,200);assert.deepEqual(image.data,Buffer.from(jpeg(index+1).split(',')[1],'base64'));assert.equal(image.headers['Cache-Control'],'no-store');
  assert.equal((await req('park',`orders/${id}/custom-item-photo/${entry.id}`)).status,404);assert.equal((await req('',`orders/${id}/custom-item-photo/${entry.id}`)).status,401);
 }
 assert.deepEqual((await req('park',`orders/${id}/item-details`)).data,{items:[],legacy:null});assert.equal((await req('manager',`orders/${id}/item-details`)).data.items.length,2);
 assert.equal((await req('imalat',`orders/${id}/item-details`)).data.items.length,0);await req('manager',`orders/${id}/status`,{status:'approved'});assert.equal((await req('imalat',`orders/${id}/item-details`)).data.items.length,2);
 assert.equal((await req('bahce',`orders/999999/custom-item-photo/${details.items[0].id}`)).status,404);
 assert.ok(!JSON.stringify(await orders()).includes('base64'));assert.ok(!JSON.stringify(details).includes('base64'));
 const actor=[...f.accounts.values()].find(a=>a.email==='bahce@example.test').id;
 await assert.rejects(f.sql(actor,'delete from public.order_item_custom_details where order_id=$1',[id]),e=>e.code==='42501');
 await assert.rejects(f.sql(actor,'select app_private.save_new_item_details($1,$2,$3::jsonb)',[id,o.items[0].id,JSON.stringify({description:'Sahte'})]),e=>e.code==='42501');
});
test('Düzenlemede fotoğraflar kalem kimliğine bağlı kalır; yeni kalem eklenir ve çıkarılanın görseli arşivlenir',async t=>{
 const {req,orders}=await setup(t);await req('bahce','orders',{delivery:'2099-12-12',items:[custom('Birinci',jpeg(1)),custom('İkinci',jpeg(2))]});const o=(await orders())[0];
 const patch={expected:pendingSnapshot(o),delivery:o.delivery,note:'',reason:'Birinci değişti',items:[{id:o.items[1].id,quantity:3},custom('Üçüncü',jpeg(3))]};
 assert.equal((await req('park',`orders/${o.id}/edit-pending`,patch)).status,404);assert.equal((await req('manager',`orders/${o.id}/edit-pending`,patch)).status,403);
 const saved=await req('bahce',`orders/${o.id}/edit-pending`,patch);assert.equal(saved.status,200,JSON.stringify(saved.data));
 const after=(await orders())[0],details=(await req('bahce',`orders/${o.id}/item-details`)).data.items;
 assert.equal(after.items[0].id,o.items[1].id);assert.equal(details.find(i=>i.description==='İkinci').item_id,o.items[1].id);assert.equal(details.find(i=>i.description==='Üçüncü').item_id,after.items[1].id);assert.equal(details.find(i=>i.description==='Birinci').item_id,null);
 const archive=details.find(i=>i.item_id===null);assert.equal((await req('bahce',`orders/${o.id}/custom-item-photo/${archive.id}`)).status,200);
 assert.equal((await req('bahce',`orders/${o.id}/edit-pending`,patch)).status,409);
 const bad={...patch,expected:pendingSnapshot(after),items:[custom('Bozuk fotoğraf','data:image/jpeg;base64,YWJjZA==')]};assert.equal((await req('bahce',`orders/${o.id}/edit-pending`,bad)).status,400);assert.deepEqual((await orders())[0],after);assert.deepEqual((await req('bahce',`orders/${o.id}/item-details`)).data.items,details);
 // An old client editing quantities preserves all item attachments.
 const legacy=await req('bahce',`orders/${o.id}/edit-pending`,{...patch,expected:pendingSnapshot(after),items:undefined,quantities:after.items.map(i=>({id:i.id,quantity:4}))});assert.equal(legacy.status,200);assert.deepEqual((await req('bahce',`orders/${o.id}/item-details`)).data.items,details);
});
test('Eski genel kayıtlar korunur: tek özel kaleme aktarılır, çoklu kalemde tahmin edilmez, SQL tekrar uygulanabilir',async t=>{
 const {f,req,orders}=await setup(t,false);
 for(const items of [[custom('',null)],[custom('',null),custom('',null)]])assert.equal((await req('bahce','orders',{delivery:'2099-12-12',items:items.map(({custom_details,...item})=>item),custom_details:{description:'Eski açıklama',photo:jpeg(1)}})).status,201);
 const before=(await f.sql(null,'select * from public.order_custom_details order by order_id')).rows;
 const sql=readFileSync(new URL('../supabase/migrations/202610230008_custom_details_per_item.sql',import.meta.url),'utf8');await f.db.exec(sql);await f.db.exec(sql);
 const actor=[...f.accounts.values()].find(a=>a.email==='bahce@example.test').id;const all=await orders();
 const single=all.find(o=>o.items.length===1),multi=all.find(o=>o.items.length===2);
 const get=async id=>(await f.sql(actor,'select public.get_order_item_details($1) as details',[id])).rows[0].details;
 const s=await get(single.id);assert.equal(s.items.length,1);assert.equal(s.items[0].item_id,single.items[0].id);assert.equal(s.items[0].description,'Eski açıklama');assert.equal(s.legacy,null);
 assert.deepEqual(await get(multi.id),{items:[],legacy:{description:'Eski açıklama',hasPhoto:true}});assert.deepEqual((await f.sql(null,'select * from public.order_custom_details order by order_id')).rows,before);
});
test('Yeni SQL eksikse fotoğraflar sessizce kaybolmaz; bozuk, katalog ve toplam boyutu büyük görseller atomik reddedilir',async t=>{
 const old=await setup(t,false);assert.equal((await old.req('bahce','capabilities')).data.customOrderItemDetails,false);
 assert.equal((await old.req('bahce','orders',{delivery:'2099-12-12',items:[custom('Yeni',jpeg(1))]})).status,503);assert.equal((await old.orders()).length,0);
 const {req,orders}=await setup(t);await req('admin','products',{name:'Katalog',measure:'adet',category:'Çikolatalar'});const p=(await req('bahce','products')).data[0];
 for(const entry of [custom('X','data:image/svg+xml;base64,PHN2Zz4='),custom('X','data:image/jpeg;base64,YWJjZA=='),custom('x'.repeat(2001),null),{product_id:p.id,quantity:1,custom_details:{description:'Olmaz',photo:jpeg(1)}}]){
  const r=await req('bahce','orders',{delivery:'2099-12-12',items:[custom('Geçerli ilk kalem',jpeg(1)),entry]});assert.equal(r.status,400,JSON.stringify(r.data));assert.equal((await orders()).length,0);
 }
 const bytes=Buffer.alloc(400000);bytes.set([255,216,255],0);bytes.set([255,217],bytes.length-2);const large='data:image/jpeg;base64,'+bytes.toString('base64');
 const r=await req('bahce','orders',{delivery:'2099-12-12',items:Array.from({length:5},()=>custom('Büyük',large))});assert.equal(r.status,400,JSON.stringify(r.data));assert.match(r.data.error,/toplam boyutu/);assert.equal((await orders()).length,0);
 assert.equal((await req('bahce','orders',{delivery:'2099-12-12',items:[custom('Yalnız açıklama',null),custom('',jpeg(2)),{...custom('',null),custom_details:null}]})).status,201);
 assert.equal((await req('bahce',`orders/${(await orders())[0].id}/item-details`)).data.items.length,2);
});
