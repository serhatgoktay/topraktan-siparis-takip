import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createApp} from '../supabase-server.js';
import {fixture} from '../test-support/supabase-fixture.js';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
try{
 for(const installed of [false,true]){
  const f=await fixture({pendingItemsMigration:true,customDetailsMigration:installed});const {server}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await f.sql(null,"insert into public.products(name,measure,category) values('Katalog çikolata','adet','Çikolatalar')");
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByLabel('Kullanıcı adı',{exact:true}).fill('bahce');await page.getByLabel('Şifre',{exact:true}).fill('fixture-password-123');await page.getByRole('button',{name:'Giriş yap'}).click();await page.getByRole('heading',{name:'İş gününe bir bakış.'}).waitFor();
   await page.getByRole('button',{name:'+ Yeni sipariş',exact:true}).click();
   assert.equal(await page.locator('#custom-order-fields').count(),installed?1:0);
   await page.getByLabel('Kategori',{exact:true}).selectOption('Çikolatalar');await page.getByLabel('Özel ürün adı',{exact:true}).fill('Özel çikolata');
   if(installed){
    await page.getByLabel('Özel sipariş açıklaması',{exact:true}).fill('Ali için mavi kutu.\n<script>alert(1)</script>');
    assert.equal(await page.getByLabel('Özel sipariş fotoğrafı çek',{exact:true}).getAttribute('capture'),'environment');
    const buffer=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2400;c.height=1800;const ctx=c.getContext('2d');ctx.fillStyle='#2e7750';ctx.fillRect(0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];}),'base64');
    await page.getByLabel('Özel sipariş resmi seç',{exact:true}).setInputFiles({name:'foto.png',mimeType:'image/png',buffer});await page.getByText('Fotoğraf hazır.',{exact:true}).waitFor();
    const preview=page.locator('.custom-photo-preview');await page.waitForFunction(()=>document.querySelector('.custom-photo-preview').naturalWidth>0);assert.ok((await preview.evaluate(i=>i.naturalWidth))<=1600);
    await page.getByRole('button',{name:'Fotoğrafı kaldır',exact:true}).click();assert.equal(await preview.isVisible(),false);
    await page.getByLabel('Özel sipariş fotoğrafı çek',{exact:true}).setInputFiles({name:'kamera.png',mimeType:'image/png',buffer});await page.getByText('Fotoğraf hazır.',{exact:true}).waitFor();
    await page.getByLabel('Ürün',{exact:true}).selectOption({label:'Katalog çikolata (adet)'});assert.equal(await page.locator('#custom-order-fields').isVisible(),false);
    await page.getByLabel('Ürün',{exact:true}).selectOption('');await page.getByLabel('Özel ürün adı',{exact:true}).fill('Özel çikolata');assert.equal(await page.locator('#custom-order-fields').isVisible(),true);
    assert.equal(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth+1),true);
   }
   await page.getByRole('button',{name:'Onaya gönder'}).click();await page.locator('dialog[open]').waitFor({state:'detached'});await page.getByRole('button',{name:'1 numaralı siparişi aç'}).click();
   if(installed){
    await page.locator('.custom-description').waitFor();assert.match(await page.locator('.custom-description').innerText(),/<script>alert\(1\)<\/script>/);assert.equal(await page.locator('dialog script').count(),0);
    await page.waitForFunction(()=>document.querySelector('.custom-photo-link img')?.naturalWidth>0);
    const image=await page.request.get('/api/orders/1/custom-photo');assert.equal(image.status(),200);assert.equal(image.headers()['content-type'],'image/jpeg');
    const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'Özel sipariş referans fotoğrafı Fotoğrafı büyüt'}).click();const popup=await popupPromise;await popup.waitForLoadState();assert.ok(popup.url().endsWith('/api/orders/1/custom-photo'));await popup.close();
   }
   assert.deepEqual(errors,[]);console.log(`PASS: special-order browser SQL=${installed}; create, explanation, gallery/camera inputs, image preview/removal, mobile and authenticated viewing`);
  }finally{await page.close();await new Promise(r=>server.close(r));await f.close();}
 }
}finally{await browser.close();}
