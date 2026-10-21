-- Topraktan: yeni Supabase projesi için ilk kurulum.
-- Supabase SQL Editor'da postgres rolüyle bir kez çalıştırın.
-- Bu dosya kullanıcı, şifre veya örnek sipariş oluşturmaz.
begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

create table public.units (
 id smallint primary key,
 name text not null unique,
 kind text not null check (kind in ('branch','production'))
);
insert into public.units values
 (1,'Bahçe','branch'),(2,'Küçükpark','branch'),(3,'Evka3','branch'),(4,'İmalat','production');

create table public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 name text not null check (char_length(btrim(name)) between 1 and 120),
 role text not null default 'operator' check (role in ('admin','manager','operator')),
 unit_id smallint references public.units(id),
 active boolean not null default false,
 created_at timestamptz not null default now(),
 check ((role in ('admin','manager') and unit_id is null)
     or (role='operator' and (not active or unit_id is not null)))
);

create table public.products (
 id bigint generated always as identity primary key,
 name text not null check (char_length(btrim(name)) between 1 and 120),
 measure text not null check (measure in ('adet','kg','tepsi')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);

create table public.orders (
 id bigint generated always as identity primary key,
 unit_id smallint not null references public.units(id),
 created_by uuid not null references public.profiles(id),
 creator_name text not null,
 delivery date not null,
 note text not null default '' check (char_length(note)<=2000),
 status text not null default 'pending' check (status in ('pending','approved','rejected','preparing','ready','delivered')),
 created_at timestamptz not null default now()
);
create index orders_unit_delivery_idx on public.orders(unit_id,delivery);
create index orders_status_delivery_idx on public.orders(status,delivery);

create table public.order_items (
 id bigint generated always as identity primary key,
 order_id bigint not null references public.orders(id) on delete restrict,
 product_id bigint references public.products(id) on delete restrict,
 name text not null check (char_length(btrim(name)) between 1 and 120),
 measure text not null check (measure in ('adet','kg','tepsi')),
 quantity numeric(12,3) not null check (quantity>0 and quantity<=1000000),
 check (measure='kg' or quantity=trunc(quantity))
);
create index order_items_order_idx on public.order_items(order_id);

create table public.order_events (
 id bigint generated always as identity primary key,
 order_id bigint not null references public.orders(id) on delete restrict,
 user_id uuid not null references public.profiles(id),
 actor_name text not null,
 status text not null check (status in ('pending','approved','rejected','preparing','ready','delivered')),
 note text not null default '' check (char_length(note)<=2000),
 created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events(order_id,id);

-- Profil veya kullanıcı metadata'sı üzerinden rol yükseltilemez.
create function app_private.on_auth_user_created()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,name,role,unit_id,active)
 values(new.id,left(coalesce(nullif(btrim(new.raw_user_meta_data->>'name'),''),nullif(split_part(new.email,'@',1),''),'Yeni kullanıcı'),120),'operator',null,false);
 return new;
end;
$$;
revoke all on function app_private.on_auth_user_created() from public,anon,authenticated;
create trigger topraktan_auth_user_created after insert on auth.users
 for each row execute function app_private.on_auth_user_created();
-- Kurulumdan önce açılmış Auth kullanıcıları varsa pasif profil oluşturur.
insert into public.profiles(id,name)
 select id,left(coalesce(nullif(split_part(email,'@',1),''),'Yeni kullanıcı'),120) from auth.users;

create function app_private.is_active()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active);
$$;
create function app_private.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role='admin');
$$;
create function app_private.is_manager()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role in ('admin','manager'));
$$;
create function app_private.can_read_order(p_unit_id smallint,p_status text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and
  (p.role in ('admin','manager') or p.unit_id=p_unit_id or
   (p.unit_id=4 and p_status in ('approved','preparing','ready','delivered'))));
$$;
revoke all on function app_private.is_active(),app_private.is_admin(),app_private.is_manager(),app_private.can_read_order(smallint,text) from public,anon;
grant execute on function app_private.is_active(),app_private.is_admin(),app_private.is_manager(),app_private.can_read_order(smallint,text) to authenticated;

alter table public.units enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;

create policy units_read on public.units for select to authenticated using(app_private.is_active());
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or app_private.is_admin());
create policy products_read on public.products for select to authenticated using(app_private.is_active());
create policy orders_read on public.orders for select to authenticated using(app_private.can_read_order(unit_id,status));
create policy items_read on public.order_items for select to authenticated using(
 exists(select 1 from public.orders o where o.id=order_id));
create policy events_read on public.order_events for select to authenticated using(
 exists(select 1 from public.orders o where o.id=order_id));

-- Doğrudan INSERT/UPDATE/DELETE kapalıdır. Yazma işlemleri aşağıdaki atomik
-- fonksiyonlardan geçer; böylece onay, geçmiş ve kalemler atlanamaz.
revoke all on public.units,public.profiles,public.products,public.orders,public.order_items,public.order_events from public,anon,authenticated;
grant select on public.units,public.profiles,public.products,public.orders,public.order_items,public.order_events to authenticated;
revoke all on sequence public.products_id_seq,public.orders_id_seq,public.order_items_id_seq,public.order_events_id_seq from public,anon,authenticated;

create function public.save_product(p_name text,p_measure text,p_id bigint default null,p_active boolean default true)
returns bigint language plpgsql security definer set search_path='' as $$
declare actor public.profiles; result_id bigint;
begin
 select * into actor from public.profiles where id=auth.uid() and active for share;
 if actor.id is null or actor.role not in ('admin','manager') then raise exception 'Ürün düzenleme yetkiniz yok' using errcode='42501'; end if;
 if p_active is null then raise exception 'Ürün durumu gerekli'; end if;
 if p_id is null then
  insert into public.products(name,measure,active) values(btrim(p_name),p_measure,p_active) returning id into result_id;
 else
  update public.products set name=btrim(p_name),measure=p_measure,active=p_active where id=p_id returning id into result_id;
  if result_id is null then raise exception 'Ürün bulunamadı'; end if;
 end if;
 return result_id;
end;
$$;

create function public.admin_set_profile(p_user_id uuid,p_name text,p_role text,p_unit_id smallint,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.profiles;
begin
 select * into actor from public.profiles where id=auth.uid() and active for update;
 if actor.id is null or actor.role<>'admin' then raise exception 'Kullanıcı yönetimi yetkiniz yok' using errcode='42501'; end if;
 if p_user_id=actor.id and (p_active is distinct from true or p_role is distinct from 'admin') then
  raise exception 'Kendi yönetici yetkinizi kaldıramazsınız';
 end if;
 update public.profiles set name=btrim(p_name),role=p_role,
  unit_id=case when p_role='operator' then p_unit_id else null end,active=p_active where id=p_user_id;
 if not found then raise exception 'Kullanıcı bulunamadı'; end if;
end;
$$;

create function public.create_order(p_unit_id smallint,p_delivery date,p_items jsonb,p_note text default '')
returns bigint language plpgsql security definer set search_path='' as $$
declare
 actor public.profiles; target_unit smallint; order_id bigint; item jsonb;
 product public.products; item_name text; item_measure text; item_quantity numeric; item_product_id bigint;
begin
 select * into actor from public.profiles where id=auth.uid() and active for share;
 if actor.id is null then raise exception 'Aktif kullanıcı gerekli' using errcode='42501'; end if;
 target_unit:=case when actor.role in ('admin','manager') then p_unit_id else actor.unit_id end;
 if not exists(select 1 from public.units where id=target_unit and kind='branch') then raise exception 'Sipariş için şube gerekli'; end if;
 if p_delivery is null or p_delivery < (now() at time zone 'Europe/Istanbul')::date then raise exception 'Teslim tarihi bugün veya ileri bir gün olmalı'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Sipariş kalemleri gerekli'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Siparişte 1–100 kalem olmalı'; end if;
 if char_length(coalesce(p_note,''))>2000 then raise exception 'Not en fazla 2000 karakter olmalı'; end if;
 insert into public.orders(unit_id,created_by,creator_name,delivery,note)
 values(target_unit,actor.id,actor.name,p_delivery,coalesce(p_note,'')) returning id into order_id;
 for item in select value from jsonb_array_elements(p_items) loop
  item_product_id:=null;
  if nullif(item->>'product_id','') is not null then
   select * into product from public.products where id=(item->>'product_id')::bigint and active for share;
   if not found then raise exception 'Ürün artık kullanılamıyor'; end if;
   item_product_id:=product.id; item_name:=product.name; item_measure:=product.measure;
  else
   item_name:=btrim(item->>'name'); item_measure:=item->>'measure';
  end if;
  item_quantity:=(item->>'quantity')::numeric;
  if item_quantity is null or item_quantity<=0 or item_quantity>1000000
   or round(item_quantity,3)<>item_quantity or (item_measure<>'kg' and trunc(item_quantity)<>item_quantity) then
   raise exception 'Geçersiz miktar: adet ve tepsi tam sayı, kilogram en fazla 3 ondalık olmalı';
  end if;
  insert into public.order_items(order_id,product_id,name,measure,quantity)
   values(order_id,item_product_id,item_name,item_measure,item_quantity);
 end loop;
 insert into public.order_events(order_id,user_id,actor_name,status,note)
  values(order_id,actor.id,actor.name,'pending','Sipariş oluşturuldu');
 return order_id;
end;
$$;

create function public.change_order_status(p_order_id bigint,p_status text,p_note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare actor public.profiles; target public.orders;
begin
 select * into actor from public.profiles where id=auth.uid() and active for share;
 if actor.id is null then raise exception 'Aktif kullanıcı gerekli' using errcode='42501'; end if;
 select * into target from public.orders where id=p_order_id for update;
 if target.id is null or not app_private.can_read_order(target.unit_id,target.status) then raise exception 'Sipariş bulunamadı' using errcode='42501'; end if;
 if target.status='pending' then
  if actor.role not in ('admin','manager') then raise exception 'Onay yetkiniz yok' using errcode='42501'; end if;
  if p_status is null or p_status not in ('approved','rejected') then raise exception 'Geçersiz durum geçişi'; end if;
 elsif (target.status='approved' and p_status='preparing')
    or (target.status='preparing' and p_status='ready')
    or (target.status='ready' and p_status='delivered') then
  if actor.role not in ('admin','manager') and actor.unit_id is distinct from 4 then raise exception 'Üretim yetkiniz yok' using errcode='42501'; end if;
 else
  raise exception 'Geçersiz durum geçişi';
 end if;
 if p_status='rejected' and btrim(coalesce(p_note,''))='' then raise exception 'Ret gerekçesi gerekli'; end if;
 if char_length(coalesce(p_note,''))>2000 then raise exception 'Not en fazla 2000 karakter olmalı'; end if;
 update public.orders set status=p_status where id=target.id;
 insert into public.order_events(order_id,user_id,actor_name,status,note)
 values(target.id,actor.id,actor.name,p_status,coalesce(p_note,''));
end;
$$;

revoke all on function public.save_product(text,text,bigint,boolean),
 public.admin_set_profile(uuid,text,text,smallint,boolean),
 public.create_order(smallint,date,jsonb,text),
 public.change_order_status(bigint,text,text) from public,anon;
grant execute on function public.save_product(text,text,bigint,boolean),
 public.admin_set_profile(uuid,text,text,smallint,boolean),
 public.create_order(smallint,date,jsonb,text),
 public.change_order_status(bigint,text,text) to authenticated;

commit;
