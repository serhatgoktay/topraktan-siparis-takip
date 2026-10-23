-- Ozel siparis aciklamasi ve tek referans fotografi.
-- Dosyanin tamamini SQL Editor > New query ile calistirin.
-- Mevcut siparis, rol, RLS ve duzenleme islevleri degismez.
begin;
create table if not exists public.order_custom_details (
 order_id bigint primary key references public.orders(id) on delete restrict,
 description text not null default '' check (char_length(description)<=2000),
 photo text,
 created_at timestamptz not null default now(),
 check (photo is null or (char_length(photo)<=600000 and photo like 'data:image/jpeg;base64,%'))
);
alter table public.order_custom_details enable row level security;
revoke all on public.order_custom_details from public,anon,authenticated;
grant select on public.order_custom_details to authenticated;
drop policy if exists custom_details_read on public.order_custom_details;
create policy custom_details_read on public.order_custom_details for select to authenticated
 using (exists(select 1 from public.orders o where o.id=order_id));
create or replace function public.custom_order_details_ready()
returns boolean language sql security invoker set search_path='' as 'select exists(select 1 from public.profiles where id=auth.uid() and active) and to_regclass(''public.order_custom_details'') is not null and to_regprocedure(''public.create_order_with_details(smallint,date,jsonb,text,text,text)'') is not null;';
create or replace function public.create_order_with_details(p_unit_id smallint,p_delivery date,p_items jsonb,p_note text,p_description text,p_photo text)
returns bigint language plpgsql security definer set search_path='' as 'declare result_id bigint; bytes bytea;
begin
 if p_description is null or char_length(p_description)>2000 then raise exception ''Açıklama en fazla 2000 karakter olmalı''; end if;
 if btrim(p_description)<>'''' or p_photo is not null then
  if not exists(select 1 from jsonb_array_elements(p_items) i where nullif(i->>''product_id'','''') is null) then raise exception ''Açıklama ve fotoğraf için özel sipariş kalemi gerekli''; end if;
 end if;
 if p_photo is not null then
  if char_length(p_photo)>600000 or p_photo !~ ''^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'' then raise exception ''Geçerli bir fotoğraf seçin (en fazla 450 KB)''; end if;
  bytes:=decode(substring(p_photo from 24),''base64'');
  if octet_length(bytes)>450000 or octet_length(bytes)<4 or encode(substring(bytes from 1 for 3),''hex'')<>''ffd8ff'' or encode(substring(bytes from octet_length(bytes)-1 for 2),''hex'')<>''ffd9'' then raise exception ''Geçerli bir JPEG fotoğrafı gerekli''; end if;
 end if;
 -- Eski sipariş oluşturma işlevinin bütün yetki ve ürün kontrolleri korunur.
 result_id:=public.create_order_v2(p_unit_id,p_delivery,p_items,p_note);
 if btrim(p_description)<>'''' or p_photo is not null then
  insert into public.order_custom_details(order_id,description,photo) values(result_id,btrim(p_description),p_photo);
 end if;
 return result_id;
end;';
create or replace function public.get_custom_order_details(p_order_id bigint)
returns jsonb language sql security invoker set search_path='' as 'select jsonb_build_object(''description'',description,''photo'',photo) from public.order_custom_details where order_id=p_order_id;';
revoke all on function public.custom_order_details_ready() from public,anon;
grant execute on function public.custom_order_details_ready() to authenticated;
revoke all on function public.create_order_with_details(smallint,date,jsonb,text,text,text) from public,anon;
grant execute on function public.create_order_with_details(smallint,date,jsonb,text,text,text) to authenticated;
revoke all on function public.get_custom_order_details(bigint) from public,anon;
grant execute on function public.get_custom_order_details(bigint) to authenticated;
notify pgrst,'reload schema';
commit;
select case when to_regclass('public.order_custom_details') is not null and to_regprocedure('public.create_order_with_details(smallint,date,jsonb,text,text,text)') is not null and to_regprocedure('public.get_custom_order_details(bigint)') is not null then 'OZEL_SIPARIS_GORSEL_HAZIR' else 'KURULUM_EKSIK' end as sonuc;
