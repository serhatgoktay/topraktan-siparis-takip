-- Tek ekleme: onay bekleyen sipariste teslim tarihi, not ve mevcut miktarlar.
-- Yeni tablo/kolon olusturmaz. Mevcut islev, rol ve RLS politikasini degistirmez.
begin;
create or replace function public.edit_pending_order(
 p_order_id bigint,p_expected jsonb,p_delivery date,p_note text,p_quantities jsonb,p_reason text
)
returns void language plpgsql security definer set search_path='' as '
declare
 actor public.profiles; target public.orders; snapshot jsonb; item jsonb;
 old_item public.order_items; amount numeric; seen bigint[]:=''{}'';
 changes text; chunks integer; part integer; changed boolean;
begin
 select * into actor from public.profiles where id=auth.uid() and active for share;
 select * into target from public.orders where id=p_order_id for update;
 if actor.id is null or target.id is null or not(
  actor.role=''admin'' or (actor.role=''operator'' and actor.unit_id<>4 and actor.unit_id=target.unit_id)
 ) then raise exception ''Sipariş düzenleme yetkiniz yok'' using errcode=''42501''; end if;
 if target.status<>''pending'' then raise exception ''Sipariş artık onay beklemiyor. Listeyi yenileyin.'' using errcode=''PT409''; end if;
 select jsonb_build_object(''delivery'',target.delivery,''note'',target.note,''items'',
  coalesce(jsonb_agg(jsonb_build_object(''id'',id,''quantity'',quantity) order by id),''[]''::jsonb)) into snapshot
 from public.order_items where order_id=target.id;
 if p_expected is distinct from snapshot then raise exception ''Sipariş değişmiş. Listeyi yenileyip tekrar deneyin.'' using errcode=''PT409''; end if;
 if p_delivery is null or (p_delivery<>target.delivery and p_delivery<(now() at time zone ''Europe/Istanbul'')::date) then raise exception ''Yeni teslim tarihi bugün veya ileri bir gün olmalı''; end if;
 if p_note is null or char_length(p_note)>2000 then raise exception ''Not en fazla 2000 karakter olmalı''; end if;
 if btrim(coalesce(p_reason,''''))='''' or char_length(p_reason)>500 then raise exception ''Düzenleme gerekçesi gerekli (en fazla 500 karakter)''; end if;
 if p_quantities is null or jsonb_typeof(p_quantities)<>''array'' or jsonb_array_length(p_quantities)<>(select count(*) from public.order_items where order_id=target.id) then raise exception ''Mevcut kalemlerin tamamını gönderin''; end if;
 changes:=''Sipariş düzenlendi. Gerekçe: ''||btrim(p_reason)||chr(10);
 changed:=p_delivery<>target.delivery or p_note<>target.note;
 if p_delivery<>target.delivery then changes:=changes||''Teslim tarihi: ''||target.delivery||'' → ''||p_delivery||chr(10); end if;
 if p_note<>target.note then changes:=changes||''Önceki not: ''||target.note||chr(10)||''Yeni not: ''||p_note||chr(10); end if;
 for item in select value from jsonb_array_elements(p_quantities) loop
  select * into old_item from public.order_items where id=(item->>''id'')::bigint and order_id=target.id;
  if old_item.id is null or old_item.id=any(seen) then raise exception ''Geçersiz veya tekrarlanan sipariş kalemi''; end if;
  seen:=array_append(seen,old_item.id);amount:=(item->>''quantity'')::numeric;
  if amount is null or amount<=0 or amount>1000000 or round(amount,3)<>amount or (old_item.measure<>''kg'' and trunc(amount)<>amount) then raise exception ''Geçersiz miktar: adet/tepsi tam sayı, kilogram en fazla 3 ondalık olmalı''; end if;
  if amount<>old_item.quantity then
   changed:=true;
   changes:=changes||old_item.name||case when old_item.servings is null then '''' else '' (''||old_item.servings||'' kişilik)'' end||'': ''||old_item.quantity||'' → ''||amount||'' ''||old_item.measure||chr(10);
   update public.order_items set quantity=amount where id=old_item.id;
  end if;
 end loop;
 if not changed then raise exception ''Değişiklik yapılmadı''; end if;
 update public.orders set delivery=p_delivery,note=p_note where id=target.id;
 chunks:=ceil(char_length(changes)/1900.0)::integer;
 for part in 1..chunks loop
  insert into public.order_events(order_id,user_id,actor_name,status,note)
  values(target.id,actor.id,actor.name,''pending'',''Düzenleme kaydı (''||part||''/''||chunks||'')''||chr(10)||substring(changes from (part-1)*1900+1 for 1900));
 end loop;
end;
';
revoke all on function public.edit_pending_order(bigint,jsonb,date,text,jsonb,text) from public,anon;
grant execute on function public.edit_pending_order(bigint,jsonb,date,text,jsonb,text) to authenticated;

create or replace function public.pending_order_editing_ready()
returns boolean language sql stable security definer set search_path='' as '
 select exists(select 1 from public.profiles where id=auth.uid() and active)
 and to_regprocedure(''public.edit_pending_order(bigint,jsonb,date,text,jsonb,text)'') is not null;
';
revoke all on function public.pending_order_editing_ready() from public,anon;
grant execute on function public.pending_order_editing_ready() to authenticated;
notify pgrst,'reload schema';
commit;

select case when to_regprocedure('public.edit_pending_order(bigint,jsonb,date,text,jsonb,text)') is not null
 and to_regprocedure('public.pending_order_editing_ready()') is not null
 then 'DUZENLEME_HAZIR' else 'KURULUM_EKSIK' end as sonuc;
