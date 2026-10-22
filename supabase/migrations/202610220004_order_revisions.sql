-- TASLAK: yalnızca ayrı test projesinde doğrulayıp yayın planıyla uygulayın.
-- Canlı Supabase üzerinde bu geliştirme sırasında çalıştırılmamıştır.
begin;
alter table public.orders add column if not exists revision integer not null default 1;
alter table public.orders add column if not exists approved_at timestamptz;
alter table public.orders add column if not exists production_hold boolean not null default false;
update public.orders o set approved_at=coalesce((select min(created_at) from public.order_events e where e.order_id=o.id and e.status='approved'),o.created_at)
 where approved_at is null and status in ('approved','preparing','ready','delivered');
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check(status in ('pending','approved','rejected','preparing','ready','delivered','cancelled'));
alter table public.order_events drop constraint if exists order_events_status_check;
alter table public.order_events add constraint order_events_status_check check(status in ('pending','approved','rejected','preparing','ready','delivered','cancelled'));
alter table public.order_items add column if not exists cancelled_quantity numeric(12,3) not null default 0 check(cancelled_quantity>=0 and cancelled_quantity<=quantity and (measure='kg' or cancelled_quantity=trunc(cancelled_quantity)));
alter table public.order_items add column if not exists description text not null default '' check(char_length(description)<=2000);
alter table public.order_events add column if not exists kind text not null default 'status' check(kind in ('status','created','edited','cancelled','image','production_note','production_issue','reviewed'));
alter table public.order_events add column if not exists before_data jsonb;
alter table public.order_events add column if not exists after_data jsonb;
alter table public.order_events add column if not exists revision integer;
create unique index if not exists order_event_revision_unique on public.order_events(order_id,revision) where revision is not null;
create table if not exists public.order_images(
 id bigint generated always as identity primary key,
 order_id bigint not null references public.orders(id),
 item_id bigint not null references public.order_items(id),
 mime text not null check(mime in ('image/png','image/jpeg','image/webp')),
 content bytea not null check(octet_length(content) between 12 and 1048576),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 removed_at timestamptz
);
create index if not exists order_images_order_idx on public.order_images(order_id);
create unique index if not exists order_images_current_idx on public.order_images(item_id) where removed_at is null;
create table if not exists public.production_notifications(
 id bigint generated always as identity primary key,
 order_id bigint not null references public.orders(id),
 event_id bigint not null unique references public.order_events(id),
 created_at timestamptz not null default now(),
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 check((reviewed_by is null)=(reviewed_at is null))
);
create table if not exists public.notification_reads(
 notification_id bigint not null references public.production_notifications(id),
 user_id uuid not null references public.profiles(id),
 read_at timestamptz not null default now(),
 primary key(notification_id,user_id)
);
create or replace function app_private.can_read_order_id(p_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o,public.profiles p where o.id=p_id and p.id=auth.uid() and p.active and
 (p.role='admin' or (p.role='operator' and p.unit_id=o.unit_id) or
 ((p.role='manager' or (p.role='operator' and p.unit_id=4)) and o.approved_at is not null)));
$$;
-- Önceki geniş manager erişimini son karara göre onaylanmış üretimle sınırlar.
create or replace function app_private.can_read_order(p_unit_id smallint,p_status text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and
 (p.role='admin' or (p.role='operator' and p.unit_id=p_unit_id) or
 ((p.role='manager' or p.unit_id=4) and p_status in ('approved','preparing','ready','delivered','cancelled'))));
$$;
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated using(app_private.can_read_order_id(id));
alter table public.order_images enable row level security;
alter table public.production_notifications enable row level security;
alter table public.notification_reads enable row level security;
drop policy if exists images_read on public.order_images;
create policy images_read on public.order_images for select to authenticated using(app_private.can_read_order_id(order_id));
drop policy if exists notifications_read on public.production_notifications;
create policy notifications_read on public.production_notifications for select to authenticated using(
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role='manager') and app_private.can_read_order_id(order_id));
drop policy if exists reads_read on public.notification_reads;
create policy reads_read on public.notification_reads for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.production_notifications n where n.id=notification_id));
revoke all on public.order_images,public.production_notifications,public.notification_reads from public,anon,authenticated;
grant select(id,order_id,item_id,mime,created_at,removed_at) on public.order_images to authenticated;
revoke all on sequence public.order_images_id_seq,public.production_notifications_id_seq from public,anon,authenticated;
grant select on public.production_notifications,public.notification_reads to authenticated;

create or replace function app_private.order_snapshot(p_id bigint)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('delivery',o.delivery,'note',o.note,'status',o.status,'revision',o.revision,
 'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id=o.id),'[]'::jsonb),
 'images',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'item_id',m.item_id,'mime',m.mime) order by m.id) from public.order_images m where m.order_id=o.id and m.removed_at is null),'[]'::jsonb)) from public.orders o where o.id=p_id;
$$;
create or replace function app_private.record_order_change(p_id bigint,p_kind text,p_reason text,p_before jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.profiles; o public.orders; eid bigint;
begin
 select * into actor from public.profiles where id=auth.uid();
 update public.orders set revision=revision+1 where id=p_id returning * into o;
 insert into public.order_events(order_id,user_id,actor_name,status,note,kind,before_data,after_data,revision)
 values(p_id,actor.id,actor.name,o.status,p_reason,p_kind,p_before,app_private.order_snapshot(p_id),o.revision) returning id into eid;
 if o.approved_at is not null then
  insert into public.production_notifications(order_id,event_id) values(p_id,eid);
  update public.orders set production_hold=true where id=p_id;
 end if;
end;
$$;
create or replace function app_private.lock_editable_order(p_id bigint,p_revision integer)
returns public.orders language plpgsql security definer set search_path='' as $$
declare actor public.profiles; o public.orders;
begin
 select * into actor from public.profiles where id=auth.uid() and active for share;
 select * into o from public.orders where id=p_id for update;
 if actor.id is null or o.id is null or not app_private.can_read_order_id(p_id) then raise exception 'Sipariş bulunamadı' using errcode='42501'; end if;
 if not(actor.role='admin' or (actor.role='operator' and actor.unit_id<>4 and actor.unit_id=o.unit_id and o.status='pending')) then raise exception 'Sipariş düzenleme yetkiniz yok' using errcode='42501'; end if;
 if o.status in ('rejected','cancelled') then raise exception 'Kapatılmış sipariş değiştirilemez'; end if;
 if p_revision is distinct from o.revision then raise exception 'Sipariş değişmiş. Yenileyip tekrar deneyin' using errcode='40001'; end if;
 return o;
end;
$$;
create or replace function app_private.write_order_item(p_order_id bigint,p_item jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare existing public.order_items; product public.products; item_id bigint; pid bigint; nm text; ms text; cat text; sub text; qty numeric; sz numeric; cancelled numeric:=0;
begin
 if nullif(p_item->>'id','') is not null then
  select * into existing from public.order_items where id=(p_item->>'id')::bigint and order_id=p_order_id;
  if existing.id is null then raise exception 'Sipariş kalemi bulunamadı'; end if;
  cancelled:=existing.cancelled_quantity;
 end if;
 pid:=nullif(p_item->>'product_id','')::bigint;
 if pid is not null then
  if existing.id is not null and existing.product_id=pid then
   nm:=existing.name;ms:=existing.measure;cat:=existing.category;sub:=existing.subcategory;
  else
   select * into product from public.products where id=pid and active for share;
   if product.id is null then raise exception 'Ürün artık kullanılamıyor'; end if;
   nm:=product.name;ms:=product.measure;cat:=product.category;sub:=product.subcategory;
  end if;
 else
  nm:=btrim(p_item->>'name');ms:=p_item->>'measure';cat:=nullif(p_item->>'category','');sub:=nullif(p_item->>'subcategory','');
  if cat is null and existing.id is null then raise exception 'Özel sipariş için kategori seçin'; end if;
 end if;
 qty:=(p_item->>'quantity')::numeric;sz:=nullif(p_item->>'servings','')::numeric;
 if qty is null or qty<=0 or qty>1000000 or round(qty,3)<>qty or (ms<>'kg' and trunc(qty)<>qty) or qty<cancelled then raise exception 'Geçersiz miktar veya iptal miktarından az toplam'; end if;
 if app_private.needs_cake_servings(cat,sub) then
  if sz is null or sz not between 1 and 10000 or trunc(sz)<>sz then raise exception 'Geçerli kişi sayısı gerekli'; end if;
 elsif sz is not null then raise exception 'Bu kategori için kişi sayısı seçilemez'; end if;
 if existing.id is null then
  insert into public.order_items(order_id,product_id,name,measure,category,subcategory,quantity,servings,description)
  values(p_order_id,pid,nm,ms,cat,sub,qty,sz::integer,coalesce(p_item->>'description','')) returning id into item_id;
 else
  if existing.cancelled_quantity>0 and (pid is distinct from existing.product_id or nm is distinct from existing.name or ms is distinct from existing.measure or cat is distinct from existing.category or sub is distinct from existing.subcategory or sz is distinct from existing.servings) then raise exception 'İptal geçmişi olan kalemin ürünü değiştirilemez; yeni kalem ekleyin'; end if;
  if pid is not null and exists(select 1 from public.order_images m where m.item_id=existing.id and m.removed_at is null) then raise exception 'Önce özel sipariş görselini kaldırın'; end if;
  update public.order_items set product_id=pid,name=nm,measure=ms,category=cat,subcategory=sub,quantity=qty,servings=sz::integer,description=coalesce(p_item->>'description','') where id=existing.id;
  item_id:=existing.id;
 end if;
 return item_id;
end;
$$;
create or replace function public.create_order_v3(p_unit_id smallint,p_delivery date,p_items jsonb,p_note text default '')
returns bigint language plpgsql security definer set search_path='' as $$
declare actor public.profiles; target_unit smallint; oid bigint; item jsonb;
begin
 select * into actor from public.profiles where id=auth.uid() and active for share;
 if actor.id is null or actor.role='manager' or (actor.role='operator' and actor.unit_id=4) then raise exception 'Sipariş oluşturma yetkiniz yok' using errcode='42501'; end if;
 target_unit:=case when actor.role='admin' then p_unit_id else actor.unit_id end;
 if not exists(select 1 from public.units where id=target_unit and kind='branch') then raise exception 'Şube gerekli'; end if;
 if p_delivery is null or p_delivery<(now() at time zone 'Europe/Istanbul')::date then raise exception 'Teslim tarihi bugün veya ileri bir gün olmalı'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception '1–100 kalem gerekli'; end if;
 insert into public.orders(unit_id,created_by,creator_name,delivery,note) values(target_unit,actor.id,actor.name,p_delivery,coalesce(p_note,'')) returning id into oid;
 for item in select value from jsonb_array_elements(p_items) loop
  if item ? 'id' then raise exception 'Yeni siparişte kalem kimliği kullanılamaz'; end if;
  perform app_private.write_order_item(oid,item);
 end loop;
 insert into public.order_events(order_id,user_id,actor_name,status,note,kind,after_data,revision)
 values(oid,actor.id,actor.name,'pending','Sipariş oluşturuldu','created',app_private.order_snapshot(oid),1);
 return oid;
end;
$$;
-- Eski RPC de yeni rol denetiminden geçer; doğrudan Supabase ile atlanamaz.
create or replace function public.create_order_v2(p_unit_id smallint,p_delivery date,p_items jsonb,p_note text default '')
returns bigint language sql security definer set search_path='' as $$select public.create_order_v3(p_unit_id,p_delivery,p_items,p_note)$$;
create or replace function public.edit_order(p_order_id bigint,p_revision integer,p_delivery date,p_note text,p_items jsonb,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; before_json jsonb; item jsonb; ids bigint[]:='{}'; iid bigint;
begin
 o:=app_private.lock_editable_order(p_order_id,p_revision);before_json:=app_private.order_snapshot(o.id);
 if btrim(coalesce(p_reason,''))='' or char_length(p_reason)>2000 then raise exception 'Değişiklik gerekçesi gerekli (en fazla 2000 karakter)'; end if;
 if p_delivery is null then raise exception 'Teslim tarihi gerekli'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception '1–100 kalem gerekli'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  iid:=app_private.write_order_item(o.id,item);
  if iid=any(ids) then raise exception 'Aynı kalem tekrar gönderilemez'; end if;
  ids:=array_append(ids,iid);
 end loop;
 -- Kaldırılan kalem silinmez, kalan miktarı iptal edilerek geçmişi korunur.
 update public.order_items set cancelled_quantity=quantity where order_id=o.id and not(id=any(ids));
 if not exists(select 1 from public.order_items where order_id=o.id and quantity>cancelled_quantity) then raise exception 'Tam iptal için Siparişi iptal et işlemini kullanın'; end if;
 update public.orders set delivery=p_delivery,note=coalesce(p_note,'') where id=o.id;
 if before_json=app_private.order_snapshot(o.id) then raise exception 'Değişiklik yapılmadı'; end if;
 perform app_private.record_order_change(o.id,'edited',p_reason,before_json);
end;
$$;
create or replace function public.cancel_order_items(p_order_id bigint,p_revision integer,p_items jsonb,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; before_json jsonb; item jsonb; current_item public.order_items; amount numeric; seen bigint[]:='{}';
begin
 o:=app_private.lock_editable_order(p_order_id,p_revision);before_json:=app_private.order_snapshot(o.id);
 if btrim(coalesce(p_reason,''))='' or char_length(p_reason)>2000 then raise exception 'İptal gerekçesi gerekli (en fazla 2000 karakter)'; end if;
 if p_items is null then
  update public.order_items set cancelled_quantity=quantity where order_id=o.id;
 else
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'İptal edilecek kalemleri seçin'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
   select * into current_item from public.order_items where id=(item->>'id')::bigint and order_id=o.id;
   if current_item.id is null or current_item.id=any(seen) then raise exception 'Geçersiz veya tekrarlanan kalem'; end if;
   seen:=array_append(seen,current_item.id);amount:=(item->>'quantity')::numeric;
   if amount is null or amount<=0 or round(amount,3)<>amount or (current_item.measure<>'kg' and trunc(amount)<>amount) or amount>current_item.quantity-current_item.cancelled_quantity then raise exception 'İptal miktarı kalanı aşamaz; birime uygun pozitif miktar girin'; end if;
   update public.order_items set cancelled_quantity=cancelled_quantity+amount where id=current_item.id;
  end loop;
 end if;
 if not exists(select 1 from public.order_items where order_id=o.id and quantity>cancelled_quantity) then update public.orders set status='cancelled' where id=o.id; end if;
 perform app_private.record_order_change(o.id,'cancelled',p_reason,before_json);
end;
$$;
create or replace function public.change_order_status(p_order_id bigint,p_status text,p_note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare actor public.profiles; o public.orders;
begin
 select * into actor from public.profiles where id=auth.uid() and active for share;
 select * into o from public.orders where id=p_order_id for update;
 if actor.id is null or o.id is null or not app_private.can_read_order_id(o.id) then raise exception 'Sipariş bulunamadı' using errcode='42501'; end if;
 if o.status='pending' then
  if actor.role<>'admin' then raise exception 'Onay yetkiniz yok' using errcode='42501'; end if;
  if p_status is null or p_status not in ('approved','rejected') then raise exception 'Geçersiz durum geçişi'; end if;
 elsif (o.status='approved' and p_status='preparing') or (o.status='preparing' and p_status='ready') or (o.status='ready' and p_status='delivered') then
  if actor.role not in ('admin','manager') and actor.unit_id is distinct from 4 then raise exception 'Üretim yetkiniz yok' using errcode='42501'; end if;
  if exists(select 1 from public.production_notifications where order_id=o.id and reviewed_at is null) then raise exception 'İmalat kontrolü gerekli: önce değişiklikler incelenmeli'; end if;
 else raise exception 'Geçersiz durum geçişi'; end if;
 if p_status='rejected' and btrim(coalesce(p_note,''))='' then raise exception 'Ret gerekçesi gerekli'; end if;
 if char_length(coalesce(p_note,''))>2000 then raise exception 'Not en fazla 2000 karakter olmalı'; end if;
 update public.orders set status=p_status,approved_at=case when p_status='approved' then now() else approved_at end,revision=revision+1 where id=o.id;
 insert into public.order_events(order_id,user_id,actor_name,status,note,revision) values(o.id,actor.id,actor.name,p_status,coalesce(p_note,''),o.revision+1);
end;
$$;
create or replace function public.production_message(p_order_id bigint,p_note text,p_issue boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.profiles; o public.orders;
begin
 select * into actor from public.profiles where id=auth.uid() and active for share;
 select * into o from public.orders where id=p_order_id for update;
 if actor.id is null or (actor.role not in ('admin','manager') and actor.unit_id is distinct from 4) or not app_private.can_read_order_id(p_order_id) or o.approved_at is null then raise exception 'İmalat notu yetkiniz yok' using errcode='42501'; end if;
 if btrim(coalesce(p_note,''))='' or char_length(p_note)>2000 then raise exception 'Not 1–2000 karakter olmalı'; end if;
 insert into public.order_events(order_id,user_id,actor_name,status,note,kind) values(o.id,actor.id,actor.name,o.status,p_note,case when p_issue then 'production_issue' else 'production_note' end);
end;
$$;
create or replace function public.read_production_notification(p_id bigint,p_review boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.profiles; n public.production_notifications; o public.orders;
begin
 select * into actor from public.profiles where id=auth.uid() and active for share;
 if actor.id is null or actor.role<>'manager' then raise exception 'Bildirim yetkiniz yok' using errcode='42501'; end if;
 -- Durum geçişi/düzenleme ile aynı kilit sırası.
 select o1.* into o from public.orders o1 join public.production_notifications n1 on n1.order_id=o1.id where n1.id=p_id for update of o1;
 select * into n from public.production_notifications where id=p_id for update;
 if n.id is null or not app_private.can_read_order_id(n.order_id) then raise exception 'Bildirim bulunamadı' using errcode='42501'; end if;
 insert into public.notification_reads(notification_id,user_id) values(p_id,actor.id) on conflict do nothing;
 if p_review and n.reviewed_at is null then
  update public.production_notifications set reviewed_by=actor.id,reviewed_at=now() where id=p_id;
  update public.orders set production_hold=exists(select 1 from public.production_notifications where order_id=o.id and reviewed_at is null) where id=o.id;
  insert into public.order_events(order_id,user_id,actor_name,status,note,kind) values(o.id,actor.id,actor.name,o.status,'Değişiklik incelendi · Bildirim #'||p_id,'reviewed');
 end if;
end;
$$;
create or replace function public.set_order_image(p_order_id bigint,p_revision integer,p_item_id bigint,p_mime text default null,p_content text default null,p_reason text default '')
returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; i public.order_items; bytes bytea; before_json jsonb;
begin
 o:=app_private.lock_editable_order(p_order_id,p_revision);
 select * into i from public.order_items where id=p_item_id and order_id=o.id;
 if i.id is null or i.product_id is not null or i.quantity=i.cancelled_quantity then raise exception 'Görsel yalnızca aktif özel sipariş kalemine eklenebilir'; end if;
 if btrim(coalesce(p_reason,''))='' or char_length(p_reason)>2000 then raise exception 'Görsel değişikliği gerekçesi gerekli'; end if;
 before_json:=app_private.order_snapshot(o.id);
 if p_content is not null then
  if length(p_content)>1398104 then raise exception 'Görsel en fazla 1 MB olabilir'; end if;
  bytes:=decode(p_content,'base64');
  if octet_length(bytes) not between 12 and 1048576 or p_mime is null or not(
    (p_mime='image/png' and substring(bytes from 1 for 8)=decode('89504e470d0a1a0a','hex')) or
    (p_mime='image/jpeg' and substring(bytes from 1 for 3)=decode('ffd8ff','hex')) or
    (p_mime='image/webp' and substring(bytes from 1 for 4)=decode('52494646','hex') and substring(bytes from 9 for 4)=decode('57454250','hex'))
   ) then raise exception 'Geçerli PNG, JPEG veya WebP görsel gerekli'; end if;
 end if;
 update public.order_images set removed_at=now() where item_id=i.id and removed_at is null;
 if p_content is not null then
  insert into public.order_images(order_id,item_id,mime,content,created_by) values(o.id,i.id,p_mime,bytes,auth.uid());
 elsif not found then raise exception 'Kaldırılacak görsel yok'; end if;
 perform app_private.record_order_change(o.id,'image',p_reason,before_json);
end;
$$;
create or replace function public.get_order_image(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare image public.order_images;
begin
 select * into image from public.order_images where id=p_id;
 if image.id is null or not app_private.can_read_order_id(image.order_id) then raise exception 'Görsel bulunamadı' using errcode='42501'; end if;
 return jsonb_build_object('mime',image.mime,'content',encode(image.content,'base64'));
end;
$$;
-- İç yardımcılar doğrudan RPC olarak çağrılamaz; yalnızca kontrollü public fonksiyonlar kullanılır.
revoke all on function app_private.order_snapshot(bigint),app_private.record_order_change(bigint,text,text,jsonb),app_private.lock_editable_order(bigint,integer),app_private.write_order_item(bigint,jsonb) from public,anon,authenticated;
revoke all on function app_private.can_read_order_id(bigint) from public,anon;
grant execute on function app_private.can_read_order_id(bigint) to authenticated;
revoke all on function public.create_order_v3(smallint,date,jsonb,text),public.edit_order(bigint,integer,date,text,jsonb,text),public.cancel_order_items(bigint,integer,jsonb,text),public.production_message(bigint,text,boolean),public.read_production_notification(bigint,boolean),public.set_order_image(bigint,integer,bigint,text,text,text),public.get_order_image(bigint) from public,anon;
grant execute on function public.create_order_v3(smallint,date,jsonb,text),public.edit_order(bigint,integer,date,text,jsonb,text),public.cancel_order_items(bigint,integer,jsonb,text),public.production_message(bigint,text,boolean),public.read_production_notification(bigint,boolean),public.set_order_image(bigint,integer,bigint,text,text,text),public.get_order_image(bigint) to authenticated;
notify pgrst,'reload schema';
commit;
