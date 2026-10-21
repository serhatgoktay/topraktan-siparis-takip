import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixture} from '../test-support/supabase-fixture.js';
import {createApp} from '../supabase-server.js';
const migration=readFileSync(new URL('../supabase/migrations/202610210003_usernames.sql',import.meta.url),'utf8');
const idFor=(f,name)=>[...f.accounts.values()].find(a=>a.email===name+'@example.test').id;

test('Kullanıcı adı geçişi: hakan, birim adları, çakışmalar, eski hesap/şifre ve tekrar çalıştırma',async t=>{
 const f=await fixture({usernameMigration:false});t.after(()=>f.close());const original=[...f.accounts.values()].map(a=>({...a}));
 // Add a second branch operator before upgrading to exercise automatic suffixes.
 const second=randomUUID();await f.sql(null,'insert into auth.users(id,email) values($1,$2)',[second,'bahce-second@example.test']);await f.sql(null,"update public.profiles set unit_id=1,active=true where id=$1",[second]);
 await f.db.exec(migration);await f.db.exec(migration);
 const rows=(await f.sql(null,'select * from public.profiles')).rows;
 assert.equal(rows.find(p=>p.id===idFor(f,'admin')).username,'hakan');
 assert.equal(rows.find(p=>p.id===idFor(f,'manager')).username,'imalat_sorumlusu');
 assert.equal(rows.find(p=>p.id===idFor(f,'park')).username,'kucukpark');
 assert.equal(rows.find(p=>p.id===idFor(f,'imalat')).username,'imalat');
 assert.deepEqual(rows.filter(p=>p.unit_id===1).map(p=>p.username).sort(),['bahce','bahce2']);
 assert.equal(new Set(rows.map(p=>p.username)).size,rows.length);assert.deepEqual([...f.accounts.values()],original);
 const rogue=randomUUID();await f.sql(null,'insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[rogue,'rogue@example.test',JSON.stringify({username:'hakan',role:'admin',active:true})]);
 const profile=(await f.sql(null,'select * from public.profiles where id=$1',[rogue])).rows[0];assert.equal(profile.username,null);assert.equal(profile.active,false);assert.equal(profile.role,'operator');
 await assert.rejects(f.sql(null,'update public.profiles set active=true where id=$1',[rogue]),/profiles_active_username_check/);
});

test('Kullanıcı adı/e-posta çözümlemesi yalnız service_role erişimine açıktır',async t=>{
 const f=await fixture();t.after(()=>f.close());
 for(const role of ['anon','authenticated']){
  await f.db.exec(`set role ${role}`);
  try{await assert.rejects(f.db.query("select public.resolve_login_username('admin')"),/permission denied/);}finally{await f.db.exec('reset role');}
 }
 await f.db.exec('set role service_role');
 try{
  assert.equal((await f.db.query("select public.resolve_login_username(' ADMIN ') as email")).rows[0].email,'admin@example.test');
  assert.equal((await f.db.query("select public.resolve_login_username('disabled') as email")).rows[0].email,null);
  assert.equal((await f.db.query("select public.resolve_login_username('missing') as email")).rows[0].email,null);
 }finally{await f.db.exec('reset role');}
 const branch=idFor(f,'bahce');
 await assert.rejects(f.sql(branch,"select public.admin_set_profile_v2($1,'Ele geçirme','admin',null,true,'takeover')",[branch]),/yetkiniz yok/);
 await assert.rejects(f.sql(branch,"update public.profiles set username='takeover' where id=$1",[branch]),/permission denied/);
});

test('Kullanıcı adıyla giriş: e-posta kabul edilmez, ad değiştirme, çakışma, yetkiler ve pasif hesap',async t=>{
 const f=await fixture();const {server}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await f.close();});
 const base=`http://127.0.0.1:${server.address().port}/api/`;
 async function req(path,body,cookie){const r=await fetch(base+path,{method:body?'POST':'GET',headers:cookie?{Cookie:cookie}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};}
 const login=(username,password='fixture-password-123')=>req('login',{username,password});
 const admin=await login(' ADMIN ');assert.equal(admin.status,200);assert.equal(admin.data.username,'admin');
 const wrong=await login('admin','incorrect-password'),missing=await login('missing'),disabled=await login('disabled');assert.equal(wrong.status,401);assert.deepEqual(missing.data,wrong.data);assert.deepEqual(disabled.data,wrong.data);
 assert.equal((await login('admin@example.test')).status,401);assert.equal((await req('login',{email:'admin@example.test',password:'fixture-password-123'})).status,401);
 const branch=await login('bahce');const profiles=(await req('users',null,admin.cookie)).data;
 const profile=profiles.find(p=>p.username==='bahce');
 const write={...profile,username:'  BAHCE01  '};assert.equal((await req('users',write,admin.cookie)).status,200);
 assert.equal((await login('bahce')).status,401);assert.equal((await login('Bahce01')).status,200);
 assert.equal((await req('me',null,branch.cookie)).data.id,profile.id); // Existing session and identity survive rename.
 const duplicate={name:'Duplicate',username:'BAHCE01',email:'duplicate@example.test',password:'new-password-123',role:'operator',unit:'Bahçe',active:true};
 const before=f.calls.filter(c=>c.path==='/auth/v1/admin/users').length;assert.equal((await req('users',duplicate,admin.cookie)).status,409);assert.equal(f.calls.filter(c=>c.path==='/auth/v1/admin/users').length,before);
 assert.equal((await req('users',{...write,username:'two words'},admin.cookie)).status,400);
 assert.equal((await req('users',{...write,username:'unauthorized'},branch.cookie)).status,403);
 assert.equal((await req('users',{...write,username:'bahce01',active:false},admin.cookie)).status,200);
 assert.equal((await login('bahce01')).status,401);assert.equal((await req('orders',null,branch.cookie)).status,403);
 const lookupCalls=f.calls.filter(c=>c.path.endsWith('/resolve_login_username'));assert.ok(lookupCalls.every(c=>c.apikey==='fixture-service-key'));
 const dataCalls=f.calls.filter(c=>c.path.startsWith('/rest/v1/')&&!c.path.endsWith('/resolve_login_username'));assert.ok(dataCalls.every(c=>c.apikey!=='fixture-service-key'));
});

test('Kullanıcı adı SQL güncellemesi yoksa e-posta girişine geri dönülmez',async t=>{
 const f=await fixture({usernameMigration:false});const {server}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await f.close();});
 const r=await fetch(`http://127.0.0.1:${server.address().port}/api/login`,{method:'POST',body:JSON.stringify({username:'hakan',password:'fixture-password-123'})});assert.equal(r.status,503);assert.match((await r.json()).error,/Kullanıcı adı güncellemesi eksik/);assert.equal(f.calls.filter(c=>c.path==='/auth/v1/token').length,0);
});
