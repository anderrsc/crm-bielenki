-- Migration 040 - Cache do PDF do orcamento
--
-- O download do PDF gerava o arquivo do zero a cada clique (headless
-- Chromium navegando a pagina real), levando varios segundos. Agora o PDF
-- e pre-gerado em segundo plano assim que o orcamento e salvo/atualizado, e
-- guardado no storage. O download so precisa buscar o arquivo pronto; so
-- gera na hora se o cache ainda nao existir ou estiver desatualizado.

begin;

alter table public.quotes
  add column if not exists pdf_generated_at timestamptz;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('quote-pdfs','quote-pdfs',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760;

drop policy if exists "company reads own quote pdfs" on storage.objects;
create policy "company reads own quote pdfs" on storage.objects for select to authenticated
using(bucket_id='quote-pdfs' and (storage.foldername(name))[1]=public.current_company_id()::text);

drop policy if exists "company writes own quote pdfs" on storage.objects;
create policy "company writes own quote pdfs" on storage.objects for insert to authenticated
with check(bucket_id='quote-pdfs' and (storage.foldername(name))[1]=public.current_company_id()::text);

drop policy if exists "company updates own quote pdfs" on storage.objects;
create policy "company updates own quote pdfs" on storage.objects for update to authenticated
using(bucket_id='quote-pdfs' and (storage.foldername(name))[1]=public.current_company_id()::text);

commit;
