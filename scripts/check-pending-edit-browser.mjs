import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createApp} from '../supabase-server.js';
import {fixture} from '../test-support/supabase-fixture.js';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
try{
 for(const mode of ['none','quantity','items']){
  const installed=mode!=='none',itemsEnabled=mode==='items';
  const f=await fixture({pendingEditingMigration:installed,pendingItemsMigration:itemsEnabled});const {server}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  if(itemsEnabled)await f.sql(null,"insert into public.products(name,measure,category,subcategory) values('Katalog pasta','adet','Pastalar','Cheesecake')");
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
    if(itemsEnabled){
     await page.getByRole('button',{name:'Özel pasta ürününü çıkar',exact:true}).click();await page.getByRole('button',{name:'Değişiklikleri kaydet'}).click();await page.getByText('Siparişte en az bir ürün kalmalı.',{exact:false}).waitFor();
     await page.getByRole('button',{name:'Ürünü geri al',exact:true}).click();assert.equal(await page.getByLabel('Özel pasta miktarı 8 kişilik',{exact:true}).isEnabled(),true);
     await page.getByRole('button',{name:'+ Ürün ekle',exact:true}).click();const added=page.locator('#pending-new-items .item-row').nth(0);await added.locator('[name=product]').selectOption({label:'Katalog pasta (adet)'});await added.getByLabel('Pasta boyutu',{exact:true}).selectOption('6');await added.getByLabel('Miktar',{exact:true}).fill('2');
     await page.getByRole('button',{name:'+ Ürün ekle',exact:true}).click();const custom=page.locator('#pending-new-items .item-row').nth(1);await custom.locator('[name=category]').selectOption('Çikolatalar');await custom.getByLabel('Özel ürün adı',{exact:true}).fill('Özel çikolata');await custom.locator('[name=measure]').selectOption('kg');await custom.getByLabel('Miktar',{exact:true}).fill('1.125');
     await page.getByRole('button',{name:'Özel pasta ürününü çıkar',exact:true}).click();
    }else assert.equal(await page.getByRole('button',{name:'+ Ürün ekle',exact:true}).count(),0);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth+1),true);
    await page.getByRole('button',{name:'Değişiklikleri kaydet'}).click();await page.locator('dialog[open]').waitFor({state:'detached'});
    await page.getByRole('button',{name:'1 numaralı siparişi aç'}).click();if(itemsEnabled){assert.match(await page.locator('dialog').innerText(),/Katalog pasta/);const items=await page.evaluate(async()=> (await (await fetch('/api/orders')).json())[0].items);assert.deepEqual(items.map(i=>i.name),['Katalog pasta','Özel çikolata']);assert.equal(items[0].servings,6);}else assert.match(await page.locator('dialog').innerText(),/7 adet/);assert.match(await page.locator('dialog').innerText(),/Şube miktarı düzeltti/);
   }
   assert.deepEqual(errors,[]);console.log('PASS: browser mode '+mode+'; existing screens, form, history and mobile layout');
  }finally{await page.close();await new Promise(r=>server.close(r));await f.close();}
 }
}finally{await browser.close();}
