import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../supabase-server.js';
import { fixture } from '../test-support/supabase-fixture.js';

test('Supabase sunucusu: Auth, cookie, RLS, RPC, kullanıcı yönetimi ve tam rapor',async t=>{
 const f=await fixture();const {server}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key',secureCookies:true});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await f.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 async function req(path,body,cookie,extra={}){const response=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...extra},body:body?JSON.stringify(body):undefined});const cookies=response.headers.getSetCookie();return {status:response.status,data:await response.json(),cookies,cookie:cookies.map(c=>c.split(';')[0]).join('; ')};}
 async function login(name){const r=await req('login',{username:name,password:'fixture-password-123'});assert.equal(r.status,200);assert.ok(r.cookies.every(c=>c.includes('HttpOnly')&&c.includes('SameSite=Strict')&&c.includes('Secure')));return r.cookie;}
 assert.equal((await req('config')).data.backend,'supabase');assert.equal((await req('orders')).status,401);
 assert.equal((await req('login',{username:'admin',password:'wrong'})).status,401);
 assert.equal((await req('login',{username:'disabled',password:'fixture-password-123'})).status,401);
 const admin=await login('admin'),manager=await login('manager'),bahce=await login('bahce'),park=await login('park'),imalat=await login('imalat');
 assert.equal((await req('me',null,admin)).data.role,'admin');assert.equal((await req('me',null,bahce)).data.unit,'Bahçe');
 assert.equal((await req('users',null,bahce)).status,403);
 assert.equal((await req('products',{name:'X',measure:'adet'},bahce)).status,403);
 for(const name of ['Poğaça','Simit','Börek'])assert.equal((await req('products',{name,measure:'adet',category:'Tatlı kurabiyeler',subcategory:null},manager)).status,200);
 const products=(await req('products',null,bahce)).data;assert.equal(products.length,3);
 const body={unit:'Küçükpark',delivery:'2099-10-21',note:'Not',items:[{product_id:products[0].id,quantity:12},{name:'Özel pasta',quantity:2,measure:'tepsi',category:'Pastalar',subcategory:'Figürlü adet pastalar'}]};
 for(let i=0;i<3;i++)assert.equal((await req('orders',body,bahce)).status,201);
 let orders=(await req('orders',null,admin)).data;assert.equal(orders.length,3);assert.equal(orders[0].unit,'Bahçe');assert.equal(orders[0].items[0].name,'Poğaça');assert.equal(orders[0].events[0].actor,'bahce');
 assert.equal((await req('orders',null,park)).data.length,0);assert.equal((await req('orders',null,imalat)).data.length,0);
 const id=orders[0].id;
 assert.equal((await req(`orders/${id}/status`,{status:'approved'},bahce)).status,403);
 assert.equal((await req(`orders/${id}/status`,{status:'approved'},manager)).status,200);
 for(const status of ['preparing','ready','delivered'])assert.equal((await req(`orders/${id}/status`,{status},imalat)).status,200);
 orders=(await req('orders',null,bahce)).data;assert.equal(orders[0].events.length,5);assert.equal(orders[0].status,'delivered');
 const newUser={name:'Evka Operatörü',username:'evka_operator',email:'evka@example.test',password:'new-user-password-123',role:'operator',unit:'Evka3',active:true};
 assert.equal((await req('users',newUser,bahce)).status,403);
 const created=await req('users',newUser,admin);assert.equal(created.status,200);assert.match(created.data.id,/^[0-9a-f-]{36}$/);
 let evka=await req('login',{username:newUser.username,password:newUser.password});assert.equal(evka.status,200);assert.equal(evka.data.unit,'Evka3');
 const account=(await req('users',null,admin)).data.find(u=>u.id===created.data.id);
 assert.equal((await req('users',{...account,active:false},admin)).status,200);assert.equal((await req('orders',null,evka.cookie)).status,403);
 const me=(await req('me',null,admin)).data;assert.equal((await req('users',{...me,role:'operator',unit:'Bahçe'},admin)).status,400);
 const rt=admin.split('; ').find(c=>c.startsWith('sb_refresh='));const refreshed=await req('me',null,rt);assert.equal(refreshed.status,200);assert.ok(refreshed.cookie.includes('sb_access='));
 assert.equal((await req('me',null,'sb_access=invalid; sb_refresh=invalid')).status,401);
 assert.equal((await req('products',{name:'CSRF',measure:'adet'},admin,{Origin:'https://attacker.test'})).status,403);
 assert.equal((await req('logout',{},manager)).status,200);assert.equal((await req('me',null,manager.split('; ')[0])).status,401);
 assert.equal((await req('products',{name:'Çikolatalı pasta',measure:'adet',category:'Pastalar',subcategory:'Cheesecake'},manager)).status,200);
 const cake=(await req('products',null,admin)).data.find(p=>p.name==='Çikolatalı pasta');
 const cakeBody={...body,items:[{product_id:cake.id,quantity:2,servings:6},{product_id:cake.id,quantity:1,servings:11}]};
 assert.equal((await req('orders',cakeBody,bahce)).status,201);
 const cakeOrder=(await req('orders',null,admin)).data[0];assert.deepEqual(cakeOrder.items.map(i=>i.servings),[6,11]);assert.ok(cakeOrder.items.every(i=>i.category==='Pastalar'&&i.subcategory==='Cheesecake'));
 assert.equal((await req('orders',{...cakeBody,items:[{product_id:cake.id,quantity:1}]},bahce)).status,400);
 const userWrites=f.calls.filter(c=>c.path.includes('/rest/v1/rpc/'));assert.ok(userWrites.every(c=>c.path.endsWith('/resolve_login_username')||c.token?.startsWith('Bearer access-')));assert.ok(userWrites.every(c=>c.path.endsWith('/resolve_login_username')||c.apikey!=='fixture-service-key'));
});

test('Yönetici anahtarı eksikse kullanıcı adıyla giriş açık kurulum mesajı verir',async t=>{
 const f=await fixture();const {server}=createApp({fetchImpl:f.fetchImpl,serviceKey:''});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await f.close();});
 const url=`http://127.0.0.1:${server.address().port}/api/`;const login=await fetch(url+'login',{method:'POST',body:JSON.stringify({username:'admin',password:'fixture-password-123'})});
 assert.equal(login.status,503);assert.match((await login.json()).error,/SUPABASE_SERVICE_ROLE_KEY/);assert.equal(f.calls.filter(c=>c.path==='/auth/v1/token').length,0);
});


test('Sunucusuz işlevin önceden ayrıştırılmış JSON gövdesi kabul edilir', async t => {
 const f=await fixture();t.after(()=>f.close());
 const {handler}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'});
 const headers={};let status,output;
 const response={setHeader:(k,v)=>headers[k]=v,writeHead:(s)=>{status=s;},end:value=>{output=value;}};
 await handler({url:'/api/login',method:'POST',headers:{host:'example.test'},body:{username:'admin',password:'fixture-password-123'}},response);
 assert.equal(status,200);assert.equal(JSON.parse(output).role,'admin');assert.equal(headers['Set-Cookie'].length,2);
});
