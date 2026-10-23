// Local integration fixture. Auth is simulated; business SQL and RLS run in PostgreSQL/PGlite.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
export async function fixture({catalogMigration=true,usernameMigration=true,pendingEditingMigration=false,pendingItemsMigration=false}={}) {
 const db = new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 await db.exec(readFileSync(new URL('../supabase/migrations/202610210001_initial.sql',import.meta.url),'utf8'));
 if(catalogMigration)await db.exec(readFileSync(new URL('../supabase/migrations/202610210002_catalog_servings.sql',import.meta.url),'utf8'));
 if(usernameMigration)await db.exec(readFileSync(new URL('../supabase/migrations/202610210003_usernames.sql',import.meta.url),'utf8'));
 if(pendingEditingMigration||pendingItemsMigration)await db.exec(readFileSync(new URL('../supabase/migrations/202610230005_pending_order_edit.sql',import.meta.url),'utf8'));
 if(pendingItemsMigration)await db.exec(readFileSync(new URL('../supabase/migrations/202610230006_pending_order_items.sql',import.meta.url),'utf8'));
 let queue = Promise.resolve();
 function sql(id,query,params=[]) {
  const op=queue.then(async()=>{
   await db.exec('reset role');
   if(id){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
   try{return await db.query(query,params);}finally{await db.exec('reset role');}
  });queue=op.catch(()=>{});return op;
 }
 const accounts=new Map(), access=new Map(), refresh=new Map(), calls=[];
 async function add(email,password,name,role='operator',unit_id=null,active=false,username=null) {
  if([...accounts.values()].some(a=>a.email===email))throw Object.assign(Error('User already registered'),{code:'email_exists'});
  const id=randomUUID();await sql(null,'insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,email,JSON.stringify({name})]);
  const account={id,email,password};accounts.set(id,account);
  if(usernameMigration)await sql(null,'update public.profiles set name=$2,role=$3,unit_id=$4,active=$5,username=$6 where id=$1',[id,name,role,unit_id,active,username]);
  else await sql(null,'update public.profiles set name=$2,role=$3,unit_id=$4,active=$5 where id=$1',[id,name,role,unit_id,active]);return account;
 }
 for(const [name,role,unit_id] of [['admin','admin',null],['manager','manager',null],['bahce','operator',1],['park','operator',2],['imalat','operator',4]])await add(name+'@example.test','fixture-password-123',name,role,unit_id,true,name);
 const disabled=await add('disabled@example.test','fixture-password-123','Pasif','operator',null,false,'disabled');
 function session(account){const token='access-'+randomUUID(),rt='refresh-'+randomUUID();access.set(token,account.id);refresh.set(rt,account.id);return {access_token:token,refresh_token:rt,expires_in:3600,user:{id:account.id,email:account.email}};}
 const json=(data,status=200)=>new Response(data===null?'':JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 async function fetchImpl(input,options={}) {
  const u=new URL(input),body=options.body?JSON.parse(options.body):{},method=options.method||'GET',headers=options.headers||{};
  calls.push({path:u.pathname,method,token:headers.Authorization,apikey:headers.apikey,body});
  try{
   const token=headers.Authorization?.replace('Bearer ',''),id=access.get(token);
   if(u.pathname==='/auth/v1/token'){
    let a;
    if(u.searchParams.get('grant_type')==='password')a=[...accounts.values()].find(a=>a.email===body.email&&a.password===body.password);
    else a=accounts.get(refresh.get(body.refresh_token));
    if(!a)return json({error_code:'invalid_credentials',message:'Invalid login credentials'},400);
    return json(session(a));
   }
   if(u.pathname==='/auth/v1/user')return id?json({id,email:accounts.get(id).email}):json({message:'Expired JWT'},401);
   if(u.pathname==='/auth/v1/logout'){access.delete(token);return json(null);}
   if(u.pathname.startsWith('/auth/v1/admin/users')){
    if(headers.apikey!=='fixture-service-key')return json({message:'Not allowed'},403);
    if(method==='POST')return json(await add(body.email,body.password,body.user_metadata.name));
    const account=accounts.get(u.pathname.split('/').at(-1));if(!account)return json({message:'Missing account'},404);account.password=body.password;return json(account);
   }
   if(u.pathname==='/rest/v1/rpc/resolve_login_username'){
    if(headers.apikey!=='fixture-service-key')return json({code:'42501',message:'Not allowed'},403);
    if(!usernameMigration)return json({code:'PGRST202',message:'Missing function'},404);
    const r=await sql(null,'select public.resolve_login_username($1) as email',[body.p_username]);return json(r.rows[0].email);
   }
   if(!id)return json({message:'Missing JWT'},401);
   const name=u.pathname.split('/').at(-1);
   if(u.pathname.startsWith('/rest/v1/rpc/')){
    if(['pending_order_items_editing_ready','edit_pending_order_v2'].includes(name)&&!pendingItemsMigration)return json({code:'PGRST202',message:'Missing function'},404);
    if(['pending_order_editing_ready','edit_pending_order'].includes(name)&&!(pendingEditingMigration||pendingItemsMigration))return json({code:'PGRST202',message:'Missing function'},404);
    const spec={pending_order_items_editing_ready:[],edit_pending_order_v2:['p_order_id','p_expected','p_delivery','p_note','p_items','p_reason'],pending_order_editing_ready:[],edit_pending_order:['p_order_id','p_expected','p_delivery','p_note','p_quantities','p_reason'],admin_set_profile_v2:['p_user_id','p_name','p_role','p_unit_id','p_active','p_username'],save_product_v2:['p_name','p_measure','p_category','p_subcategory','p_id','p_active'],create_order_v2:['p_unit_id','p_delivery','p_items','p_note'],save_product:['p_name','p_measure','p_id','p_active'],create_order:['p_unit_id','p_delivery','p_items','p_note'],change_order_status:['p_order_id','p_status','p_note'],admin_set_profile:['p_user_id','p_name','p_role','p_unit_id','p_active']}[name];
    if(!spec)return json({code:'PGRST202',message:'Missing function'},404);
    const params=spec.map(k=>['p_items','p_expected','p_quantities'].includes(k)?JSON.stringify(body[k]):body[k]);
    const casts={pending_order_items_editing_ready:[],edit_pending_order_v2:['bigint','jsonb','date','text','jsonb','text'],pending_order_editing_ready:[],edit_pending_order:['bigint','jsonb','date','text','jsonb','text'],admin_set_profile_v2:['uuid','text','text','smallint','boolean','text'],create_order_v2:['smallint','date','jsonb','text'],save_product_v2:['text','text','text','text','bigint','boolean'],create_order:['smallint','date','jsonb','text'],save_product:['text','text','bigint','boolean'],change_order_status:['bigint','text','text'],admin_set_profile:['uuid','text','text','smallint','boolean']}[name];
    const r=await sql(id,`select public.${name}(${casts.map((c,i)=>'$'+(i+1)+'::'+c).join(',')}) as result`,params);
    return json(r.rows[0].result);
   }
   let query,params=[];
   if(name==='profiles'){
    const target=u.searchParams.get('id')?.replace('eq.','');
    const username=u.searchParams.get('username')?.replace('eq.','');
    query='select * from public.profiles'+(target?' where id=$1':username?' where username=$1':'')+' order by id';if(target)params=[target];else if(username)params=[username];
   }else if(name==='products')query='select * from public.products order by id';
   else if(name==='orders')query=`select o.*,
    coalesce((select json_agg(i order by i.id) from public.order_items i where i.order_id=o.id),'[]') as items,
    coalesce((select json_agg(e order by e.id) from public.order_events e where e.order_id=o.id),'[]') as events
    from public.orders o order by o.id desc`;
   else return json({message:'Missing route'},404);
   let rows=(await sql(id,query,params)).rows;
   // A deliberately smaller API cap verifies the adapter never truncates reports.
   if(u.searchParams.has('offset')){const offset=Number(u.searchParams.get('offset'));rows=rows.slice(offset,offset+2);}
   return json(rows);
  }catch(e){return json({code:e.code||'P0001',message:e.message},e.code==='42501'?403:e.code==='PT409'?409:400);}
 }
 return {fetchImpl,db,sql,accounts,access,refresh,calls,disabled,close:async()=>{await queue;await db.close();}};
}
