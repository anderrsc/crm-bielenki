-- Identidade visual e dados usados em documentos comerciais.
alter table public.companies
  add column if not exists trade_name text,
  add column if not exists whatsapp text,
  add column if not exists address text,
  add column if not exists neighborhood text,
  add column if not exists city text,
  add column if not exists state char(2),
  add column if not exists website text,
  add column if not exists logo_url text,
  add column if not exists primary_color text not null default '#234d3c',
  add column if not exists accent_color text not null default '#b9d349',
  add column if not exists quote_footer text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('company-assets','company-assets',true,2097152,array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict(id) do update set public=true,file_size_limit=2097152;

create policy "company assets public read" on storage.objects for select using(bucket_id='company-assets');
create policy "company admins upload assets" on storage.objects for insert to authenticated
with check(bucket_id='company-assets' and (storage.foldername(name))[1]=public.current_company_id()::text and public.has_role(array['administrador','gerente']::public.app_role[]));
create policy "company admins update assets" on storage.objects for update to authenticated
using(bucket_id='company-assets' and (storage.foldername(name))[1]=public.current_company_id()::text and public.has_role(array['administrador','gerente']::public.app_role[]));

update public.companies set trade_name=coalesce(trade_name,'Marquinhos Calhas e Esquadrias') where trade_name is null;
