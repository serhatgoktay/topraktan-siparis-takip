import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../test-support/supabase-fixture.js';
import {createApp} from '../supabase-server.js';
import {pendingSnapshot} from '../public/pending-edit.js';
const cake={name:'Cheesecake',quantity:2,measure:'adet',category:'Pastalar',subcategory:'Cheesecake',servings:8};
const photo='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,1,255,217]).toString('base64');
async function setup(t,installed=true){
 const f=await fixture({pendingItemsMigration:true,customItemDetailsMigration:true,servingsEditingMigration:installed});t.after(()=>f.close());const {handler}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'}),cookies={};
 async function req(who,path,body){let status,output;const headers={};await handler({url:'/api/'+path,method:body?'POST':'GET',headers:{host:'localhost',cookie:cookies[who]||''},...(body?{body}:{})},{setHeader(k,v){headers[k]=v;},writeHead(code,h){status=code;Object.assign(headers,h);},end(value){output=value;}});return {status,data:Buffer.isBuffer(output)?output:JSON.parse(String(output)),cookie:(headers['Set-Cookie']||[]).map(s=>s.split(';')[0]).join('; ')};}
 for(const who of ['admin','manager','bahce','park']){const r=await req('','login',{username:who,password:'fixture-password-123'});assert.equal(r.status,200);cookies[who]=r.cookie;}
 const get=async()=> (await req('bahce','orders')).data[0];return {f,req,get};
}
const patch=(o,servings)=>({edit_servings:true,expected:pendingSnapshot(o,true),delivery:o.delivery,note:o.note,reason:'Pasta boyutu değişti',items:o.items.map(i=>({id:i.id,quantity:i.quantity,servings:servings===undefined?i.servings:servings}))});
test('Yalnız pasta boyutu değişir: kalem kimliği, miktar, fotoğraf, açıklama ve eski/yeni geçmiş korunur',async t=>{
 const {req,get}=await setup(t);await req('bahce','orders',{delivery:'2099-12-12',items:[{...cake,custom_details:{description:'Ali yazılsın',photo}}]});const o=await get();const details=(await req('bahce',`orders/${o.id}/item-details`)).data;
 for(const servings of [4,6,8,12]){
  const before=await get(),saved=await req('bahce',`orders/${o.id}/edit-pending`,patch(before,servings));assert.equal(saved.status,200,JSON.stringify(saved.data));const after=await get();assert.equal(after.items[0].servings,servings);assert.equal(after.items[0].quantity,2);assert.equal(after.items[0].id,o.items[0].id);assert.deepEqual((await req('bahce',`orders/${o.id}/item-details`)).data,details);
 }
 const after=await get();assert.match(after.events.map(e=>e.note).join('\n'),/12 kişilik/);
 assert.equal((await req('bahce',`orders/${o.id}/edit-pending`,patch(o,6))).status,409);
 const old={...patch(after,undefined),edit_servings:undefined,expected:pendingSnapshot(after),items:after.items.map(i=>({id:i.id,quantity:3}))};assert.equal((await req('bahce',`orders/${o.id}/edit-pending`,old)).status,200);assert.equal((await get()).items[0].servings,12);
});
test('Kişi sayısı, kategori, şube ve onay kontrolleri korunur; hatalar kısmi değişiklik oluşturmaz',async t=>{
 const {req,get}=await setup(t);await req('bahce','orders',{delivery:'2099-12-12',items:[cake,{name:'Kurabiye',quantity:1,measure:'kg',category:'Tatlı kurabiyeler'}]});const o=await get();
 for(const servings of [null,0,1.5,10001,'yanlış']){const p=patch(o,undefined);p.items[0].servings=servings;p.items[1].quantity=3;const r=await req('bahce',`orders/${o.id}/edit-pending`,p);assert.equal(r.status,400,JSON.stringify(r.data));assert.deepEqual(await get(),o);}
 const nonCake=patch(o,undefined);nonCake.items[1].servings=6;assert.equal((await req('bahce',`orders/${o.id}/edit-pending`,nonCake)).status,400);
 assert.equal((await req('park',`orders/${o.id}/edit-pending`,patch(o,6))).status,404);assert.equal((await req('manager',`orders/${o.id}/edit-pending`,patch(o,6))).status,403);
 await req('manager',`orders/${o.id}/status`,{status:'approved'});assert.equal((await req('admin',`orders/${o.id}/edit-pending`,patch(o,6))).status,409);
});
test('Pasta boyutu ile fotoğraflı yeni özel kalem birlikte kaydedilir; fotoğraf hatası tümünü geri alır',async t=>{
 const {req,get}=await setup(t);await req('bahce','orders',{delivery:'2099-12-12',items:[cake]});const o=await get();
 const p=patch(o,6);p.items.push({...cake,name:'Yeni pasta',servings:4,custom_details:{description:'Yeni kalemin açıklaması',photo}});const r=await req('bahce',`orders/${o.id}/edit-pending`,p);assert.equal(r.status,200,JSON.stringify(r.data));const after=await get();assert.deepEqual(after.items.map(i=>i.servings),[6,4]);assert.equal((await req('bahce',`orders/${o.id}/item-details`)).data.items[0].item_id,after.items[1].id);
 const invalid=patch(after,8);invalid.items.push({...cake,custom_details:{description:'Bozuk',photo:'bad'}});assert.equal((await req('bahce',`orders/${o.id}/edit-pending`,invalid)).status,400);assert.deepEqual(await get(),after);
});
test('Yeni SQL eksikken eski düzenleme sürer; pasta boyutu sessizce yok sayılmaz',async t=>{
 const {req,get}=await setup(t,false);assert.equal((await req('bahce','capabilities')).data.pendingOrderServings,false);await req('bahce','orders',{delivery:'2099-12-12',items:[cake]});const o=await get();assert.equal((await req('bahce',`orders/${o.id}/edit-pending`,patch(o,6))).status,503);assert.deepEqual(await get(),o);
});
