import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createApp} from '../supabase-server.js';
import {fixture} from '../test-support/supabase-fixture.js';
const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('HTTP: görsel gizliliği, revizyon çakışması, bildirimler ve üretim raporu',async t=>{
 const f=await fixture({workflowMigration:true});const {server}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key',workflowEnabled:true});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await f.close();});
 const base=`http://127.0.0.1:${server.address().port}/api/`;
 async function request(path,body,cookie){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};}
 const cookies={};for(const username of ['admin','manager','bahce','park','imalat']){const r=await request('login',{username,password:'fixture-password-123'});assert.equal(r.status,200);cookies[username]=r.cookie;}
 const req=(who,path,body)=>request(path,body,cookies[who]);
 const body={unit:'Bahçe',delivery:'2099-12-12',items:[{name:'Özel pasta',quantity:10,measure:'adet',category:'Pastalar',subcategory:'Adet pastalar',description:'İlk açıklama'}]};
 assert.equal((await req('manager','orders',body)).status,403);
 const created=await req('bahce','orders',body);assert.equal(created.status,201);const id=created.data.id;
 let o=(await req('bahce','orders')).data[0],item=o.items[0];
 const imageBody={revision:o.revision,item_id:item.id,mime:'image/png',content:pixel,reason:'Örnek tasarım'};
 assert.equal((await req('park',`orders/${id}/image`,imageBody)).status,404);
 assert.equal((await req('bahce',`orders/${id}/image`,{...imageBody,mime:'image/svg+xml'})).status,400);
 assert.equal((await req('bahce',`orders/${id}/image`,{...imageBody,content:Buffer.from('not a real image').toString('base64')})).status,400);
 assert.equal((await req('bahce',`orders/${id}/image`,imageBody)).status,200);
 o=(await req('bahce','orders')).data[0];assert.equal(o.images.length,1);assert.equal(o.revision,2);const imageId=o.images[0].id;
 assert.equal((await fetch(base+'images/'+imageId)).status,401);
 assert.equal((await fetch(base+'images/'+imageId,{headers:{Cookie:cookies.park}})).status,403);
 const img=await fetch(base+'images/'+imageId,{headers:{Cookie:cookies.bahce}});assert.equal(img.status,200);assert.equal(img.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await img.arrayBuffer()),Buffer.from(pixel,'base64'));
 await assert.rejects(f.sql([...f.accounts.values()].find(a=>a.email==='bahce@example.test').id,'select content from public.order_images'),/permission denied/);
 assert.equal((await req('bahce',`orders/${id}/edit`,{revision:1,delivery:body.delivery,note:'',items:o.items,reason:'Eski ekran'})).status,409);
 assert.equal((await req('manager',`orders/${id}/status`,{status:'approved'})).status,403);
 assert.equal((await req('admin',`orders/${id}/status`,{status:'approved'})).status,200);
 assert.equal((await req('manager',`orders/${id}/image`,{...imageBody,revision:3})).status,403);
 assert.equal((await req('bahce',`orders/${id}/cancel`,{revision:3,reason:'Onay sonrası'})).status,403);
 assert.equal((await req('manager',`orders/${id}/status`,{status:'preparing'})).status,200);
 assert.equal((await req('admin',`orders/${id}/cancel`,{revision:4,items:[{id:item.id,quantity:3}],reason:'3 adet iptal'})).status,200);
 let notices=(await req('manager','notifications')).data;assert.equal(notices.length,1);assert.equal(notices[0].read,false);assert.equal(Number(notices[0].event.after_data.items[0].cancelled_quantity),3);
 assert.equal((await req('bahce','notifications')).status,403);assert.equal((await req('admin','notifications')).status,403);
 assert.equal((await req('imalat',`orders/${id}/status`,{status:'ready'})).status,400);
 assert.equal((await req('manager',`notifications/${notices[0].id}`,{review:false})).status,200);
 assert.equal((await req('manager',`orders/${id}/status`,{status:'ready'})).status,400);
 assert.equal((await req('manager',`notifications/${notices[0].id}`,{review:true})).status,200);
 assert.equal((await req('manager',`orders/${id}/status`,{status:'ready'})).status,200);
 assert.equal((await req('manager','notifications')).data.find(n=>n.id===notices[0].id).reviewer,'manager');
 o=(await req('manager','orders')).data[0];assert.ok(o.completed_at);assert.equal(o.production_hold,false);
 assert.equal((await req('manager',`orders/${id}/production-message`,{note:'Malzeme gecikmesi',issue:true})).status,200);
 assert.ok((await req('admin','orders')).data[0].events.some(e=>e.kind==='production_issue'));
 const report=await fetch(base+'reports/export?reportType=completed',{headers:{Cookie:cookies.manager}});assert.equal(report.status,200);
 const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await report.arrayBuffer()));
 const ws=book.getWorksheet('Siparişler'),headers=ws.getRow(1).values;
 assert.equal(ws.getRow(2).getCell(headers.indexOf('İptal miktarı')).value,3);
 assert.equal(ws.getRow(2).getCell(headers.indexOf('Kalan / Üretilecek')).value,7);
 assert.ok(book.getWorksheet('İşlem geçmişi'));assert.equal(book.getWorksheet('Ürün toplamları').getCell('E2').value,7);
 const empty=await fetch(base+'reports/export?reportType=completed',{headers:{Cookie:cookies.park}});const emptyBook=new ExcelJS.Workbook();await emptyBook.xlsx.load(Buffer.from(await empty.arrayBuffer()));assert.equal(emptyBook.getWorksheet('Siparişler').rowCount,1);
 // Onay sonrası görsel değiştirme ve kaldırma bildirim üretir, eski görsel geçmişte kalır.
 assert.equal((await req('admin',`orders/${id}/image`,{...imageBody,revision:6})).status,200);
 assert.equal((await req('admin',`orders/${id}/image`,{revision:7,item_id:item.id,content:null,reason:'Görsel kaldırıldı'})).status,200);
 notices=(await req('manager','notifications')).data;assert.equal(notices.length,3);assert.equal(notices.filter(n=>!n.reviewed_at).length,2);
 assert.equal((await fetch(base+'images/'+imageId,{headers:{Cookie:cookies.manager}})).status,200);
 // Aynı revizyonla iki istemci işlem yaparsa yalnız biri yazabilir.
 const mutations=await Promise.all([1,2].map(()=>req('admin',`orders/${id}/cancel`,{revision:8,items:[{id:item.id,quantity:1}],reason:'Yarış testi'})));
 assert.deepEqual(mutations.map(r=>r.status).sort(),[200,409]);
 const finalNotices=(await req('manager','notifications')).data;assert.equal(finalNotices.length,4);
 const secondManager=await req('admin','users',{name:'İkinci imalat sorumlusu',username:'manager2',email:'manager2@example.test',password:'fixture-password-123',role:'manager',active:true});assert.equal(secondManager.status,200);
 const secondLogin=await request('login',{username:'manager2',password:'fixture-password-123'});cookies.manager2=secondLogin.cookie;
 assert.equal((await req('manager2','notifications')).data.filter(n=>!n.read).length,4);
 const remainingNotices=finalNotices.filter(n=>!n.reviewed_at);
 for(let index=0;index<remainingNotices.length;index++){
  assert.equal((await req('manager2',`notifications/${remainingNotices[index].id}`,{review:true})).status,200);
  assert.equal((await req('manager','orders')).data[0].production_hold,index<remainingNotices.length-1);
 }
 assert.equal((await req('manager','notifications')).data.length,4);
 const reads=f.calls.filter(c=>c.path.includes('/rest/v1/')&&!c.path.endsWith('resolve_login_username'));
 assert.ok(reads.every(c=>c.apikey!=='fixture-service-key'));
});
