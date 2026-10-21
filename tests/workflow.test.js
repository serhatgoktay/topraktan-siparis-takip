import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

test('Sipariş, onay, üretim, geçmiş, roller ve kalıcılık',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'topraktan-'));const dbPath=join(dir,'test.db');const password='test-password-12345';let app=createApp({dbPath,adminPassword:password});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 t.after(async()=>{await new Promise(r=>app.server.close(r));app.db.close();rmSync(dir,{recursive:true,force:true});});
 async function req(path,body,cookie){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const login=async username=>{const r=await req('login',{username,password});assert.equal(r.status,200);return r.cookie;};
 let admin=await login('admin');
 assert.equal((await req('orders')).status,401);
 for(const [username,role,unit] of [['bahce','operator','Bahçe'],['kucukpark','operator','Küçükpark'],['evka','operator','Evka3'],['imalat','operator','İmalat'],['sorumlu','manager',null]])assert.equal((await req('users',{name:username,username,password,role,unit},admin)).status,200);
 const bahce=await login('bahce'),kucuk=await login('kucukpark'),evka=await login('evka'),imalat=await login('imalat'),manager=await login('sorumlu');
 assert.equal((await req('users',null,bahce)).status,403);assert.equal((await req('products',{name:'Yetkisiz',measure:'adet'},bahce)).status,403);
 assert.equal((await req('products',{name:'Poğaça',measure:'adet'},manager)).status,200);
 const product=(await req('products',null,bahce)).data[0];
 const order={unit:'Evka3',delivery:'2099-10-21',note:'Özel hazırlık',items:[{product_id:product.id,quantity:10},{name:'Özel pasta',quantity:2,measure:'tepsi'},{name:'Kurabiye',quantity:1.5,measure:'kg'}]};
 let result=await req('orders',order,bahce);assert.equal(result.status,201);const id=result.data.id;
 let rows=(await req('orders',null,bahce)).data;assert.equal(rows.length,1);assert.equal(rows[0].unit,'Bahçe');assert.equal(rows[0].items.length,3);
 assert.equal((await req('orders',null,kucuk)).data.length,0);assert.equal((await req('orders',null,evka)).data.length,0);assert.equal((await req('orders',null,imalat)).data.length,0);
 assert.equal((await req(`orders/${id}/status`,{status:'approved'},bahce)).status,403);
 assert.equal((await req(`orders/${id}/status`,{status:'preparing'},admin)).status,400);
 assert.equal((await req(`orders/${id}/status`,{status:'rejected'},manager)).status,400);
 assert.equal((await req(`orders/${id}/status`,{status:'approved'},manager)).status,200);
 assert.equal((await req('orders',null,imalat)).data.length,1);
 assert.equal((await req(`orders/${id}/status`,{status:'preparing'},bahce)).status,403);
 for(const status of ['preparing','ready','delivered'])assert.equal((await req(`orders/${id}/status`,{status},imalat)).status,200);
 rows=(await req('orders',null,admin)).data;assert.equal(rows[0].status,'delivered');assert.equal(rows[0].events.length,5);
 assert.equal((await req('products',{id:product.id,name:'Yeni ad',measure:'kg',active:false},admin)).status,200);
 rows=(await req('orders',null,admin)).data;assert.equal(rows[0].items[0].name,'Poğaça');assert.equal(rows[0].items[0].measure,'adet');
 assert.equal((await req('orders',order,bahce)).status,400);
 const custom={...order,items:[{name:'Yeni özel',quantity:1,measure:'adet'}]};
 const rejected=(await req('orders',custom,kucuk)).data.id;
 assert.equal((await req(`orders/${rejected}/status`,{status:'rejected',note:'Teslim tarihi uygun değil'},admin)).status,200);
 assert.equal((await req('orders',null,kucuk)).data[0].events[1].note,'Teslim tarihi uygun değil');
 for(const quantity of [0,-1,1.5])assert.equal((await req('orders',{...custom,items:[{name:'X',quantity,measure:'adet'}]},bahce)).status,400);
 assert.equal((await req('orders',{...custom,delivery:'2020-01-01'},bahce)).status,400);
 const allUsers=(await req('users',null,admin)).data;const b=allUsers.find(u=>u.username==='bahce');assert.equal((await req('users',{...b,active:false},admin)).status,200);assert.equal((await req('orders',null,bahce)).status,401);
 const a=allUsers.find(u=>u.username==='admin');assert.equal((await req('users',{...a,active:false},admin)).status,400);
 assert.equal((await req('logout',{},manager)).status,200);assert.equal((await req('orders',null,manager)).status,401);
 await new Promise(r=>app.server.close(r));app.db.close();app=createApp({dbPath});assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,2);assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,7);
});

test('İlk yönetici için güçlü şifre zorunlu',()=>{const dir=mkdtempSync(join(tmpdir(),'topraktan-init-'));try{assert.throws(()=>createApp({dbPath:join(dir,'x.db'),adminPassword:'short'}),/12 karakter/);}finally{rmSync(dir,{recursive:true,force:true});}});
