-- Mevcut Topraktan projesi için kategori ve pasta boyutu güncellemesi.
-- Ürün veya sipariş silmez; ürün eklemez. Tamamını tek sorgu olarak çalıştırın.
begin;

create or replace function app_private.valid_catalog_category(c text,s text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(
  (c is null and s is null)
  or (c in ('Çikolatalar','Tatlı kurabiyeler','Sütlü tatlılar','Şerbetli tatlılar','Tuzlu kurabiyeler') and s is null)
  or (c='Pastalar' and s is not null and s in (
   'Figürlü adet pastalar','Bebek ve çocuk pastaları','Kutlama pastaları',
   'Vitrin pastaları','Adet pastalar','Cheesecake'
  )),false);
$$;
create or replace function app_private.needs_cake_servings(c text,s text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(c='Pastalar' and s in (
  'Bebek ve çocuk pastaları','Kutlama pastaları','Vitrin pastaları','Cheesecake'
 ),false);
$$;
revoke all on function app_private.valid_catalog_category(text,text),app_private.needs_cake_servings(text,text) from public,anon;
grant execute on function app_private.valid_catalog_category(text,text),app_private.needs_cake_servings(text,text) to authenticated;

alter table public.products add column if not exists category text;
alter table public.products add column if not exists subcategory text;
alter table public.order_items add column if not exists category text;
alter table public.order_items add column if not exists subcategory text;
alter table public.order_items add column if not exists servings integer;

do $$ begin
 if not exists(select 1 from pg_constraint where conname='products_catalog_category_check' and conrelid='public.products'::regclass) then
  alter table public.products add constraint products_catalog_category_check
   check(app_private.valid_catalog_category(category,subcategory));
 end if;
 if not exists(select 1 from pg_constraint where conname='items_catalog_category_check' and conrelid='public.order_items'::regclass) then
  alter table public.order_items add constraint items_catalog_category_check
   check(app_private.valid_catalog_category(category,subcategory));
 end if;
 if not exists(select 1 from pg_constraint where conname='items_cake_servings_check' and conrelid='public.order_items'::regclass) then
  alter table public.order_items add constraint items_cake_servings_check check(
   (app_private.needs_cake_servings(category,subcategory) and servings is not null and servings between 1 and 10000)
   or (not app_private.needs_cake_servings(category,subcategory) and servings is null)
  );
 end if;
end $$;

create or replace function public.save_product_v2(
 p_name text,p_measure text,p_category text,p_subcategory text,
 p_id bigint default null,p_active boolean default true
)
returns bigint language plpgsql security definer set search_path='' as $$
declare actor public.profiles; result_id bigint;
begin
 select * into actor from public.profiles where id=auth.uid() and active for share;
 if actor.id is null or actor.role not in ('admin','manager') then
  raise exception 'Ürün düzenleme yetkiniz yok' using errcode='42501';
 end if;
 if p_category is null or not app_private.valid_catalog_category(p_category,p_subcategory) then
  raise exception 'Geçerli kategori ve pasta alt kategorisi seçin';
 end if;
 if p_active is null then raise exception 'Ürün durumu gerekli'; end if;
 if p_id is null then
  insert into public.products(name,measure,category,subcategory,active)
   values(btrim(p_name),p_measure,p_category,p_subcategory,p_active) returning id into result_id;
 else
  update public.products set name=btrim(p_name),measure=p_measure,category=p_category,
   subcategory=p_subcategory,active=p_active where id=p_id returning id into result_id;
  if result_id is null then raise exception 'Ürün bulunamadı'; end if;
 end if;
 return result_id;
end;
$$;

create or replace function public.create_order_v2(
 p_unit_id smallint,p_delivery date,p_items jsonb,p_note text default ''
)
returns bigint language plpgsql security definer set search_path='' as $$
declare
 actor public.profiles; target_unit smallint; new_order_id bigint; item jsonb;
 product public.products; item_name text; item_measure text; item_quantity numeric;
 item_product_id bigint; item_category text; item_subcategory text; item_servings numeric;
begin
 select * into actor from public.profiles where id=auth.uid() and active for share;
 if actor.id is null then raise exception 'Aktif kullanıcı gerekli' using errcode='42501'; end if;
 target_unit:=case when actor.role in ('admin','manager') then p_unit_id else actor.unit_id end;
 if not exists(select 1 from public.units where id=target_unit and kind='branch') then
  raise exception 'Sipariş için şube gerekli';
 end if;
 if p_delivery is null or p_delivery < (now() at time zone 'Europe/Istanbul')::date then
  raise exception 'Teslim tarihi bugün veya ileri bir gün olmalı';
 end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Sipariş kalemleri gerekli'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Siparişte 1–100 kalem olmalı'; end if;
 if char_length(coalesce(p_note,''))>2000 then raise exception 'Not en fazla 2000 karakter olmalı'; end if;
 insert into public.orders(unit_id,created_by,creator_name,delivery,note)
  values(target_unit,actor.id,actor.name,p_delivery,coalesce(p_note,'')) returning id into new_order_id;
 for item in select value from jsonb_array_elements(p_items) loop
  item_product_id:=null;
  if nullif(item->>'product_id','') is not null then
   select * into product from public.products where id=(item->>'product_id')::bigint and active for share;
   if not found then raise exception 'Ürün artık kullanılamıyor'; end if;
   item_product_id:=product.id; item_name:=product.name; item_measure:=product.measure;
   item_category:=product.category; item_subcategory:=product.subcategory;
  else
   item_name:=btrim(item->>'name'); item_measure:=item->>'measure';
   item_category:=nullif(item->>'category',''); item_subcategory:=nullif(item->>'subcategory','');
   if item_category is null then raise exception 'Özel sipariş için kategori seçin'; end if;
  end if;
  if not app_private.valid_catalog_category(item_category,item_subcategory) then
   raise exception 'Geçerli kategori ve pasta alt kategorisi seçin';
  end if;
  item_quantity:=(item->>'quantity')::numeric;
  if item_quantity is null or item_quantity<=0 or item_quantity>1000000
   or round(item_quantity,3)<>item_quantity or (item_measure<>'kg' and trunc(item_quantity)<>item_quantity) then
   raise exception 'Geçersiz miktar: adet ve tepsi tam sayı, kilogram en fazla 3 ondalık olmalı';
  end if;
  item_servings:=nullif(item->>'servings','')::numeric;
  if app_private.needs_cake_servings(item_category,item_subcategory) then
   if item_servings is null or item_servings<1 or item_servings>10000 or trunc(item_servings)<>item_servings then
    raise exception 'Pasta için 4, 6, 8 veya Diğer ile pozitif tam sayı kişi sayısı seçin';
   end if;
  elsif item_servings is not null then
   raise exception 'Bu kategori için kişi sayısı seçilemez';
  end if;
  insert into public.order_items(order_id,product_id,name,measure,quantity,category,subcategory,servings)
   values(new_order_id,item_product_id,item_name,item_measure,item_quantity,item_category,item_subcategory,item_servings::integer);
 end loop;
 insert into public.order_events(order_id,user_id,actor_name,status,note)
  values(new_order_id,actor.id,actor.name,'pending','Sipariş oluşturuldu');
 return new_order_id;
end;
$$;

-- Eski uç noktalar üzerinden kişi sayısı doğrulamasının atlanmasını engeller.
revoke all on function public.save_product(text,text,bigint,boolean),public.create_order(smallint,date,jsonb,text) from public,anon,authenticated;
revoke all on function public.save_product_v2(text,text,text,text,bigint,boolean),public.create_order_v2(smallint,date,jsonb,text) from public,anon;
grant execute on function public.save_product_v2(text,text,text,text,bigint,boolean),public.create_order_v2(smallint,date,jsonb,text) to authenticated;

notify pgrst,'reload schema';
commit;
