import {calendarDate} from './dates.js';
export function pendingSnapshot(order){
 return {delivery:calendarDate(order.delivery),note:order.note||'',items:order.items.map(i=>({id:Number(i.id),quantity:Number(i.quantity)})).sort((a,b)=>a.id-b.id)};
}
export function showPendingEdit(order,{modal,esc,num,date,api,load,toast}){
 const d=modal(`Sipariş #${order.id} · Düzenle`,`<form id="pending-edit-form"><p class="muted">${esc(order.unit)} · Onay bekliyor</p><label>Teslim tarihi<input type="date" name="delivery" value="${calendarDate(order.delivery)}" required></label><div class="table-wrap"><table><thead><tr><th>ÜRÜN</th><th>MİKTAR</th><th>BİRİM</th></tr></thead><tbody>${order.items.map(i=>`<tr><td><strong>${esc(i.name)}</strong>${i.servings?`<small>${i.servings} kişilik</small>`:''}</td><td><input class="edit-quantity" type="number" data-item="${i.id}" aria-label="${esc(i.name)} miktarı${i.servings?' '+i.servings+' kişilik':''}" min="${i.measure==='kg'?'0.001':'1'}" step="${i.measure==='kg'?'0.001':'1'}" max="1000000" value="${i.quantity}" required></td><td>${esc(i.measure)}</td></tr>`).join('')}</tbody></table></div><label>Sipariş notu<textarea name="note" maxlength="2000">${esc(order.note||'')}</textarea></label><label>Düzenleme gerekçesi<textarea name="reason" required maxlength="500" placeholder="Değişiklik nedenini yazın"></textarea></label><p class="muted small">Değişiklikler işlem geçmişine kaydedilir. Sipariş onaylanırsa düzenleme kaydedilemez.</p><p class="form-error" role="alert"></p><div class="modal-actions"><button class="primary" type="submit">Değişiklikleri kaydet</button></div></form>`,true);
 d.querySelector('form').onsubmit=async e=>{
  e.preventDefault();const button=d.querySelector('button[type=submit]');button.disabled=true;
  try{
   const form=new FormData(e.target);
   await api(`orders/${order.id}/edit-pending`,{expected:pendingSnapshot(order),delivery:form.get('delivery'),note:form.get('note'),reason:form.get('reason'),quantities:[...d.querySelectorAll('[data-item]')].map(el=>({id:Number(el.dataset.item),quantity:Number(el.value)}))});
   d.close();await load();toast('Sipariş güncellendi');
  }catch(err){d.querySelector('.form-error').textContent=err.message;}finally{button.disabled=false;}
 };
}
