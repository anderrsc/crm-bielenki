begin;
-- Completa o recurso existente sem apagar fotos nem tornar arquivos públicos.
alter table public.production_step_photos add column if not exists deleted_at timestamptz;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('production-photos','production-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

revoke all on public.production_step_photos from anon;
revoke insert,update,delete on public.production_step_photos from authenticated;
grant select,update(deleted_at) on public.production_step_photos to authenticated;
drop policy if exists production_step_photos_select on public.production_step_photos;
create policy production_step_photos_select on public.production_step_photos for select to authenticated
using(company_id=(select public.current_company_id()) and public.has_table_access('production_orders','select'));
drop policy if exists production_step_photos_archive on public.production_step_photos;
create policy production_step_photos_archive on public.production_step_photos for update to authenticated
using(company_id=(select public.current_company_id()) and deleted_at is null and public.has_table_access('production_orders','update'))
with check(company_id=(select public.current_company_id()) and public.has_table_access('production_orders','update'));

drop policy if exists production_photos_read on storage.objects;
create policy production_photos_read on storage.objects for select to authenticated
using((storage.foldername(name))[1]=(select public.current_company_id())::text
  and public.has_table_access('production_orders','select')
  and exists(select 1 from public.production_step_photos p where p.company_id=(select public.current_company_id()) and p.deleted_at is null
    and ((bucket_id='production-photos' and p.photo_url=name)
      or (bucket_id='service-photos' and p.photo_url like '%/storage/v1/object/public/service-photos/'||name))));
drop policy if exists production_photos_upload on storage.objects;
create policy production_photos_upload on storage.objects for insert to authenticated
with check(bucket_id='production-photos'
  and (storage.foldername(name))[1]=(select public.current_company_id())::text
  and (storage.foldername(name))[2]='production'
  and public.has_table_access('production_orders','update')
  and exists(select 1 from public.production_orders po where po.company_id=(select public.current_company_id())
    and po.id::text=(storage.foldername(name))[3] and po.status<>'cancelado'));

create or replace function public.add_production_step_photo(p_production_order_id uuid,p_step_number integer,p_photo_url text,p_caption text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=public.current_company_id(); po public.production_orders; photo uuid;
begin
  perform public.require_table_access('production_orders','update');
  select * into po from public.production_orders where id=p_production_order_id and company_id=c for share;
  if not found or po.status='cancelado' then raise exception 'Ordem de produção não encontrada ou sem permissão' using errcode='42501'; end if;
  if p_step_number is null or p_step_number<1 or p_step_number>(case when po.flow_type='esquadrias' then 9 else 7 end)
    or (p_step_number<>po.current_step and not exists(select 1 from public.production_step_logs where production_order_id=po.id and step_number=p_step_number))
  then raise exception 'Etapa % não encontrada na ordem de produção',p_step_number; end if;
  if p_photo_url is null or p_photo_url not like c::text||'/production/'||po.id::text||'/step-'||p_step_number||'/%'
    or p_photo_url like '%..%' or p_photo_url like '%://%'
    or not exists(select 1 from storage.objects where bucket_id='production-photos' and name=p_photo_url)
  then raise exception 'Arquivo privado inválido'; end if;
  insert into public.production_step_photos(company_id,production_order_id,step_number,photo_url,caption,uploaded_by)
  values(c,po.id,p_step_number,p_photo_url,nullif(left(btrim(p_caption),300),''),auth.uid()) returning id into photo;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,new_data)
  values(c,auth.uid(),'production_step_photos',photo,'INSERT',jsonb_build_object('step_number',p_step_number));
  return photo;
end $$;
revoke all on function public.add_production_step_photo(uuid,integer,text,text) from public,anon;
grant execute on function public.add_production_step_photo(uuid,integer,text,text) to authenticated;

create or replace view public.v_production_step_photos with(security_invoker=true) as
select p.id,p.company_id,p.production_order_id,p.step_number,log.step_name,p.photo_url,p.caption,u.full_name as uploaded_by_name,p.created_at
from public.production_step_photos p
left join lateral(select step_name from public.production_step_logs l where l.production_order_id=p.production_order_id and l.step_number=p.step_number order by l.completed_at desc nulls last limit 1) log on true
left join public.profiles u on u.id=p.uploaded_by
where p.deleted_at is null;
grant select on public.v_production_step_photos to authenticated;
commit;
