import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createApp} from '../supabase-server.js';
import {fixture} from '../test-support/supabase-fixture.js';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
try{
 for(const installed of [false,true]){
  const f=await fixture({pendingEditingMigration:installed});const {server}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const page=await browser.newPage({viewport:{width:1280,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}`);
   await page.getByLabel('Kullanıcı adı',{exact:true}).fill('bahce');await page.getByLabel('Şifre',{exact:true}).fill('fixture-password-123');await page.getByRole('button',{name:'Giriş yap'}).click();
   await page.getByRole('heading',{name:'İş gününe bir bakış.'}).waitFor();
   await page.evaluate(async()=>{const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delivery:'2099-12-12',items:[{name:'Özel pasta',quantity:10,measure:'adet',category:'Pastalar',subcategory:'Cheesecake',servings:8}]})});if(!r.ok)throw Error(await r.text());});
   await page.getByRole('button',{name:'Yenile'}).click();await page.getByRole('button',{name:'1 numaralı siparişi aç'}).click();
   assert.equal(await page.getByRole('button',{name:'Siparişi düzenle',exact:true}).count(),installed?1:0);
   if(installed){
    await page.getByRole('button',{name:'Siparişi düzenle',exact:true}).click();await page.getByLabel('Özel pasta miktarı 8 kişilik',{exact:true}).fill('7');await page.getByLabel('Düzenleme gerekçesi',{exact:true}).fill('Şube miktarı düzeltti');await page.getByLabel('Sipariş notu',{exact:true}).fill('Saat 11:00 teslim');
    await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth+1),true);
    await page.getByRole('button',{name:'Değişiklikleri kaydet'}).click();await page.locator('dialog[open]').waitFor({state:'detached'});
    await page.getByRole('button',{name:'1 numaralı siparişi aç'}).click();assert.match(await page.locator('dialog').innerText(),/7 adet/);assert.match(await page.locator('dialog').innerText(),/Şube miktarı düzeltti/);
   }
   assert.deepEqual(errors,[]);console.log('PASS: browser, SQL '+(installed?'installed: editing and history':'absent: existing screens remain available'));
  }finally{await page.close();await new Promise(r=>server.close(r));await f.close();}
 }
}finally{await browser.close();}
