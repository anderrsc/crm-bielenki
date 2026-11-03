-- Desempenho: regras de RLS avaliadas uma vez por consulta, indices nas
-- chaves estrangeiras e uma consulta unica de acesso para o middleware.
-- Pode ser rodada mais de uma vez.

-- 1) RLS: current_company_id(), auth.uid(), has_table_access('..','..') e
-- has_role(ARRAY[..]) nao dependem da linha. Sem "(select ...)" o Postgres
-- executa a funcao para cada linha lida; com ele, uma vez por consulta
-- (recomendacao do Supabase: "auth_rls_initplan"). O resultado e o mesmo.
do $$
declare
  p record;
  q text;
  c text;
  wrap constant text[] := array[
    '(?<!SELECT )(current_company_id\(\))',
    '(?<!SELECT )(auth\.uid\(\))',
    '(?<!SELECT )(has_table_access\(''[a-z_]+''::text, ''[a-z_]+''::text\))',
    '(?<!SELECT )(has_role\(ARRAY\[[^\]]*\]\))'
  ];
  w text;
begin
  for p in
    select pol.polname, cls.relname, pg_get_expr(pol.polqual, pol.polrelid) qual, pg_get_expr(pol.polwithcheck, pol.polrelid) chk
    from pg_policy pol join pg_class cls on cls.oid = pol.polrelid
    where cls.relnamespace = 'public'::regnamespace
  loop
    q := p.qual; c := p.chk;
    foreach w in array wrap loop
      q := regexp_replace(q, w, '(SELECT \1)', 'g');
      c := regexp_replace(c, w, '(SELECT \1)', 'g');
    end loop;
    if q is distinct from p.qual or c is distinct from p.chk then
      execute format('alter policy %I on public.%I', p.polname, p.relname)
        || case when q is null then '' else format(' using (%s)', q) end
        || case when c is null then '' else format(' with check (%s)', c) end;
    end if;
  end loop;
end $$;

-- 2) Indice em toda chave estrangeira do schema public que ainda nao tem um
-- indice comecando por ela (filtros por empresa, cliente, pedido etc.).
do $$
declare
  fk record;
  idx text;
begin
  for fk in
    select co.conrelid::regclass::text tbl, cls.relname, a.attname col
    from pg_constraint co
    join pg_class cls on cls.oid = co.conrelid
    join pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
    where co.contype = 'f' and co.connamespace = 'public'::regnamespace
      and not exists (
        select 1 from pg_index i
        where i.indrelid = co.conrelid and (i.indkey::int2[])[0] = co.conkey[1]
      )
  loop
    idx := left('idx_' || fk.relname || '_' || fk.col, 63);
    execute format('create index if not exists %I on %s (%I)', idx, fk.tbl, fk.col);
  end loop;
end $$;

-- 3) Uma ida ao banco para o middleware: status do perfil, cargos e acesso
-- ao modulo da pagina (antes eram ate tres consultas por clique).
create or replace function public.session_access(p_resource text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'status', p.status,
    'roles', to_jsonb(public.current_user_roles()),
    'allowed', p_resource is null or public.has_table_access(p_resource, 'select')
  )
  from public.profiles p
  where p.id = auth.uid()
$$;
revoke all on function public.session_access(text) from public, anon;
grant execute on function public.session_access(text) to authenticated;
