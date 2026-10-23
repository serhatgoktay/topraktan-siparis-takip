import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createApp} from '../supabase-server.js';
import {fixture} from '../test-support/supabase-fixture.js';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
try{
 for(const installed of [false,true]){
  const f=await fixture({pendingItemsMigration:true,customItemDetailsMigration:true,servingsEditingMigration:installed}),{server}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'});await new Promise(r=>server.listen(0,'127.0.0.1',r));const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByLabel('Kullanıcı adı',{exact:true}).fill('bahce');await page.getByLabel('Şifre',{exact:true}).fill('fixture-password-123');await page.getByRole('button',{name:'Giriş yap'}).click();await page.getByRole('heading',{name:'İş gününe bir bakış.'}).waitFor();
   await page.evaluate(async()=>{const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delivery:'2099-12-12',items:[{name:'Boyutu değişecek pasta',quantity:2,measure:'adet',category:'Pastalar',subcategory:'Cheesecake',servings:8},{name:'Figürlü pasta',quantity:1,measure:'adet',category:'Pastalar',subcategory:'Figürlü adet pastalar'}]})});if(!r.ok)throw Error(await r.text());});
   await page.getByRole('button',{name:'Yenile'}).click();await page.getByRole('button',{name:'1 numaralı siparişi aç'}).click();await page.getByRole('button',{name:'Siparişi düzenle',exact:true}).click();
   assert.equal(await page.locator('[data-size]').count(),installed?1:0);
   if(installed){
    const size=page.getByLabel('Boyutu değişecek pasta pasta boyutu',{exact:true});assert.equal(await size.inputValue(),'8');
    await size.selectOption('other');await page.getByLabel('Boyutu değişecek pasta diğer kişi sayısı',{exact:true}).fill('12');await page.getByRole('button',{name:'Boyutu değişecek pasta ürününü çıkar',exact:true}).click();assert.equal(await size.isDisabled(),true);await page.getByRole('button',{name:'Ürünü geri al',exact:true}).click();assert.equal(await size.isEnabled(),true);assert.equal(await size.inputValue(),'other');
    await page.getByLabel('Düzenleme gerekçesi',{exact:true}).fill('Müşteri 12 kişilik istedi');assert.equal(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth+1),true);
    await page.getByRole('button',{name:'Değişiklikleri kaydet'}).click();await page.locator('dialog[open]').waitFor({state:'detached'});await page.getByRole('button',{name:'1 numaralı siparişi aç'}).click();assert.match(await page.locator('dialog').innerText(),/12 kişilik/);
    await page.getByRole('button',{name:'Siparişi düzenle',exact:true}).click();assert.equal(await page.getByLabel('Boyutu değişecek pasta pasta boyutu',{exact:true}).inputValue(),'other');assert.equal(await page.getByLabel('Boyutu değişecek pasta diğer kişi sayısı',{exact:true}).inputValue(),'12');await page.getByLabel('Boyutu değişecek pasta pasta boyutu',{exact:true}).selectOption('4');await page.getByLabel('Düzenleme gerekçesi',{exact:true}).fill('4 kişilik düzeltmesi');await page.getByRole('button',{name:'Değişiklikleri kaydet'}).click();await page.locator('dialog[open]').waitFor({state:'detached'});
    const saved=await page.evaluate(async()=> (await (await fetch('/api/orders')).json())[0]);assert.equal(saved.items[0].servings,4);assert.equal(saved.items[0].quantity,2);assert.equal(saved.items[1].servings,null);
   }
   assert.deepEqual(errors,[]);console.log(`PASS: servings SQL=${installed}; gated controls, other value, remove/undo, saved size, unchanged quantity and mobile layout`);
  }finally{await page.close();await new Promise(r=>server.close(r));await f.close();}
 }
}finally{await browser.close();}
