-- Internal quotation documents only. Never included in customer-facing PDFs.
create table if not exists public.quote_internal_attachments (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 quote_id uuid not null references public.quotes(id) on delete cascade,
 original_name text not null check(length(original_name) between 1 and 180),
 file_path text not null unique,
 content_type text not null,
 size_bytes bigint not null check(size_bytes>0 and size_bytes<=10485760),
 uploaded_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 check(file_path like company_id::text||'/'||quote_id::text||'/%')
);
create index if not exists quote_internal_attachments_quote on public.quote_internal_attachments(quote_id,created_at);
create index if not exists quote_internal_attachments_company on public.quote_internal_attachments(company_id);
create index if not exists quote_internal_attachments_author on public.quote_internal_attachments(uploaded_by);
alter table public.quote_internal_attachments enable row level security;
grant select,insert,delete on public.quote_internal_attachments to authenticated;
grant all on public.quote_internal_attachments to service_role;

create policy quote_attachment_read on public.quote_internal_attachments for select to authenticated
using(company_id=(select public.current_company_id()) and public.has_table_access('quotes','select') and exists(select 1 from public.quotes q where q.id=quote_internal_attachments.quote_id and q.company_id=quote_internal_attachments.company_id));
create policy quote_attachment_add on public.quote_internal_attachments for insert to authenticated
with check(company_id=(select public.current_company_id()) and uploaded_by=(select auth.uid()) and public.has_table_access('quotes','update') and exists(select 1 from public.quotes q where q.id=quote_internal_attachments.quote_id and q.company_id=quote_internal_attachments.company_id));
create policy quote_attachment_remove on public.quote_internal_attachments for delete to authenticated
using(company_id=(select public.current_company_id()) and public.has_table_access('quotes','update') and exists(select 1 from public.quotes q where q.id=quote_internal_attachments.quote_id and q.company_id=quote_internal_attachments.company_id));

insert into storage.buckets(id,name,public,file_size_limit)
values('quote-internal-attachments','quote-internal-attachments',false,10485760)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit;

create policy quote_attachment_storage_read on storage.objects for select to authenticated
using(bucket_id='quote-internal-attachments' and (storage.foldername(name))[1]=(select public.current_company_id())::text and public.has_table_access('quotes','select') and exists(select 1 from public.quotes q where q.id::text=(storage.foldername(name))[2] and q.company_id=(select public.current_company_id())));
create policy quote_attachment_storage_add on storage.objects for insert to authenticated
with check(bucket_id='quote-internal-attachments' and (storage.foldername(name))[1]=(select public.current_company_id())::text and public.has_table_access('quotes','update') and exists(select 1 from public.quotes q where q.id::text=(storage.foldername(name))[2] and q.company_id=(select public.current_company_id())));
create policy quote_attachment_storage_remove on storage.objects for delete to authenticated
using(bucket_id='quote-internal-attachments' and (storage.foldername(name))[1]=(select public.current_company_id())::text and public.has_table_access('quotes','update') and exists(select 1 from public.quotes q where q.id::text=(storage.foldername(name))[2] and q.company_id=(select public.current_company_id())));
