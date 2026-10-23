import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../test-support/supabase-fixture.js';
import {createApp} from '../supabase-server.js';
import {readFileSync} from 'node:fs';
const photo='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,1,2,3,255,217]).toString('base64');
const item={name:'Figürlü özel pasta',quantity:1,measure:'adet',category:'Pastalar',subcategory:'Figürlü adet pastalar'};
async function setup(t,installed=true){
 const f=await fixture({pendingItemsMigration:true,customDetailsMigration:installed});t.after(()=>f.close());const {handler}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'});const cookies={};
 async function req(who,path,body){let status,output;const headers={};await handler({url:'/api/'+path,method:body?'POST':'GET',headers:{host:'localhost',cookie:cookies[who]||''},...(body?{body}:{})},{setHeader(k,v){headers[k]=v;},writeHead(code,h){status=code;Object.assign(headers,h);},end(value){output=value;}});return {status,data:Buffer.isBuffer(output)?output:JSON.parse(String(output)),headers,cookie:(headers['Set-Cookie']||[]).map(s=>s.split(';')[0]).join('; ')};}
 for(const who of ['admin','manager','bahce','park','imalat']){const r=await req('','login',{username:who,password:'fixture-password-123'});assert.equal(r.status,200);cookies[who]=r.cookie;}
 return {f,req};
}
const order=(details)=>({delivery:'2099-12-12',items:[item],...(details?{custom_details:details}:{})});
test('Özel sipariş fotoğrafı ve açıklaması birlikte kaydedilir; şube RLS, imalat ve anonim erişim',async t=>{
 const {f,req}=await setup(t);assert.equal((await req('bahce','capabilities')).data.customOrderDetails,true);
 const saved=await req('bahce','orders',order({description:'Üzerine Ali yazılsın.\nRenk: mavi <script>',photo}));assert.equal(saved.status,201,JSON.stringify(saved.data));const id=saved.data.id;
 const details=await req('bahce',`orders/${id}/custom-details`);assert.deepEqual(details.data,{description:'Üzerine Ali yazılsın.\nRenk: mavi <script>',hasPhoto:true});assert.ok(!JSON.stringify(details.data).includes('base64'));
 const image=await req('bahce',`orders/${id}/custom-photo`);assert.equal(image.status,200);assert.equal(image.headers['Content-Type'],'image/jpeg');assert.equal(image.headers['Cache-Control'],'no-store');assert.deepEqual(image.data,Buffer.from(photo.split(',')[1],'base64'));
 assert.equal((await req('park',`orders/${id}/custom-details`)).data,null);assert.equal((await req('park',`orders/${id}/custom-photo`)).status,404);assert.equal((await req('',`orders/${id}/custom-photo`)).status,401);
 assert.equal((await req('admin',`orders/${id}/custom-details`)).data.hasPhoto,true);assert.equal((await req('manager',`orders/${id}/custom-photo`)).status,200);
 assert.equal((await req('imalat',`orders/${id}/custom-photo`)).status,404);
 assert.equal((await req('manager',`orders/${id}/status`,{status:'approved'})).status,200);assert.equal((await req('imalat',`orders/${id}/custom-photo`)).status,200);
 const lists=await req('bahce','orders');assert.ok(!JSON.stringify(lists.data).includes('base64'));assert.ok(!JSON.stringify(lists.data).includes('Renk: mavi'));
 const actor=[...f.accounts.values()].find(a=>a.email==='bahce@example.test').id;
 await assert.rejects(f.sql(actor,'update public.order_custom_details set description=$1 where order_id=$2',['Sahte',id]),e=>e.code==='42501');
 await assert.rejects(f.sql(actor,'delete from public.order_custom_details where order_id=$1',[id]),e=>e.code==='42501');
});
test('Fotoğraf/açıklama opsiyoneldir; eski SQL yokken mevcut sipariş ve düzenleme çalışır',async t=>{
 const {req}=await setup(t,false);assert.equal((await req('bahce','capabilities')).data.customOrderDetails,false);
 assert.equal((await req('bahce','orders',order())).status,201);
 assert.equal((await req('bahce','orders',order({description:'Özel açıklama',photo:null}))).status,503);
 assert.equal((await req('bahce','orders')).data.length,1);
});
test('Geçersiz fotoğraf, yetkisiz sipariş ve uzun açıklamada kısmi sipariş oluşturulmaz',async t=>{
 const {f,req}=await setup(t);
 for(const details of [{description:'x'.repeat(2001),photo:null},{description:'x',photo:'data:image/svg+xml;base64,PHN2Zz4='},{description:'x',photo:'data:image/jpeg;base64,YWJjZA=='},{description:'x',photo:'data:image/jpeg;base64,'+'a'.repeat(600000)},{description:17,photo:null}]){
  const r=await req('bahce','orders',order(details));assert.equal(r.status,400,JSON.stringify(r.data));assert.equal((await req('bahce','orders')).data.length,0);
 }
 assert.equal((await req('imalat','orders',order({description:'x',photo}))).status,400);
 await req('admin','products',{name:'Katalog',measure:'adet',category:'Çikolatalar'});const p=(await req('bahce','products')).data[0];
 assert.equal((await req('bahce','orders',{...order({description:'x',photo}),items:[{product_id:p.id,quantity:1}]})).status,400);
 assert.equal((await req('bahce','orders',order({description:'Yalnız açıklama',photo:null}))).status,201);
 const id=(await req('bahce','orders')).data[0].id;assert.deepEqual((await req('bahce',`orders/${id}/custom-details`)).data,{description:'Yalnız açıklama',hasPhoto:false});assert.equal((await req('bahce',`orders/${id}/custom-photo`)).status,404);
 // Repeated application preserves existing details and does not alter old tables.
 const before=(await f.sql(null,"select column_name,data_type from information_schema.columns where table_schema='public' and table_name='orders' order by ordinal_position")).rows;
 await f.db.exec(readFileSync(new URL('../supabase/migrations/202610230007_custom_order_details.sql',import.meta.url),'utf8'));
 assert.deepEqual((await req('bahce',`orders/${id}/custom-details`)).data,{description:'Yalnız açıklama',hasPhoto:false});
 assert.deepEqual((await f.sql(null,"select column_name,data_type from information_schema.columns where table_schema='public' and table_name='orders' order by ordinal_position")).rows,before);
});
