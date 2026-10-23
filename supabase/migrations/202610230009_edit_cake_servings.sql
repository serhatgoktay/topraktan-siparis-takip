-- Onay bekleyen sipariste pasta boyutu duzenleme. Tamamini calistirin.
-- Mevcut tablo, rol, eski islev ve fotograf baglantilari korunur.
begin;
create or replace function public.edit_pending_order_servings(
 p_order_id bigint,p_expected jsonb,p_delivery date,p_note text,p_items jsonb,p_reason text
)
returns void language plpgsql security definer set search_path='' as 'declare
 actor public.profiles; target public.orders; snapshot jsonb; after_snapshot jsonb;
 item jsonb; old_item public.order_items; product public.products;
 amount numeric; size numeric; kept bigint[]:=''{}''; item_id bigint; product_id bigint;
 nm text; ms text; cat text; sub text; previous_items text; next_items text;
 changes text; chunks integer; part integer;
begin
 select * into actor from public.profiles where id=auth.uid() and active for share;
 select * into target from public.orders where id=p_order_id for update;
 if actor.id is null or target.id is null or not(actor.role=''admin'' or (actor.role=''operator'' and actor.unit_id<>4 and actor.unit_id=target.unit_id)) then
  raise exception ''Sipariş düzenleme yetkiniz yok'' using errcode=''42501'';
 end if;
 if target.status<>''pending'' then raise exception ''Sipariş artık onay beklemiyor. Listeyi yenileyin.'' using errcode=''PT409''; end if;
 select jsonb_build_object(''delivery'',target.delivery,''note'',target.note,''items'',coalesce(jsonb_agg(jsonb_build_object(''id'',id,''quantity'',quantity,''servings'',servings) order by id),''[]''::jsonb)) into snapshot from public.order_items where order_id=target.id;
 if p_expected is distinct from snapshot then raise exception ''Sipariş değişmiş. Listeyi yenileyip tekrar deneyin.'' using errcode=''PT409''; end if;
 if p_delivery is null or (p_delivery<>target.delivery and p_delivery<(now() at time zone ''Europe/Istanbul'')::date) then raise exception ''Yeni teslim tarihi bugün veya ileri bir gün olmalı''; end if;
 if p_note is null or char_length(p_note)>2000 then raise exception ''Not en fazla 2000 karakter olmalı''; end if;
 if btrim(coalesce(p_reason,''''))='''' or char_length(p_reason)>500 then raise exception ''Düzenleme gerekçesi gerekli (en fazla 500 karakter)''; end if;
 if p_items is null or jsonb_typeof(p_items)<>''array'' or jsonb_array_length(p_items) not between 1 and 100 then raise exception ''Siparişte en az 1, en fazla 100 kalem olmalı''; end if;
 select string_agg(name||'' [''||coalesce(category,''Kategorisiz'')||coalesce('' / ''||subcategory,'''')||'']''||case when servings is null then '''' else '' (''||servings||'' kişilik)'' end||'': ''||quantity||'' ''||measure,chr(10) order by id) into previous_items from public.order_items where order_id=target.id;
 for item in select value from jsonb_array_elements(p_items) loop
  item_id:=nullif(item->>''id'','''')::bigint;
  amount:=(item->>''quantity'')::numeric;
  if item_id is not null then
   select * into old_item from public.order_items where id=item_id and order_id=target.id;
   if old_item.id is null or item_id=any(kept) then raise exception ''Geçersiz veya tekrarlanan sipariş kalemi''; end if;
   ms:=old_item.measure;cat:=old_item.category;sub:=old_item.subcategory;size:=old_item.servings;
   if item ? ''servings'' then size:=nullif(item->>''servings'','''')::numeric; end if;
   if app_private.needs_cake_servings(cat,sub) then
    if size is null or size not between 1 and 10000 or trunc(size)<>size then raise exception ''Pasta için geçerli kişi sayısı gerekli''; end if;
   elsif size is not null then raise exception ''Bu kategori için kişi sayısı seçilemez''; end if;
  else
   product_id:=nullif(item->>''product_id'','''')::bigint;
   if product_id is not null then
    select * into product from public.products where id=product_id and active for share;
    if product.id is null then raise exception ''Ürün artık kullanılamıyor''; end if;
    nm:=product.name;ms:=product.measure;cat:=product.category;sub:=product.subcategory;
   else
    nm:=btrim(item->>''name'');ms:=item->>''measure'';cat:=nullif(item->>''category'','''');sub:=nullif(item->>''subcategory'','''');
    if cat is null then raise exception ''Özel sipariş için kategori seçin''; end if;
   end if;
   if not app_private.valid_catalog_category(cat,sub) then raise exception ''Geçerli kategori ve pasta alt kategorisi seçin''; end if;
   size:=nullif(item->>''servings'','''')::numeric;
   if app_private.needs_cake_servings(cat,sub) then
    if size is null or size not between 1 and 10000 or trunc(size)<>size then raise exception ''Pasta için geçerli kişi sayısı gerekli''; end if;
   elsif size is not null then raise exception ''Bu kategori için kişi sayısı seçilemez''; end if;
  end if;
  if amount is null or amount<=0 or amount>1000000 or round(amount,3)<>amount or (ms<>''kg'' and trunc(amount)<>amount) then raise exception ''Geçersiz miktar: adet/tepsi tam sayı, kilogram en fazla 3 ondalık olmalı''; end if;
  if item_id is null then
   insert into public.order_items(order_id,product_id,name,measure,quantity,category,subcategory,servings) values(target.id,product_id,nm,ms,amount,cat,sub,size::integer) returning id into item_id;
  else
   update public.order_items set quantity=amount,servings=size::integer where id=item_id;
  end if;
  kept:=array_append(kept,item_id);
 end loop;
 -- Yalnızca onay bekleyen bu siparişin çıkarılan kalemleri kaldırılır.
 -- Eski ürün bilgileri silinmeyen işlem geçmişine aşağıda tam olarak yazılır.
 delete from public.order_items where order_id=target.id and not(id=any(kept));
 select jsonb_build_object(''delivery'',p_delivery,''note'',p_note,''items'',coalesce(jsonb_agg(jsonb_build_object(''id'',id,''quantity'',quantity,''servings'',servings) order by id),''[]''::jsonb)) into after_snapshot from public.order_items where order_id=target.id;
 if snapshot=after_snapshot then raise exception ''Değişiklik yapılmadı''; end if;
 select string_agg(name||'' [''||coalesce(category,''Kategorisiz'')||coalesce('' / ''||subcategory,'''')||'']''||case when servings is null then '''' else '' (''||servings||'' kişilik)'' end||'': ''||quantity||'' ''||measure,chr(10) order by id) into next_items from public.order_items where order_id=target.id;
 changes:=''Sipariş ürünleri düzenlendi. Gerekçe: ''||btrim(p_reason)||chr(10)||''ÖNCEKİ ÜRÜNLER:''||chr(10)||previous_items||chr(10)||''YENİ ÜRÜNLER:''||chr(10)||next_items||chr(10);
 if p_delivery<>target.delivery then changes:=changes||''Teslim tarihi: ''||target.delivery||'' → ''||p_delivery||chr(10); end if;
 if p_note<>target.note then changes:=changes||''Önceki not: ''||target.note||chr(10)||''Yeni not: ''||p_note||chr(10); end if;
 update public.orders set delivery=p_delivery,note=p_note where id=target.id;
 chunks:=ceil(char_length(changes)/1900.0)::integer;
 for part in 1..chunks loop
  insert into public.order_events(order_id,user_id,actor_name,status,note) values(target.id,actor.id,actor.name,''pending'',''Ürün düzenleme kaydı (''||part||''/''||chunks||'')''||chr(10)||substring(changes from (part-1)*1900+1 for 1900));
 end loop;
end;';
create or replace function public.edit_pending_order_servings_with_details(p_order_id bigint,p_expected jsonb,p_delivery date,p_note text,p_items jsonb,p_reason text)
returns void language plpgsql security definer set search_path='' as 'declare old_ids bigint[]; new_ids bigint[]; new_position integer:=1; entry jsonb;
begin
 perform 1 from public.orders where id=p_order_id for update;
 select coalesce(array_agg(id),''{}'') into old_ids from public.order_items where order_id=p_order_id;
 -- Yetki, sube, onay durumu ve eszamanli degisiklik kontrolleri aynen korunur.
 perform public.edit_pending_order_servings(p_order_id,p_expected,p_delivery,p_note,p_items,p_reason);
 select coalesce(array_agg(id order by id),''{}'') into new_ids from public.order_items where order_id=p_order_id and not(id=any(old_ids));
 for entry in select value from jsonb_array_elements(p_items) loop
  if nullif(entry->>''id'','''') is null then
   perform app_private.save_new_item_details(p_order_id,new_ids[new_position],entry->''custom_details'');
   new_position:=new_position+1;
  elsif entry ? ''custom_details'' and entry->''custom_details''<>''null''::jsonb then
   raise exception ''Mevcut kalem ayrıntıları korunur; yeni özel kaleme açıklama ve fotoğraf ekleyebilirsiniz'';
  end if;
 end loop;
end;';
revoke all on function public.edit_pending_order_servings(bigint,jsonb,date,text,jsonb,text) from public,anon;
grant execute on function public.edit_pending_order_servings(bigint,jsonb,date,text,jsonb,text) to authenticated;
revoke all on function public.edit_pending_order_servings_with_details(bigint,jsonb,date,text,jsonb,text) from public,anon;
grant execute on function public.edit_pending_order_servings_with_details(bigint,jsonb,date,text,jsonb,text) to authenticated;
create or replace function public.pending_order_servings_ready()
returns boolean language sql stable security definer set search_path='' as 'select exists(select 1 from public.profiles where id=auth.uid() and active) and to_regprocedure(''public.edit_pending_order_servings(bigint,jsonb,date,text,jsonb,text)'') is not null and to_regprocedure(''public.edit_pending_order_servings_with_details(bigint,jsonb,date,text,jsonb,text)'') is not null;';
revoke all on function public.pending_order_servings_ready() from public,anon;
grant execute on function public.pending_order_servings_ready() to authenticated;
notify pgrst,'reload schema';
commit;
select case when to_regprocedure('public.edit_pending_order_servings(bigint,jsonb,date,text,jsonb,text)') is not null and to_regprocedure('public.edit_pending_order_servings_with_details(bigint,jsonb,date,text,jsonb,text)') is not null and to_regprocedure('public.pending_order_servings_ready()') is not null then 'PASTA_BOYUTU_DUZENLEME_HAZIR' else 'KURULUM_EKSIK' end as sonuc;
