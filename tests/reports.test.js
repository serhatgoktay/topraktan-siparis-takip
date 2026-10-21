import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createExcelReport,reportFilters} from '../reports.js';
import {calendarDate,matchesOrderFilters} from '../public/dates.js';
import {createApp} from '../supabase-server.js';
import {fixture} from '../test-support/supabase-fixture.js';
const item={name:'=1+1',quantity:2.5,measure:'kg',category:'Çikolatalar'};
const order={id:1,unit:'Bahçe',created_at:'2026-10-20T22:30:00Z',delivery:'2099-12-12',status:'pending',creator:'Hakan',items:[item]};
async function workbook(buffer){const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);return book;}
test('Türkiye takvim günü, tarih alanı ve geçerli rapor filtreleri',()=>{
 assert.equal(calendarDate(order.created_at),'2026-10-21');
 assert.equal(matchesOrderFilters(order,{dateField:'created_at',from:'2026-10-21',to:'2026-10-21'}),true);
 assert.equal(matchesOrderFilters(order,{from:'2026-10-21',to:'2026-10-21'}),false);
 assert.throws(()=>reportFilters(new URLSearchParams('from=2026-02-30')),/tarih/);
 assert.throws(()=>reportFilters(new URLSearchParams('unit=Başka')),/geçersiz/);
});
test('Gerçek Excel: tarih ve miktar türleri, metin güvenliği, kişilik toplamları',async()=>{
 const cake={name:'Pasta',measure:'adet',category:'Pastalar',subcategory:'Cheesecake',quantity:2,servings:4};
 const book=await workbook(await createExcelReport([{...order,items:[item,cake,{...cake,servings:8}]}]));
 assert.equal(book.worksheets.length,4);
 const detail=book.getWorksheet('Siparişler');assert.equal(detail.getCell('C2').value.toISOString(),'2026-10-21T00:00:00.000Z');
 assert.equal(detail.getCell('F2').value,'=1+1');assert.equal(detail.getCell('F2').type,ExcelJS.ValueType.String);
 assert.equal(detail.getCell('J2').value,2.5);assert.equal(detail.getCell('I3').value,4);
 assert.equal(book.getWorksheet('Ürün toplamları').rowCount,4);
 assert.equal(book.getWorksheet('Şube özeti').getCell('B2').value,1);
});
test('Excel API oturum, RLS, şube ve tarih filtrelerini korur',async t=>{
 const f=await fixture();const {server}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await f.close();});
 const base=`http://127.0.0.1:${server.address().port}/api/`;
 async function login(username){const r=await fetch(base+'login',{method:'POST',body:JSON.stringify({username,password:'fixture-password-123'})});return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');}
 const admin=await login('admin'),bahce=await login('bahce'),park=await login('park');
 for(const cookie of [bahce,park]){const r=await fetch(base+'orders',{method:'POST',headers:{Cookie:cookie},body:JSON.stringify({delivery:'2099-12-12',items:[item]})});assert.equal(r.status,201);}
 await f.sql(null,"update public.orders set created_at='2026-10-20T22:30:00Z'");
 assert.equal((await fetch(base+'reports/export')).status,401);
 async function exported(cookie,query=''){const r=await fetch(base+'reports/export'+query,{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/spreadsheetml/);assert.match(r.headers.get('content-disposition'),/\.xlsx/);return workbook(Buffer.from(await r.arrayBuffer()));}
 assert.equal((await exported(admin)).getWorksheet('Siparişler').rowCount,3);
 const branch=await exported(bahce);assert.equal(branch.getWorksheet('Siparişler').rowCount,2);assert.equal(branch.getWorksheet('Şube özeti').rowCount,2);
 assert.equal((await exported(bahce,'?unit='+encodeURIComponent('Küçükpark'))).getWorksheet('Siparişler').rowCount,1);
 assert.equal((await exported(admin,'?dateField=created_at&from=2026-10-21&to=2026-10-21')).getWorksheet('Siparişler').rowCount,3);
 assert.equal((await exported(admin,'?dateField=delivery&from=2026-10-21&to=2026-10-21')).getWorksheet('Siparişler').rowCount,1);
});
