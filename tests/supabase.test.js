import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('Supabase SQL: RLS, rol yükseltme engeli, onay, üretim ve atomik kayıt',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 await db.exec(readFileSync(new URL('../supabase/migrations/202610210001_initial.sql',import.meta.url),'utf8'));
 const ids={admin:'00000000-0000-0000-0000-000000000001',manager:'00000000-0000-0000-0000-000000000002',bahce:'00000000-0000-0000-0000-000000000003',park:'00000000-0000-0000-0000-000000000004',imalat:'00000000-0000-0000-0000-000000000005',rogue:'00000000-0000-0000-0000-000000000006'};
 for(const [name,id] of Object.entries(ids))await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,name+'@example.test',JSON.stringify({name,role:'admin',active:true,unit_id:1})]);
 let r=await db.query('select * from public.profiles where id=$1',[ids.rogue]);assert.equal(r.rows[0].active,false);assert.equal(r.rows[0].role,'operator');assert.equal(r.rows[0].unit_id,null);
 await db.query("update public.profiles set role='admin',active=true where id=$1",[ids.admin]);await db.query("update public.profiles set role='manager',active=true where id=$1",[ids.manager]);
 for(const [key,unit] of [['bahce',1],['park',2],['imalat',4]])await db.query('update public.profiles set active=true,unit_id=$2 where id=$1',[ids[key],unit]);
 async function as(name,sql,params=[]){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]||'']);await db.exec(`set role ${name==='anon'?'anon':'authenticated'}`);try{return await db.query(sql,params);}finally{await db.exec('reset role');}}
 await assert.rejects(as('anon','select * from public.orders'),/permission denied/);
 await assert.rejects(as('rogue',"select public.save_product('X','adet')"),/yetkiniz yok/);
 await assert.rejects(as('bahce',"update public.profiles set role='admin' where id=$1",[ids.bahce]),/permission denied/);
 await assert.rejects(as('bahce',"select public.admin_set_profile($1,'Bahçe','admin',null,true)",[ids.bahce]),/yetkiniz yok/);
 const product=Number((await as('manager',"select public.save_product('Poğaça','adet') as id")).rows[0].id);
 const items=[{product_id:product,quantity:10},{name:'Özel pasta',measure:'tepsi',quantity:2},{name:'Özel kurabiye',measure:'kg',quantity:1.125}];
 const order=Number((await as('bahce',"select public.create_order(2::smallint,'2099-10-21',$1::jsonb,'Şube notu') as id",[JSON.stringify(items)])).rows[0].id);
 r=await as('bahce','select * from public.orders');assert.equal(r.rows.length,1);assert.equal(r.rows[0].unit_id,1);
 for(const who of ['park','imalat','rogue']){assert.equal((await as(who,'select * from public.orders')).rows.length,0);assert.equal((await as(who,'select * from public.order_items')).rows.length,0);assert.equal((await as(who,'select * from public.order_events')).rows.length,0);}
 assert.equal((await as('admin','select * from public.order_items')).rows.length,3);
 await assert.rejects(as('bahce',"update public.orders set status='approved'"),/permission denied/);
 await assert.rejects(as('bahce',"select public.change_order_status($1,'approved')",[order]),/Onay yetkiniz yok/);
 await assert.rejects(as('manager',"select public.change_order_status($1,'preparing')",[order]),/Geçersiz durum/);
 await assert.rejects(as('manager',"select public.change_order_status($1,'rejected')",[order]),/Ret gerekçesi/);
 await as('manager',"select public.change_order_status($1,'approved')",[order]);
 assert.equal((await as('imalat','select * from public.orders')).rows.length,1);
 await assert.rejects(as('park',"select public.change_order_status($1,'preparing')",[order]),/Sipariş bulunamadı/);
 await assert.rejects(as('bahce',"select public.change_order_status($1,'preparing')",[order]),/Üretim yetkiniz yok/);
 for(const status of ['preparing','ready','delivered'])await as('imalat','select public.change_order_status($1,$2)',[order,status]);
 assert.equal((await as('bahce','select * from public.order_events')).rows.length,5);
 await as('admin',"select public.save_product('Yeni ürün adı','kg',$1,false)",[product]);
 r=await as('bahce','select * from public.order_items where product_id=$1',[product]);assert.equal(r.rows[0].name,'Poğaça');assert.equal(r.rows[0].measure,'adet');
 await assert.rejects(as('bahce',"select public.create_order(1::smallint,'2099-10-21',$1::jsonb)",[JSON.stringify(items)]),/artık kullanılamıyor/);
 const count=async()=>Number((await as('admin','select count(*) as n from public.orders')).rows[0].n);
 for(const badItems of [[{name:'Geçerli',measure:'adet',quantity:2},{name:'Hatalı',measure:'adet',quantity:1.5}],[{name:'Hatalı kg',measure:'kg',quantity:0.0001}],[]]){await assert.rejects(as('bahce',"select public.create_order(1::smallint,'2099-10-21',$1::jsonb)",[JSON.stringify(badItems)]));assert.equal(await count(),1);}
 const rejected=Number((await as('park',"select public.create_order(2::smallint,'2099-10-21',$1::jsonb) as id",[JSON.stringify([{name:'Özel',measure:'adet',quantity:1}])])).rows[0].id);
 await as('admin',"select public.change_order_status($1,'rejected','Tarih uygun değil')",[rejected]);
 assert.equal((await as('imalat','select * from public.orders')).rows.length,1);assert.equal((await as('park','select * from public.orders')).rows.length,1);
 await assert.rejects(as('admin',"select public.admin_set_profile($1,'Yönetici','operator',1::smallint,true)",[ids.admin]),/Kendi yönetici yetkinizi/);
 await as('admin',"select public.admin_set_profile($1,'Bahçe','operator',1::smallint,false)",[ids.bahce]);assert.equal((await as('bahce','select * from public.orders')).rows.length,0);assert.equal((await as('bahce','select * from public.products')).rows.length,0);
 r=await db.query("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'");assert.equal(r.rows.length,6);assert.ok(r.rows.every(t=>t.relrowsecurity));
});
