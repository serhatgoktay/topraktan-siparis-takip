-- Kullanıcı adıyla giriş güncellemesi. Mevcut hesapları ve şifreleri korur.
-- SQL Editor'da dosyanın tamamını tek sorgu olarak çalıştırın.
begin;

alter table public.profiles add column if not exists username text;
lock table public.profiles in share row exclusive mode;
create unique index if not exists profiles_username_unique
 on public.profiles(lower(username)) where username is not null;

-- İlk yönetici: hakan. Diğer hesaplar rol/biriminden türetilir.
-- Aynı birimde birden fazla kişi varsa bahce2, bahce3 vb. atanır.
do $$
declare p record; base_name text; candidate text; suffix integer;
begin
 for p in select id,role,unit_id from public.profiles
  where username is null order by created_at,id loop
  base_name:=case
   when p.role='admin' then 'hakan'
   when p.role='manager' then 'imalat_sorumlusu'
   when p.unit_id=1 then 'bahce'
   when p.unit_id=2 then 'kucukpark'
   when p.unit_id=3 then 'evka3'
   when p.unit_id=4 then 'imalat'
   else 'kullanici' end;
  candidate:=base_name; suffix:=1;
  while exists(select 1 from public.profiles where lower(username)=candidate) loop
   suffix:=suffix+1; candidate:=base_name||suffix::text;
  end loop;
  update public.profiles set username=candidate where id=p.id;
 end loop;
 if not exists(select 1 from pg_constraint where conname='profiles_username_format_check' and conrelid='public.profiles'::regclass) then
  alter table public.profiles add constraint profiles_username_format_check
   check(username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');
 end if;
 if not exists(select 1 from pg_constraint where conname='profiles_active_username_check' and conrelid='public.profiles'::regclass) then
  alter table public.profiles add constraint profiles_active_username_check
   check(not active or username is not null);
 end if;
end;
$$;

-- E-posta eşlemesi yalnızca sunucunun service_role yetkisine açıktır.
-- Anonim/normal kullanıcılar ad üzerinden e-posta sorgulayamaz.
create or replace function public.resolve_login_username(p_username text)
returns text language sql stable security definer set search_path='' as $$
 select u.email from public.profiles p
 join auth.users u on u.id=p.id
 where p.username=lower(btrim(p_username)) and p.active
 limit 1;
$$;
revoke all on function public.resolve_login_username(text) from public,anon,authenticated;
grant execute on function public.resolve_login_username(text) to service_role;

create or replace function public.admin_set_profile_v2(
 p_user_id uuid,p_name text,p_role text,p_unit_id smallint,p_active boolean,p_username text
)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.profiles; normalized text;
begin
 select * into actor from public.profiles where id=auth.uid() and active for update;
 if actor.id is null or actor.role<>'admin' then
  raise exception 'Kullanıcı yönetimi yetkiniz yok' using errcode='42501';
 end if;
 normalized:=lower(btrim(p_username));
 if normalized is null or normalized !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
  raise exception 'Kullanıcı adı 3–32 karakter olmalı; a-z, 0-9, nokta, tire ve alt çizgi kullanılabilir';
 end if;
 if p_user_id=actor.id and (p_active is distinct from true or p_role is distinct from 'admin') then
  raise exception 'Kendi yönetici yetkinizi kaldıramazsınız';
 end if;
 if exists(select 1 from public.profiles where lower(username)=normalized and id<>p_user_id) then
  raise exception 'Bu kullanıcı adı zaten kullanılıyor';
 end if;
 update public.profiles set name=btrim(p_name),role=p_role,
  unit_id=case when p_role='operator' then p_unit_id else null end,
  active=p_active,username=normalized where id=p_user_id;
 if not found then raise exception 'Kullanıcı bulunamadı'; end if;
exception when unique_violation then
 raise exception 'Bu kullanıcı adı zaten kullanılıyor';
end;
$$;
revoke all on function public.admin_set_profile_v2(uuid,text,text,smallint,boolean,text) from public,anon;
grant execute on function public.admin_set_profile_v2(uuid,text,text,smallint,boolean,text) to authenticated;

notify pgrst,'reload schema';
commit;
