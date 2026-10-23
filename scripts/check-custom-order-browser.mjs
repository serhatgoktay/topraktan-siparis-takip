import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createApp} from '../supabase-server.js';
import {fixture} from '../test-support/supabase-fixture.js';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
try{
 for(const installed of [false,true]){
  const f=await fixture({pendingItemsMigration:true,customDetailsMigration:true,customItemDetailsMigration:installed});const {server}=createApp({fetchImpl:f.fetchImpl,serviceKey:'fixture-service-key'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await f.sql(null,"insert into public.products(name,measure,category) values('Katalog çikolata','adet','Çikolatalar')");
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByLabel('Kullanıcı adı',{exact:true}).fill('bahce');await page.getByLabel('Şifre',{exact:true}).fill('fixture-password-123');await page.getByRole('button',{name:'Giriş yap'}).click();await page.getByRole('heading',{name:'İş gününe bir bakış.'}).waitFor();
   await page.getByRole('button',{name:'+ Yeni sipariş',exact:true}).click();await page.getByRole('button',{name:'+ Kalem ekle',exact:true}).click();
   assert.equal(await page.locator('[data-custom-order-fields]').count(),installed?2:0);
   const buffers=[];
   for(let n=0;n<2;n++){
    const row=page.locator('#items .item-row').nth(n);await row.getByLabel('Kategori',{exact:true}).selectOption('Çikolatalar');await row.getByLabel('Özel ürün adı',{exact:true}).fill('Aynı adlı özel çikolata');
    if(installed){
     await row.getByLabel('Özel sipariş açıklaması',{exact:true}).fill(n?'Ayşe için pembe kutu':'Ali için mavi kutu. <script>alert(1)</script>');
     assert.equal(await row.getByLabel('Özel sipariş fotoğrafı çek',{exact:true}).getAttribute('capture'),'environment');
     const buffer=Buffer.from(await page.evaluate(n=>{const c=document.createElement('canvas');c.width=2400;c.height=1800;const ctx=c.getContext('2d');ctx.fillStyle=n?'#bb3377':'#2244aa';ctx.fillRect(0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];},n),'base64');buffers.push(buffer);
     await row.getByLabel(n?'Özel sipariş fotoğrafı çek':'Özel sipariş resmi seç',{exact:true}).setInputFiles({name:'foto.png',mimeType:'image/png',buffer});await row.getByText('Fotoğraf hazır.',{exact:true}).waitFor();
     await page.waitForFunction(n=>document.querySelectorAll('#items .item-row')[n].querySelector('.custom-photo-preview').naturalWidth>0,n);
     assert.ok((await row.locator('.custom-photo-preview').evaluate(i=>i.naturalWidth))<=1600);
    }
   }
   if(installed){
    const first=page.locator('#items .item-row').nth(0),second=page.locator('#items .item-row').nth(1);
    const secondImage=await second.locator('.custom-photo-preview').getAttribute('src');await first.getByRole('button',{name:'Fotoğrafı kaldır',exact:true}).click();assert.equal(await first.locator('.custom-photo-preview').isVisible(),false);assert.equal(await second.locator('.custom-photo-preview').getAttribute('src'),secondImage);
    await first.getByLabel('Özel sipariş fotoğrafı çek',{exact:true}).setInputFiles({name:'tekrar.png',mimeType:'image/png',buffer:buffers[0]});await first.getByText('Fotoğraf hazır.',{exact:true}).waitFor();
    await first.getByLabel('Ürün',{exact:true}).selectOption({label:'Katalog çikolata (adet)'});assert.equal(await first.locator('[data-custom-order-fields]').isVisible(),false);assert.equal(await second.locator('[data-custom-order-fields]').isVisible(),true);
    await first.getByLabel('Ürün',{exact:true}).selectOption('');await first.getByLabel('Özel ürün adı',{exact:true}).fill('Aynı adlı özel çikolata');
    assert.equal(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth+1),true);
   }
   await page.getByRole('button',{name:'Onaya gönder'}).click();await page.locator('dialog[open]').waitFor({state:'detached'});await page.getByRole('button',{name:'1 numaralı siparişi aç'}).click();
   if(installed){
    await page.locator('[data-item-custom] .custom-description').nth(1).waitFor();assert.match(await page.locator('[data-item-custom]').nth(0).innerText(),/Ali için/);assert.match(await page.locator('[data-item-custom]').nth(1).innerText(),/Ayşe için/);assert.equal(await page.locator('dialog script').count(),0);
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-item-custom] img')].length===2&&[...document.querySelectorAll('[data-item-custom] img')].every(i=>i.naturalWidth>0));
    const photos=await page.locator('[data-item-custom] img').evaluateAll(images=>images.map(i=>i.getAttribute('src')));assert.notEqual(photos[0],photos[1]);
    await page.getByRole('button',{name:'Siparişi düzenle',exact:true}).click();await page.locator('[data-item-custom] .custom-description').nth(1).waitFor();
    await page.getByRole('button',{name:'+ Ürün ekle',exact:true}).click();const added=page.locator('#pending-new-items .item-row');await added.getByLabel('Kategori',{exact:true}).selectOption('Çikolatalar');await added.getByLabel('Özel ürün adı',{exact:true}).fill('Üçüncü özel kalem');await added.getByLabel('Özel sipariş açıklaması',{exact:true}).fill('Üçüncü açıklama');
    await page.getByLabel('Düzenleme gerekçesi',{exact:true}).fill('Yeni özel kalem');await page.getByRole('button',{name:'Değişiklikleri kaydet'}).click();await page.locator('dialog[open]').waitFor({state:'detached'});await page.getByRole('button',{name:'1 numaralı siparişi aç'}).click();await page.locator('[data-item-custom] .custom-description').nth(2).waitFor();assert.match(await page.locator('[data-item-custom]').nth(2).innerText(),/Üçüncü açıklama/);
   }
   assert.deepEqual(errors,[]);console.log(`PASS: per-item browser SQL=${installed}; two independent special lines, photos, camera/gallery, removal isolation, mobile, viewing and edit additions`);
  }finally{await page.close();await new Promise(r=>server.close(r));await f.close();}
 }
}finally{await browser.close();}
