// Each special product line owns an independent description and photo.
const itemDetails=new WeakMap();
export function customOrderFields(){
 return `<section data-custom-order-fields class="custom-order-fields" hidden><div class="section-label">BU KALEMİN AÇIKLAMASI VE REFERANS FOTOĞRAFI</div><label>Özel sipariş açıklaması<textarea name="custom-description" maxlength="2000" placeholder="Örneğin: Pastanın üzerine yazılacak yazı, renk, figür ve hazırlama ayrıntıları…"></textarea></label><div class="photo-actions"><label class="secondary photo-picker">Resim seç<input type="file" accept="image/*" data-photo-input aria-label="Özel sipariş resmi seç"></label><label class="secondary photo-picker">Kamerayla çek<input type="file" accept="image/*" capture="environment" data-photo-input aria-label="Özel sipariş fotoğrafı çek"></label><button type="button" class="text-btn" data-photo-remove hidden>Fotoğrafı kaldır</button></div><p class="photo-status muted small" aria-live="polite"></p><img class="custom-photo-preview" alt="Özel sipariş fotoğraf önizlemesi" hidden><p class="photo-error" role="alert"></p><small class="muted">Bu kaleme bir referans fotoğrafı ekleyebilirsiniz. Fotoğraf kaydetmeden önce küçültülür.</small></section>`;
}
export async function preparePhoto(file){
 if(!file || !file.type.startsWith('image/'))throw Error('Bir resim dosyası seçin.');
 if(file.size>20*1024*1024)throw Error('Resim en fazla 20 MB olabilir.');
 const url=URL.createObjectURL(file),image=new Image();
 try{
  image.src=url;await image.decode();
  let scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');
  for(let pass=0;pass<5;pass++){
   canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [.85,.7,.55,.4]){const photo=canvas.toDataURL('image/jpeg',quality);if(photo.length<=600000)return photo;}
   scale*=.7;
  }
  throw Error('Resim küçültülemedi. Daha küçük bir fotoğraf seçin.');
 }catch(e){if(e.name==='EncodingError')throw Error('Bu resim açılamadı. JPG, PNG veya WebP olarak seçin.');throw e;}finally{URL.revokeObjectURL(url);}
}
export function bindCustomOrderFields(row){
 const section=row.querySelector('[data-custom-order-fields]');if(!section)return;let photo=null,working=false,version=0;
 const preview=section.querySelector('img'),status=section.querySelector('.photo-status'),remove=section.querySelector('[data-photo-remove]'),error=section.querySelector('.photo-error');
 function sync(){section.hidden=Boolean(row.querySelector('[name=product]').value);}
 row.addEventListener('change',sync);sync();
 for(const input of section.querySelectorAll('[data-photo-input]'))input.onchange=async()=>{
  const file=input.files[0];if(!file)return;const request=++version;working=true;status.textContent='Fotoğraf hazırlanıyor…';error.textContent='';
  try{const value=await preparePhoto(file);if(request!==version)return;photo=value;preview.src=photo;preview.hidden=false;remove.hidden=false;status.textContent='Fotoğraf hazır.';}
  catch(e){if(request===version){error.textContent=e.message;status.textContent=photo?'Önceki fotoğraf korunuyor.':'';}}
  finally{input.value='';if(request===version)working=false;}
 };
 remove.onclick=()=>{version++;working=false;photo=null;preview.removeAttribute('src');preview.hidden=true;remove.hidden=true;status.textContent='';error.textContent='';};
 const read=()=>{
  if(section.hidden)return null;
  if(working)throw Error('Fotoğrafın hazırlanmasını bekleyin.');
  const description=section.querySelector('textarea').value.trim();return description||photo?{description,photo}:null;
 };
 itemDetails.set(row,read);
}
export function readItemDetails(row){return itemDetails.get(row)?.()||null;}
export function validatePhotoTotal(items){if(items.reduce((sum,item)=>sum+(item.custom_details?.photo?.length||0),0)>2400000)throw Error('Fotoğrafların toplam boyutu çok büyük. Daha küçük resimler seçin.');}
export async function showCustomOrderDetails(dialog,orderId,{api,esc}){
 const box=dialog.querySelector('[data-custom-order-details]');
 try{const details=await api(`orders/${orderId}/custom-details`);if(!box.isConnected)return;
  if(!details){box.remove();return;}
  box.innerHTML=`<div class="section-label">ÖZEL SİPARİŞ AÇIKLAMASI VE REFERANS FOTOĞRAFI</div>${details.description?`<p class="custom-description">${esc(details.description)}</p>`:''}${details.hasPhoto?'<a class="custom-photo-link" target="_blank" rel="noopener"><img class="custom-photo-preview" alt="Özel sipariş referans fotoğrafı"><span>Fotoğrafı büyüt ↗</span></a>':''}`;
  // Authenticated same-origin endpoint allows opening/zooming without a public link.
  const image=box.querySelector('img'),link=box.querySelector('a');if(image){image.src=`/api/orders/${orderId}/custom-photo`;link.href=image.src;}
 }catch{box.textContent='Özel sipariş ayrıntıları yüklenemedi. Siparişi yeniden açın.';}
}

export function itemDetailsMarkup(details,{esc,photoUrl}){
 return `${details.description?`<p class="custom-description">${esc(details.description)}</p>`:''}${details.hasPhoto?`<a class="custom-photo-link" href="${photoUrl}" target="_blank" rel="noopener"><img class="custom-photo-preview" src="${photoUrl}" alt="${esc(details.name||'Özel sipariş')} referans fotoğrafı"><span>Fotoğrafı büyüt ↗</span></a>`:''}`;
}
export async function showOrderItemDetails(dialog,orderId,{api,esc}){
 const extra=dialog.querySelector('[data-custom-order-details]');
 try{
  const details=await api(`orders/${orderId}/item-details`);if(!dialog.isConnected)return;
  for(const entry of details.items){
   const box=dialog.querySelector(`[data-item-custom="${entry.item_id}"]`);
   const content=itemDetailsMarkup(entry,{esc,photoUrl:`/api/orders/${orderId}/custom-item-photo/${entry.id}`});
   if(box)box.innerHTML=content;
   else if(entry.item_id===null)extra.insertAdjacentHTML('beforeend',`<div class="custom-order-fields"><strong>Çıkarılan özel kalem: ${esc(entry.name)}</strong>${content}</div>`);
  }
  if(details.legacy)extra.insertAdjacentHTML('beforeend',`<div class="custom-order-fields"><strong>Önceden sipariş geneline eklenen bilgi</strong><p class="muted small">Bu bilgi önceki ekranda sipariş geneline kaydedildi; belirli bir kaleme bağlanmadı.</p>${itemDetailsMarkup(details.legacy,{esc,photoUrl:`/api/orders/${orderId}/custom-photo`})}</div>`);
  if(!extra.children.length)extra.remove();
 }catch{extra.textContent='Kalem açıklamaları ve fotoğrafları yüklenemedi. Siparişi yeniden açın.';}
}
