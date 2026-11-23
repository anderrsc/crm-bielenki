begin;
-- As funções de sessão/permissão são estáveis para a consulta, não por foto.
alter policy production_step_photos_select on public.production_step_photos
using(company_id=(select public.current_company_id()) and (select public.has_table_access('production_orders','select')));
alter policy production_step_photos_archive on public.production_step_photos
using(company_id=(select public.current_company_id()) and deleted_at is null and (select public.has_table_access('production_orders','update')))
with check(company_id=(select public.current_company_id()) and (select public.has_table_access('production_orders','update')));
alter policy production_photos_read on storage.objects
using((storage.foldername(name))[1]=(select public.current_company_id())::text
  and (select public.has_table_access('production_orders','select'))
  and exists(select 1 from public.production_step_photos p where p.company_id=(select public.current_company_id()) and p.deleted_at is null
    and ((bucket_id='production-photos' and p.photo_url=name)
      or (bucket_id='service-photos' and p.photo_url like '%/storage/v1/object/public/service-photos/'||name))));
alter policy production_photos_upload on storage.objects
with check(bucket_id='production-photos'
  and (storage.foldername(name))[1]=(select public.current_company_id())::text
  and (storage.foldername(name))[2]='production'
  and (select public.has_table_access('production_orders','update'))
  and exists(select 1 from public.production_orders po where po.company_id=(select public.current_company_id())
    and po.id::text=(storage.foldername(name))[3] and po.status<>'cancelado'));
commit;
