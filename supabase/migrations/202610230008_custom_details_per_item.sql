-- Her ozel siparis kalemine ayri aciklama ve fotograf.
-- Onceki 007 guncellemesinden sonra dosyanin tamamini calistirin.
begin;
create table if not exists public.order_item_custom_details (
 id bigint generated always as identity primary key,
 order_id bigint not null references public.orders(id) on delete restrict,
 item_id bigint unique references public.order_items(id) on delete set null,
 item_name text not null,
 description text not null default '' check (char_length(description)<=2000),
 photo text check (photo is null or (char_length(photo)<=600000 and photo like 'data:image/jpeg;base64,%')),
 legacy_source boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists item_custom_details_order_idx on public.order_item_custom_details(order_id);
alter table public.order_item_custom_details enable row level security;
revoke all on public.order_item_custom_details from public,anon,authenticated;
grant select on public.order_item_custom_details to authenticated;
drop policy if exists item_custom_details_read on public.order_item_custom_details;
create policy item_custom_details_read on public.order_item_custom_details for select to authenticated
 using (exists(select 1 from public.orders o where o.id=order_id));
-- Tek ozel kalem varsa eski genel bilgi o kaleme baglanir. Belirsiz coklu
-- siparislerde bilgi rastgele bir urune atanmaz; eski kayit korunur.
insert into public.order_item_custom_details(order_id,item_id,item_name,description,photo,legacy_source)
 select d.order_id,i.id,i.name,d.description,d.photo,true
 from public.order_custom_details d join public.order_items i on i.order_id=d.order_id and i.product_id is null
 where (select count(*) from public.order_items x where x.order_id=d.order_id and x.product_id is null)=1
 and not exists(select 1 from public.order_item_custom_details saved where saved.order_id=d.order_id and saved.legacy_source)
 on conflict(item_id) do nothing;
create or replace function app_private.save_new_item_details(p_order_id bigint,p_item_id bigint,p_details jsonb)
returns void language plpgsql security invoker set search_path='' as 'declare target public.order_items; description_value text; photo_value text; bytes bytea;
begin
 if p_details is null or p_details=''null''::jsonb then return; end if;
 if jsonb_typeof(p_details)<>''object'' or (p_details ? ''description'' and jsonb_typeof(p_details->''description'')<>''string'') or (p_details ? ''photo'' and jsonb_typeof(p_details->''photo'') not in (''string'',''null'')) then raise exception ''Kalem açıklamasını ve fotoğrafını kontrol edin''; end if;
 select * into target from public.order_items where id=p_item_id and order_id=p_order_id;
 if target.id is null or target.product_id is not null then raise exception ''Açıklama ve fotoğraf yalnız özel sipariş kalemine eklenebilir''; end if;
 description_value:=btrim(coalesce(p_details->>''description'',''''));photo_value:=p_details->>''photo'';
 if char_length(description_value)>2000 then raise exception ''Kalem açıklaması en fazla 2000 karakter olmalı''; end if;
 if photo_value is not null then
  if char_length(photo_value)>600000 or photo_value !~ ''^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'' then raise exception ''Geçerli bir fotoğraf seçin (en fazla 450 KB)''; end if;
  bytes:=decode(substring(photo_value from 24),''base64'');
  if octet_length(bytes)>450000 or octet_length(bytes)<4 or encode(substring(bytes from 1 for 3),''hex'')<>''ffd8ff'' or encode(substring(bytes from octet_length(bytes)-1 for 2),''hex'')<>''ffd9'' then raise exception ''Geçerli bir JPEG fotoğrafı gerekli''; end if;
 end if;
 if description_value<>'''' or photo_value is not null then
  insert into public.order_item_custom_details(order_id,item_id,item_name,description,photo) values(p_order_id,target.id,target.name,description_value,photo_value);
 end if;
 if (select coalesce(sum(char_length(photo)),0) from public.order_item_custom_details where order_id=p_order_id and item_id is not null)>2400000 then raise exception ''Fotoğrafların toplam boyutu çok büyük. Daha küçük resimler seçin''; end if;
end;';
revoke all on function app_private.save_new_item_details(bigint,bigint,jsonb) from public,anon,authenticated;
create or replace function public.create_order_with_item_details(p_unit_id smallint,p_delivery date,p_items jsonb,p_note text)
returns bigint language plpgsql security definer set search_path='' as 'declare result_id bigint; row_id bigint; position integer:=0;
begin
 result_id:=public.create_order_v2(p_unit_id,p_delivery,p_items,p_note);
 for row_id in select id from public.order_items where order_id=result_id order by id loop
  perform app_private.save_new_item_details(result_id,row_id,p_items->position->''custom_details'');
  position:=position+1;
 end loop;
 return result_id;
end;';
create or replace function public.edit_pending_order_with_item_details(p_order_id bigint,p_expected jsonb,p_delivery date,p_note text,p_items jsonb,p_reason text)
returns void language plpgsql security definer set search_path='' as 'declare old_ids bigint[]; new_ids bigint[]; new_position integer:=1; entry jsonb;
begin
 perform 1 from public.orders where id=p_order_id for update;
 select coalesce(array_agg(id),''{}'') into old_ids from public.order_items where order_id=p_order_id;
 -- Yetki, sube, onay durumu ve eszamanli degisiklik kontrolleri aynen korunur.
 perform public.edit_pending_order_v2(p_order_id,p_expected,p_delivery,p_note,p_items,p_reason);
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
create or replace function public.custom_order_item_details_ready()
returns boolean language sql security invoker set search_path='' as 'select exists(select 1 from public.profiles where id=auth.uid() and active) and to_regclass(''public.order_item_custom_details'') is not null and to_regprocedure(''public.create_order_with_item_details(smallint,date,jsonb,text)'') is not null;';
create or replace function public.get_order_item_details(p_order_id bigint)
returns jsonb language sql security invoker set search_path='' as 'select jsonb_build_object(
 ''items'',coalesce((select jsonb_agg(jsonb_build_object(''id'',id,''item_id'',item_id,''name'',item_name,''description'',description,''hasPhoto'',photo is not null) order by id) from public.order_item_custom_details where order_id=p_order_id),''[]''::jsonb),
 ''legacy'',(select jsonb_build_object(''description'',description,''hasPhoto'',photo is not null) from public.order_custom_details d where d.order_id=p_order_id and not exists(select 1 from public.order_item_custom_details mapped where mapped.order_id=p_order_id and mapped.legacy_source))
 );';
create or replace function public.get_order_item_photo(p_order_id bigint,p_detail_id bigint)
returns text language sql security invoker set search_path='' as 'select photo from public.order_item_custom_details where order_id=p_order_id and id=p_detail_id;';
revoke all on function public.create_order_with_item_details(smallint,date,jsonb,text) from public,anon;
grant execute on function public.create_order_with_item_details(smallint,date,jsonb,text) to authenticated;
revoke all on function public.edit_pending_order_with_item_details(bigint,jsonb,date,text,jsonb,text) from public,anon;
grant execute on function public.edit_pending_order_with_item_details(bigint,jsonb,date,text,jsonb,text) to authenticated;
revoke all on function public.custom_order_item_details_ready() from public,anon;
grant execute on function public.custom_order_item_details_ready() to authenticated;
revoke all on function public.get_order_item_details(bigint) from public,anon;
grant execute on function public.get_order_item_details(bigint) to authenticated;
revoke all on function public.get_order_item_photo(bigint,bigint) from public,anon;
grant execute on function public.get_order_item_photo(bigint,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
select case when to_regclass('public.order_item_custom_details') is not null and to_regprocedure('public.create_order_with_item_details(smallint,date,jsonb,text)') is not null and to_regprocedure('public.edit_pending_order_with_item_details(bigint,jsonb,date,text,jsonb,text)') is not null and to_regprocedure('public.get_order_item_details(bigint)') is not null and to_regprocedure('public.get_order_item_photo(bigint,bigint)') is not null then 'KALEM_GORSELLERI_HAZIR' else 'KURULUM_EKSIK' end as sonuc;
