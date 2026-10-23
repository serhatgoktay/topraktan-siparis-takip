import {needsServings} from './catalog.js';
import {readItemDetails,validatePhotoTotal,showOrderItemDetails} from './custom-order.js';
import {calendarDate} from './dates.js';
export function pendingSnapshot(order,includeServings=false){
 return {delivery:calendarDate(order.delivery),note:order.note||'',items:order.items.map(i=>({id:Number(i.id),quantity:Number(i.quantity),...(includeServings?{servings:i.servings??null}:{})})).sort((a,b)=>a.id-b.id)};
}
export function showPendingEdit(order,{modal,esc,num,date,api,load,toast,allowItems=false,allowItemDetails=false,allowServings=false,itemRow,bindItem}){
 const d=modal(`Sipariş #${order.id} · Düzenle`,`<form id="pending-edit-form"><p class="muted">${esc(order.unit)} · Onay bekliyor</p><label>Teslim tarihi<input type="date" name="delivery" value="${calendarDate(order.delivery)}" required></label><div class="table-wrap"><table><thead><tr><th>ÜRÜN</th><th>MİKTAR</th><th>BİRİM</th>${allowItems?'<th></th>':''}</tr></thead><tbody>${order.items.map(i=>`<tr class="pending-existing-row" data-existing="${i.id}"><td><strong>${esc(i.name)}</strong>${i.servings?`<small>${i.servings} kişilik</small>`:''}${allowServings&&needsServings(i.category,i.subcategory)?`<div class="pending-size"><label>Pasta boyutu<select data-size="${i.id}" aria-label="${esc(i.name)} pasta boyutu"><option value="">Kişi sayısı seçin</option>${[4,6,8].map(n=>`<option value="${n}" ${i.servings===n?'selected':''}>${n} kişilik</option>`).join('')}<option value="other" ${i.servings&&![4,6,8].includes(i.servings)?'selected':''}>Diğer</option></select></label><label data-size-other-label ${!i.servings||[4,6,8].includes(i.servings)?'hidden':''}>Diğer kişi sayısı<input data-size-other="${i.id}" aria-label="${esc(i.name)} diğer kişi sayısı" type="number" min="1" max="10000" step="1" value="${i.servings||''}"></label></div>`:''}${allowItemDetails?`<div data-item-custom="${i.id}"></div>`:''}</td><td><input class="edit-quantity" type="number" data-item="${i.id}" aria-label="${esc(i.name)} miktarı${i.servings?' '+i.servings+' kişilik':''}" min="${i.measure==='kg'?'0.001':'1'}" step="${i.measure==='kg'?'0.001':'1'}" max="1000000" value="${i.quantity}" required></td><td>${esc(i.measure)}</td>${allowItems?`<td><button type="button" class="text-btn" data-remove-existing="${i.id}" aria-label="${esc(i.name)} ürününü çıkar">Çıkar</button></td>`:''}</tr>`).join('')}</tbody></table></div>${allowItemDetails?'<section data-custom-order-details></section>':''}${allowItems?'<div id="pending-new-items"></div><button class="secondary" type="button" id="pending-add-item">+ Ürün ekle</button><p class="muted small">Çıkarılan ürünler işlem geçmişinde korunur. Siparişte en az bir ürün kalmalıdır.</p>':''}<label>Sipariş notu<textarea name="note" maxlength="2000">${esc(order.note||'')}</textarea></label><label>Düzenleme gerekçesi<textarea name="reason" required maxlength="500" placeholder="Değişiklik nedenini yazın"></textarea></label><p class="muted small">Değişiklikler işlem geçmişine kaydedilir. Sipariş onaylanırsa düzenleme kaydedilemez.</p><p class="form-error" role="alert"></p><div class="modal-actions"><button class="primary" type="submit">Değişiklikleri kaydet</button></div></form>`,true);
 d.querySelectorAll('[data-size]').forEach(select=>{
  const sync=()=>{const row=select.closest('tr'),removed=row.dataset.removed==='true',other=row.querySelector('[data-size-other]');select.disabled=removed;select.required=!removed;other.disabled=removed||select.value!=='other';other.required=!other.disabled;other.closest('label').hidden=select.value!=='other';};select.onchange=sync;sync();
 });
 if(allowItemDetails)showOrderItemDetails(d,order.id,{api,esc});
 if(allowItems){
  d.querySelectorAll('[data-remove-existing]').forEach(button=>button.onclick=()=>{
   const row=button.closest('tr'),removed=row.dataset.removed!=='true';row.dataset.removed=String(removed);row.classList.toggle('pending-removed',removed);row.querySelector('[data-item]').disabled=removed;row.querySelector('[data-size]')?.onchange();
   button.textContent=removed?'Geri al':'Çıkar';button.setAttribute('aria-label',removed?'Ürünü geri al':order.items.find(i=>i.id===Number(button.dataset.removeExisting)).name+' ürününü çıkar');
  });
  d.querySelector('#pending-add-item').onclick=()=>{
   const count=d.querySelectorAll('.pending-existing-row:not([data-removed="true"])').length+d.querySelectorAll('#pending-new-items .item-row').length;
   if(count>=100){d.querySelector('.form-error').textContent='En fazla 100 kalem eklenebilir.';return;}
   const container=d.querySelector('#pending-new-items');container.insertAdjacentHTML('beforeend',itemRow());const row=container.lastElementChild;bindItem(row,d);row.querySelector('.remove-item').onclick=()=>row.remove();
  };
 }
 d.querySelector('form').onsubmit=async e=>{
  e.preventDefault();const button=d.querySelector('button[type=submit]');button.disabled=true;
  try{
   const form=new FormData(e.target);
   const existing=[...d.querySelectorAll('[data-item]')].filter(el=>!el.disabled).map(el=>({id:Number(el.dataset.item),quantity:Number(el.value)}));
   if(allowServings)for(const item of existing){const row=d.querySelector(`[data-existing="${item.id}"]`),choice=row.querySelector('[data-size]');item.servings=choice?(choice.value==='other'?Number(row.querySelector('[data-size-other]').value):Number(choice.value)):order.items.find(i=>i.id===item.id).servings??null;}
   const payload={expected:pendingSnapshot(order,allowServings),...(allowServings?{edit_servings:true}:{}),delivery:form.get('delivery'),note:form.get('note'),reason:form.get('reason')};
   if(allowItems){
    const added=[...d.querySelectorAll('#pending-new-items .item-row')].map(row=>{
     const get=n=>row.querySelector(`[name="${n}"]`),choice=get('servings-choice');
     return {product_id:get('product').value||null,name:get('custom').value,quantity:Number(get('quantity').value),measure:get('measure').value,category:get('category').value||null,subcategory:get('subcategory').disabled?null:get('subcategory').value||null,servings:choice.disabled?null:choice.value==='other'?Number(get('servings-other').value):Number(choice.value),custom_details:readItemDetails(row)};
    });
    payload.items=[...existing,...added];validatePhotoTotal(payload.items);if(!payload.items.length)throw Error('Siparişte en az bir ürün kalmalı. Yeni ürün ekleyin veya çıkarılan ürünü geri alın.');
   }else payload.quantities=existing;
   await api(`orders/${order.id}/edit-pending`,payload);
   d.close();await load();toast('Sipariş güncellendi');
  }catch(err){d.querySelector('.form-error').textContent=err.message;}finally{button.disabled=false;}
 };
}
