import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {createApp} from '../supabase-server.js';
import {pendingSnapshot} from '../public/pending-edit.js';
const c=JSON.parse(readFileSync(process.env.LOCAL_SUPABASE_STATUS_FILE,'utf8')),local=new URL(c.API_URL);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(local.hostname),'Hosted Supabase is forbidden');assert.equal(local.protocol,'http:');assert.ok(c.ANON_KEY&&c.SERVICE_ROLE_KEY);
const accounts=new Map(),password='Local-'+randomBytes(24).toString('base64url');
for(const [name,role,unit] of [['admin','admin',null],['manager','manager',null],['bahce','operator',1],['park','operator',2]]){
 const r=await fetch(new URL('/auth/v1/admin/users',local),{method:'POST',headers:{apikey:c.ANON_KEY,Authorization:`Bearer ${c.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({email:`${name}@pending-test.invalid`,password,email_confirm:true,user_metadata:{name}})});assert.equal(r.status,200);const raw=await r.json(),u=raw.user||raw;assert.match(u.id,/^[0-9a-f-]{36}$/i);accounts.set(name,{id:u.id,role,unit});
}
const sql=[...accounts].map(([name,u])=>`update public.profiles set username='${name}',role='${u.role}',unit_id=${u.unit??'null'},active=true where id='${u.id}'::uuid;`).join('\n');
function postgres(input){return execFileSync('docker',['exec','-i','supabase_db_topraktan-pending-ci','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']});}
postgres(sql);
const {server}=createApp({url:'https://pending-local.invalid',publishableKey:c.ANON_KEY,serviceKey:c.SERVICE_ROLE_KEY,secureCookies:false,fetchImpl:(input,opts)=>{const u=new URL(input);assert.equal(u.origin,'https://pending-local.invalid');return fetch(new URL(u.pathname+u.search,local),opts);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api/`,cookies={};
async function req(who,path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookies[who]?{Cookie:cookies[who]}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};}
try{
 for(const name of accounts.keys()){const r=await req('', 'login',{username:name,password});assert.equal(r.status,200,JSON.stringify(r.data));cookies[name]=r.cookie;}
 assert.deepEqual((await req('bahce','capabilities')).data,{pendingOrderEditing:false,pendingOrderItemsEditing:false,customOrderDetails:false,customOrderItemDetails:false});
 const created=await req('bahce','orders',{delivery:'2099-12-12',items:[{name:'Test pasta',quantity:10,measure:'adet',category:'Pastalar',subcategory:'Cheesecake',servings:8}]});assert.equal(created.status,201,JSON.stringify(created.data));
 const id=created.data.id;const before=(await req('bahce','orders')).data.find(o=>o.id===id);
 assert.equal((await req('bahce','products')).status,200);assert.equal((await req('park','orders')).data.length,0);
 console.log('PASS: real Supabase without new SQL: login, orders, products and branch scope');
 const output=postgres(readFileSync(process.env.PENDING_EDIT_SQL_FILE,'utf8'));assert.match(output,/DUZENLEME_HAZIR/);
 let ready=false;for(let attempt=0;attempt<30;attempt++){ready=(await req('bahce','capabilities')).data.pendingOrderEditing===true;if(ready)break;await new Promise(r=>setTimeout(r,200));}assert.equal(ready,true);
 const patch={expected:pendingSnapshot(before),delivery:'2099-12-13',note:'Yeni not',reason:'Miktar düzeltildi',quantities:before.items.map(i=>({id:i.id,quantity:7}))};
 assert.equal((await req('park',`orders/${id}/edit-pending`,patch)).status,404);assert.equal((await req('manager',`orders/${id}/edit-pending`,patch)).status,403);
 const saved=await req('bahce',`orders/${id}/edit-pending`,patch);assert.equal(saved.status,200,JSON.stringify(saved.data));
 assert.equal((await req('bahce',`orders/${id}/edit-pending`,patch)).status,409);
 const after=(await req('bahce','orders')).data.find(o=>o.id===id);assert.equal(after.items[0].quantity,7);assert.equal(after.items[0].id,before.items[0].id);assert.ok(after.events.some(e=>e.note.includes('Miktar düzeltildi')));
 assert.equal((await req('manager',`orders/${id}/status`,{status:'approved'})).status,200);
 assert.equal((await req('admin',`orders/${id}/edit-pending`,{...patch,expected:pendingSnapshot(after)})).status,409);
 console.log('PASS: real Supabase after SQL: pending edits, history, stale conflict and approval lock; existing manager approval preserved');
 const itemsOutput=postgres(readFileSync(process.env.PENDING_ITEMS_SQL_FILE,'utf8'));assert.match(itemsOutput,/URUN_DUZENLEME_HAZIR/);
 let itemsReady=false;for(let attempt=0;attempt<50;attempt++){itemsReady=(await req('bahce','capabilities')).data.pendingOrderItemsEditing===true;if(itemsReady)break;await new Promise(r=>setTimeout(r,200));}assert.equal(itemsReady,true);
 const created2=await req('bahce','orders',{delivery:'2099-12-12',items:[{name:'Değişecek pasta',quantity:2,measure:'adet',category:'Pastalar',subcategory:'Adet pastalar'}]});assert.equal(created2.status,201);
 const second=(await req('bahce','orders')).data.find(o=>o.id===created2.data.id);
 const replacement={expected:pendingSnapshot(second),delivery:second.delivery,note:'',reason:'Yeni ürün talebi',items:[{name:'Yeni çikolata',quantity:1.25,measure:'kg',category:'Çikolatalar'}]};
 const replaced=await req('bahce',`orders/${second.id}/edit-pending`,replacement);assert.equal(replaced.status,200,JSON.stringify(replaced.data));
 const edited=(await req('bahce','orders')).data.find(o=>o.id===second.id);assert.equal(edited.items.length,1);assert.equal(edited.items[0].name,'Yeni çikolata');assert.equal(edited.items[0].quantity,1.25);assert.ok(edited.events.some(e=>e.note.includes('Değişecek pasta')));
 assert.equal((await req('bahce',`orders/${second.id}/edit-pending`,replacement)).status,409);
 console.log('PASS: real Supabase product add/remove, kg quantity, complete replacement, history and stale protection');

 const photoOutput=postgres(readFileSync(process.env.CUSTOM_DETAILS_SQL_FILE,'utf8'));assert.match(photoOutput,/OZEL_SIPARIS_GORSEL_HAZIR/);
 let photoReady=false;for(let attempt=0;attempt<50;attempt++){photoReady=(await req('bahce','capabilities')).data.customOrderDetails===true;if(photoReady)break;await new Promise(r=>setTimeout(r,200));}assert.equal(photoReady,true);
 const photo='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,1,2,3,255,217]).toString('base64');
 const withPhoto=await req('bahce','orders',{delivery:'2099-12-12',items:[{name:'Fotoğraflı özel pasta',quantity:1,measure:'adet',category:'Pastalar',subcategory:'Adet pastalar'}],custom_details:{description:'Üzerine Ali yazılsın',photo}});assert.equal(withPhoto.status,201,JSON.stringify(withPhoto.data));
 assert.deepEqual((await req('bahce',`orders/${withPhoto.data.id}/custom-details`)).data,{description:'Üzerine Ali yazılsın',hasPhoto:true});assert.equal((await req('park',`orders/${withPhoto.data.id}/custom-details`)).data,null);
 const image=await fetch(base+`orders/${withPhoto.data.id}/custom-photo`,{headers:{Cookie:cookies.bahce}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.deepEqual(Buffer.from(await image.arrayBuffer()),Buffer.from(photo.split(',')[1],'base64'));
 console.log('PASS: real Supabase special-order description, photo, authenticated image endpoint and branch isolation');

 const itemDetailsOutput=postgres(readFileSync(process.env.ITEM_DETAILS_SQL_FILE,'utf8'));assert.match(itemDetailsOutput,/KALEM_GORSELLERI_HAZIR/);
 let itemDetailsReady=false;for(let attempt=0;attempt<50;attempt++){itemDetailsReady=(await req('bahce','capabilities')).data.customOrderItemDetails===true;if(itemDetailsReady)break;await new Promise(r=>setTimeout(r,200));}assert.equal(itemDetailsReady,true);
 const item=(description)=>({name:'Aynı adlı özel pasta',quantity:1,measure:'adet',category:'Pastalar',subcategory:'Adet pastalar',custom_details:{description,photo}});
 const multiple=await req('bahce','orders',{delivery:'2099-12-12',items:[item('Birinci'),item('İkinci')]});assert.equal(multiple.status,201,JSON.stringify(multiple.data));
 const multipleOrder=(await req('bahce','orders')).data.find(o=>o.id===multiple.data.id);
 const multipleDetails=(await req('bahce',`orders/${multiple.data.id}/item-details`)).data;assert.deepEqual(multipleDetails.items.map(d=>[d.item_id,d.description]),multipleOrder.items.map((i,n)=>[i.id,n?'İkinci':'Birinci']));
 assert.deepEqual((await req('park',`orders/${multiple.data.id}/item-details`)).data,{items:[],legacy:null});
 const multiImage=await fetch(base+`orders/${multiple.data.id}/custom-item-photo/${multipleDetails.items[1].id}`,{headers:{Cookie:cookies.bahce}});assert.equal(multiImage.status,200);assert.deepEqual(Buffer.from(await multiImage.arrayBuffer()),Buffer.from(photo.split(',')[1],'base64'));
 console.log('PASS: real Supabase independent per-item descriptions/photos for identical names and branch isolation');

}finally{await new Promise(r=>server.close(r));}
