-- Etapa 3 (velocidade).
-- Uma consulta so para saber quais modulos o usuario ve (antes eram ate 17 por tela).
create or replace function public.viewable_resources(p_resources text[])
returns text[] language sql stable set search_path = public as $$
  select coalesce(array_agg(r order by r), '{}') from unnest(p_resources) r where public.has_table_access(r, 'select');
$$;
revoke all on function public.viewable_resources(text[]) from public, anon;
grant execute on function public.viewable_resources(text[]) to authenticated;

-- Indice duplicado na matriz de aluminio.
drop index if exists public.idx_aluminum_matrix_company;

-- Busca por trecho de texto (ilike '%...%') com indice proprio.
do $$
begin
  create schema if not exists extensions;
  create extension if not exists pg_trgm with schema extensions;
  execute 'create index if not exists clients_name_trgm on public.clients using gin (name extensions.gin_trgm_ops)';
  execute 'create index if not exists financial_entries_description_trgm on public.financial_entries using gin (description extensions.gin_trgm_ops)';
  execute 'create index if not exists conversations_contact_trgm on public.conversations using gin (contact_name extensions.gin_trgm_ops)';
exception when others then
  raise notice 'indices de busca por texto nao criados: %', sqlerrm;
end $$;
