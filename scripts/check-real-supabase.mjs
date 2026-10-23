// Acceptance check against real, disposable Supabase services, never a hosted project.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import ExcelJS from 'exceljs';
import {createApp} from '../supabase-server.js';
import {buildProductionUpdate} from './build-production-update.mjs';

assert.ok(process.env.LOCAL_SUPABASE_STATUS_FILE,'Local Supabase status file is required. Hosted keys are not supported.');
const config=JSON.parse(readFileSync(process.env.LOCAL_SUPABASE_STATUS_FILE,'utf8'));
const local=new URL(config.API_URL);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(local.hostname),'Only a loopback Supabase endpoint is permitted.');
assert.equal(local.protocol,'http:','This isolated runner uses local HTTP; production HTTPS validation stays enabled.');
assert.ok(config.ANON_KEY&&config.SERVICE_ROLE_KEY,'Local CLI legacy keys are required.');
const anonymousKey=config.ANON_KEY,serviceKey=config.SERVICE_ROLE_KEY;
const results=[];
const checked=label=>{results.push(label);console.log('PASS: '+label);};
async function remote(path,{token=serviceKey,method='GET',body}={}){
 const r=await fetch(new URL(path,local),{method,headers:{apikey:anonymousKey,Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 const data=await r.json().catch(()=>null);return {status:r.status,data};
}
const names=['admin','manager','bahce','park','imalat'],accounts=new Map();
const repair=buildProductionUpdate(readFileSync(new URL('../supabase/migrations/202610220004_order_revisions.sql',import.meta.url),'utf8'));
const repairResult=execFileSync('docker',['exec','-i','supabase_db_topraktan-ci','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:repair,encoding:'utf8',stdio:['pipe','pipe','pipe']});
assert.match(repairResult,/GUNCELLEME_TAMAMLANDI/);
checked('Atomic migration installer and real PostgreSQL post-install verification');
const password='Local-'+randomBytes(24).toString('base64url');
for(const name of names){
 const created=await remote('/auth/v1/admin/users',{method:'POST',body:{email:`${name}@topraktan-test.invalid`,password,email_confirm:true,user_metadata:{name}}});
 assert.equal(created.status,200,`Local Auth user creation failed: ${name}`);
 const user=created.data.user||created.data;assert.match(user.id,/^[0-9a-f-]{36}$/i);accounts.set(name,user);
}
// Bootstrap only the disposable database; container name is fixed, no external DB URL.
const values=names.map(name=>{
 const role=name==='admin'?'admin':name==='manager'?'manager':'operator';
 const unit={bahce:1,park:2,imalat:4}[name]??'null';
 return `update public.profiles set role='${role}',username='${name}',unit_id=${unit},active=true where id='${accounts.get(name).id}'::uuid;`;
}).join('\n');
execFileSync('docker',['exec','-i','supabase_db_topraktan-ci','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:values,stdio:['pipe','pipe','pipe']});
checked('Real Auth identities and application profiles');
// Production adapter keeps its HTTPS requirement. Only this local harness maps its
// synthetic HTTPS origin to the CLI's loopback HTTP gateway; no response is mocked.
const transport=async(input,options)=>{
 const url=new URL(input);assert.equal(url.origin,'https://topraktan-local.invalid');
 return fetch(new URL(url.pathname+url.search,local),options);
};
const {server}=createApp({url:'https://topraktan-local.invalid',publishableKey:anonymousKey,serviceKey,fetchImpl:transport,workflowEnabled:true,secureCookies:false});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const app=`http://127.0.0.1:${server.address().port}/api/`,cookies={};
async function request(name,path,body){
 const r=await fetch(app+path,{method:body?'POST':'GET',headers:{...(cookies[name]?{Cookie:cookies[name]}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const type=r.headers.get('content-type')||'';
 return {status:r.status,data:type.includes('json')?await r.json():Buffer.from(await r.arrayBuffer()),headers:r.headers,cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
try{
 for(const name of names){const r=await request('', 'login',{username:name,password});assert.equal(r.status,200,`Username login failed: ${name}: ${JSON.stringify(r.data)}`);cookies[name]=r.cookie;}
 checked('Real Auth username login and cookies for all five roles/units');
 const body={unit:'Bahçe',delivery:'2099-12-12',items:[{name:'Test pastası',quantity:10,measure:'adet',category:'Pastalar',subcategory:'Cheesecake',servings:8,description:'Yerel test'}]};
 const created=await request('bahce','orders',body);assert.equal(created.status,201,JSON.stringify(created.data));const oid=created.data.id;
 let o=(await request('bahce','orders')).data.find(o=>o.id===oid);assert.ok(o);const item=o.items[0];
 assert.equal((await request('park','orders')).data.length,0);assert.equal((await request('manager','orders')).data.length,0);
 assert.equal((await request('manager','orders',body)).status,403);
 assert.equal((await request('manager',`orders/${oid}/status`,{status:'approved'})).status,403);
 const session=await remote('/auth/v1/token?grant_type=password',{method:'POST',token:anonymousKey,body:{email:accounts.get('park').email,password}});assert.equal(session.status,200);
 assert.deepEqual((await remote(`/rest/v1/orders?id=eq.${oid}&select=*`,{token:session.data.access_token})).data,[]);
 const unauthorized=await remote('/rest/v1/rpc/cancel_order_items',{token:session.data.access_token,method:'POST',body:{p_order_id:oid,p_revision:1,p_items:null,p_reason:'Yetkisiz şube'}});assert.equal(unauthorized.status,403);
 const directWrite=await remote(`/rest/v1/orders?id=eq.${oid}`,{token:session.data.access_token,method:'PATCH',body:{status:'approved'}});assert.equal(directWrite.status,403);
 checked('Actual PostgREST RLS: branch isolation, no direct writes, manager cannot approve');
 const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 assert.equal((await request('bahce',`orders/${oid}/image`,{revision:1,item_id:item.id,mime:'image/png',content:pixel,reason:'Deneme görseli'})).status,200);
 o=(await request('bahce','orders')).data.find(o=>o.id===oid);const imageId=o.images[0].id;
 assert.equal((await request('park',`images/${imageId}`)).status,403);assert.equal((await request('bahce',`images/${imageId}`)).status,200);
 assert.equal((await request('bahce',`orders/${oid}/edit`,{revision:2,delivery:body.delivery,note:'',items:[{...item,description:'Yeni açıklama'}],reason:'Açıklama düzeltildi'})).status,200);
 assert.equal((await request('admin',`orders/${oid}/status`,{status:'approved'})).status,200);
 assert.equal((await request('manager',`orders/${oid}/status`,{status:'preparing'})).status,200);
 o=(await request('admin','orders')).data.find(o=>o.id===oid);
 assert.equal((await request('bahce',`orders/${oid}/cancel`,{revision:o.revision,items:null,reason:'Onay sonrası deneme'})).status,403);
 assert.equal((await request('admin',`orders/${oid}/cancel`,{revision:o.revision,items:[{id:item.id,quantity:3}],reason:'Üç adet iptal'})).status,200);
 const conflictStart=performance.now();
 const stale=await request('admin',`orders/${oid}/cancel`,{revision:o.revision,items:[{id:item.id,quantity:1}],reason:'Eski sürüm'});
 assert.equal(stale.status,409,JSON.stringify(stale.data));
 assert.ok(performance.now()-conflictStart<15000,'A business conflict must return before the Supabase request timeout.');
 checked('Custom image privacy, edits, approval, partial cancellation and stale revision');
 const notices=(await request('manager','notifications')).data;assert.equal(notices.length,1,JSON.stringify(notices));const n=notices[0];
 assert.equal(Number(n.event.after_data.items[0].cancelled_quantity),3);
 assert.equal((await request('manager',`orders/${oid}/status`,{status:'ready'})).status,400);
 assert.equal((await request('manager',`notifications/${n.id}`,{review:false})).status,200);
 assert.equal((await request('manager',`orders/${oid}/status`,{status:'ready'})).status,400);
 assert.equal((await request('manager',`notifications/${n.id}`,{review:true})).status,200);
 assert.equal((await request('manager',`orders/${oid}/status`,{status:'ready'})).status,200);
 assert.equal((await request('manager',`orders/${oid}/production-message`,{note:'Deneme üretim notu',issue:true})).status,200);
 checked('Persistent notifications, read/review distinction, production hold and issue history');
 const report=await request('manager','reports/export?reportType=completed');assert.equal(report.status,200);
 const book=new ExcelJS.Workbook();await book.xlsx.load(report.data);
 const ws=book.getWorksheet('Siparişler'),headers=ws.getRow(1).values,row=ws.getRow(2);
 assert.equal(row.getCell(headers.indexOf('İptal miktarı')).value,3);assert.equal(row.getCell(headers.indexOf('Kalan / Üretilecek')).value,7);
 assert.ok(book.getWorksheet('İşlem geçmişi'));
 const branchReport=await request('park','reports/export');const empty=new ExcelJS.Workbook();await empty.xlsx.load(branchReport.data);assert.equal(empty.getWorksheet('Siparişler').rowCount,1);
 checked('Real Supabase data exported to XLSX: 10 ordered, 3 cancelled, 7 remaining; branch scope preserved');
 if(process.env.TEST_SUMMARY_FILE)writeFileSync(process.env.TEST_SUMMARY_FILE,JSON.stringify({result:'passed',backend:'real local Supabase PostgreSQL/Auth/PostgREST',hostedProjectUsed:false,checks:results,createdAt:new Date().toISOString()},null,2));
}finally{await new Promise(resolve=>server.close(resolve));}
