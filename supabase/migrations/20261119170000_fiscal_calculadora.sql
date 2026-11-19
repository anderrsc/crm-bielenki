-- Calculadora fiscal (IBS/CBS/IS) com o motor oficial da Receita. Só simulação: não emite nota
-- e não lança nada no financeiro. Somente cria tabelas novas (nada existente é alterado).

-- Permissão "fiscal": financeiro calcula e aprova classificação; vendedor só simula; admin/gerente sempre.
insert into public.permissions(role, resource, can_view, can_create, can_update, can_delete)
select r.role::public.app_role, 'fiscal', r.v, r.c, r.u, false
from (values ('financeiro', true, true, true), ('vendedor', true, true, false),
             ('compras', false, false, false), ('producao', false, false, false), ('estoque', false, false, false),
             ('instalador', false, false, false), ('atendente', false, false, false)) as r(role, v, c, u)
on conflict (role, resource) do nothing;

-- Configuração por empresa. Desligada por padrão.
create table if not exists public.fiscal_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  regime text not null default 'simples' check (regime in ('simples', 'hibrido', 'regular')),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  municipio_ibge integer check (municipio_ibge is null or municipio_ibge between 1000000 and 9999999),
  -- Alíquotas informadas por ano (ex.: {"2027": {"cbs": 8.8, "ibsEstadual": 0.05, "ibsMunicipal": 0.05, "fonte": "..."}}),
  -- usadas só quando a base oficial não tem alíquota de referência (o resultado sai como simulado).
  aliquotas_informadas jsonb not null default '{}'::jsonb check (jsonb_typeof(aliquotas_informadas) = 'object'),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

-- Classificação fiscal aprovada de cada produto/serviço vendido (pelo nome usado no orçamento).
create table if not exists public.fiscal_classifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade default public.current_company_id(),
  produto text not null check (length(btrim(produto)) between 1 and 200),
  produto_chave text not null,
  natureza text not null default 'mercadoria' check (natureza in ('mercadoria', 'servico')),
  ncm text check (ncm is null or ncm ~ '^\d{8}$'),
  nbs text check (nbs is null or nbs ~ '^\d{9}$'),
  cst text check (cst is null or cst ~ '^\d{3}$'),
  cclasstrib text check (cclasstrib is null or cclasstrib ~ '^\d{6}$'),
  unidade text check (unidade is null or length(unidade) <= 6),
  observacao text check (observacao is null or length(observacao) <= 500),
  status text not null default 'rascunho' check (status in ('rascunho', 'aprovada')),
  aprovado_por uuid references public.profiles(id) on delete set null,
  aprovado_em timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, produto_chave),
  -- Aprovada só com códigos completos e coerentes com a natureza.
  check (status <> 'aprovada' or (cst is not null and cclasstrib is not null and (
    (natureza = 'mercadoria' and ncm is not null and nbs is null) or (natureza = 'servico' and nbs is not null and ncm is null))))
);

-- Chave do produto, regras de aprovação (só administrador, gerente ou financeiro) e auditoria.
create or replace function public.fiscal_classification_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare codes_changed boolean;
begin
  new.produto := btrim(regexp_replace(new.produto, '\s+', ' ', 'g'));
  new.produto_chave := lower(new.produto);
  new.updated_at := now();
  codes_changed := tg_op = 'INSERT' or (new.natureza, new.ncm, new.nbs, new.cst, new.cclasstrib, new.unidade)
    is distinct from (old.natureza, old.ncm, old.nbs, old.cst, old.cclasstrib, old.unidade);
  if tg_op = 'UPDATE' and codes_changed then
    -- Mudou um código: volta para rascunho. Aprovar é sempre um passo separado, sobre códigos já revisados.
    new.status := 'rascunho';
  elsif new.status = 'aprovada' and (tg_op = 'INSERT' or old.status <> 'aprovada') then
    if not public.has_role(array['administrador', 'gerente', 'financeiro']::public.app_role[]) then
      raise exception using errcode = 'P0001', message = 'Só o financeiro, a gerência ou o administrador aprovam a classificação fiscal.';
    end if;
    new.aprovado_por := auth.uid();
    new.aprovado_em := now();
  elsif tg_op = 'UPDATE' and new.status = 'aprovada' then
    new.aprovado_por := old.aprovado_por; new.aprovado_em := old.aprovado_em;
  end if;
  if new.status = 'rascunho' then new.aprovado_por := null; new.aprovado_em := null; end if;
  return new;
end $$;
drop trigger if exists fiscal_classification_guard on public.fiscal_classifications;
create trigger fiscal_classification_guard before insert or update on public.fiscal_classifications
  for each row execute function public.fiscal_classification_guard();

create or replace function public.fiscal_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v jsonb := to_jsonb(coalesce(new, old));
begin
  -- fiscal_settings não tem id: o registro é a própria empresa.
  insert into public.audit_logs(company_id, profile_id, table_name, record_id, action, old_data, new_data)
  values ((v->>'company_id')::uuid, auth.uid(), tg_table_name, coalesce((v->>'id')::uuid, (v->>'company_id')::uuid),
    tg_op, case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end, case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
drop trigger if exists fiscal_classifications_audit on public.fiscal_classifications;
create trigger fiscal_classifications_audit after insert or update or delete on public.fiscal_classifications
  for each row execute function public.fiscal_audit();
drop trigger if exists fiscal_settings_audit on public.fiscal_settings;
create trigger fiscal_settings_audit after insert or update or delete on public.fiscal_settings
  for each row execute function public.fiscal_audit();

-- Histórico de cálculos (imutável): entrada, resposta do motor, versão e quem calculou.
create table if not exists public.fiscal_calculations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade default public.current_company_id(),
  origem text not null check (origem in ('avulso', 'orcamento', 'pedido')),
  quote_id uuid references public.quotes(id) on delete set null,
  sale_id uuid references public.sales(id) on delete set null,
  data_fato_gerador date not null,
  motor text not null,
  versao_app text,
  versao_db text,
  simulado boolean not null,
  aviso text,
  aliquotas jsonb,
  status text not null check (status in ('calculado', 'parcial', 'sem_calculo')),
  total_base numeric(14,2) not null default 0,
  total_cbs numeric(14,2) not null default 0,
  total_ibs numeric(14,2) not null default 0,
  total_is numeric(14,2) not null default 0,
  entrada jsonb not null,
  resposta jsonb not null,
  idempotency_key text check (idempotency_key is null or length(idempotency_key) <= 100),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, idempotency_key)
);
create index if not exists fiscal_calculations_company_idx on public.fiscal_calculations(company_id, created_at desc);
create index if not exists fiscal_calculations_quote_idx on public.fiscal_calculations(quote_id, created_at desc);

create table if not exists public.fiscal_calculation_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade default public.current_company_id(),
  calculation_id uuid not null references public.fiscal_calculations(id) on delete cascade,
  numero integer not null,
  produto text not null,
  estado text not null check (estado in ('CALCULADO', 'CALCULO_SIMULADO', 'INCONSISTENCIA_ENTRADA', 'NAO_IMPLEMENTADO', 'FALHA_TECNICA', 'SEM_CLASSIFICACAO')),
  base numeric(14,2),
  cbs numeric(14,2),
  ibs_uf numeric(14,2),
  ibs_mun numeric(14,2),
  ibs numeric(14,2),
  is_valor numeric(14,2),
  memoria text,
  erros jsonb not null default '[]'::jsonb,
  unique (calculation_id, numero)
);

-- Grava cálculo + itens de uma vez; a mesma chave de idempotência devolve o cálculo já gravado.
create or replace function public.save_fiscal_calculation(p jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare c uuid := public.current_company_id(); v_id uuid; it jsonb;
begin
  if c is null then raise exception using errcode = 'P0001', message = 'Sessão expirada.'; end if;
  if public.has_table_access('fiscal', 'insert') is not true then raise exception using errcode = 'P0001', message = 'Sem permissão para a calculadora fiscal.'; end if;
  if p->>'idempotency_key' is not null then
    select id into v_id from public.fiscal_calculations where company_id = c and idempotency_key = p->>'idempotency_key';
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.fiscal_calculations(company_id, origem, quote_id, sale_id, data_fato_gerador, motor, versao_app, versao_db, simulado, aviso, aliquotas,
    status, total_base, total_cbs, total_ibs, total_is, entrada, resposta, idempotency_key)
  values (c, p->>'origem', nullif(p->>'quote_id', '')::uuid, nullif(p->>'sale_id', '')::uuid, (p->>'data_fato_gerador')::date, p->>'motor',
    p->>'versao_app', p->>'versao_db', coalesce((p->>'simulado')::boolean, true), p->>'aviso', p->'aliquotas', p->>'status',
    coalesce((p->>'total_base')::numeric, 0), coalesce((p->>'total_cbs')::numeric, 0), coalesce((p->>'total_ibs')::numeric, 0), coalesce((p->>'total_is')::numeric, 0),
    coalesce(p->'entrada', '{}'::jsonb), coalesce(p->'resposta', '{}'::jsonb), p->>'idempotency_key')
  returning id into v_id;
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    insert into public.fiscal_calculation_items(company_id, calculation_id, numero, produto, estado, base, cbs, ibs_uf, ibs_mun, ibs, is_valor, memoria, erros)
    values (c, v_id, (it->>'numero')::int, left(it->>'produto', 200), it->>'estado', (it->>'base')::numeric, (it->>'cbs')::numeric, (it->>'ibs_uf')::numeric,
      (it->>'ibs_mun')::numeric, (it->>'ibs')::numeric, (it->>'is_valor')::numeric, left(it->>'memoria', 4000), coalesce(it->'erros', '[]'::jsonb));
  end loop;
  return v_id;
end $$;
revoke all on function public.save_fiscal_calculation(jsonb) from public, anon;
grant execute on function public.save_fiscal_calculation(jsonb) to authenticated;
revoke all on function public.fiscal_classification_guard() from public, anon, authenticated;
revoke all on function public.fiscal_audit() from public, anon, authenticated;

-- RLS: só a própria empresa e só quem tem a permissão "fiscal".
alter table public.fiscal_settings enable row level security;
alter table public.fiscal_classifications enable row level security;
alter table public.fiscal_calculations enable row level security;
alter table public.fiscal_calculation_items enable row level security;

drop policy if exists fiscal_settings_read on public.fiscal_settings;
create policy fiscal_settings_read on public.fiscal_settings for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('fiscal', 'select')));
drop policy if exists fiscal_settings_write on public.fiscal_settings;
create policy fiscal_settings_write on public.fiscal_settings for insert to authenticated
  with check (company_id = (select public.current_company_id()) and (select public.has_table_access('fiscal', 'update')));
drop policy if exists fiscal_settings_update on public.fiscal_settings;
create policy fiscal_settings_update on public.fiscal_settings for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('fiscal', 'update')))
  with check (company_id = (select public.current_company_id()));

drop policy if exists fiscal_classifications_read on public.fiscal_classifications;
create policy fiscal_classifications_read on public.fiscal_classifications for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('fiscal', 'select')));
drop policy if exists fiscal_classifications_insert on public.fiscal_classifications;
create policy fiscal_classifications_insert on public.fiscal_classifications for insert to authenticated
  with check (company_id = (select public.current_company_id()) and (select public.has_table_access('fiscal', 'update')));
drop policy if exists fiscal_classifications_update on public.fiscal_classifications;
create policy fiscal_classifications_update on public.fiscal_classifications for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('fiscal', 'update')))
  with check (company_id = (select public.current_company_id()));

drop policy if exists fiscal_calculations_read on public.fiscal_calculations;
create policy fiscal_calculations_read on public.fiscal_calculations for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('fiscal', 'select')));
drop policy if exists fiscal_calculations_insert on public.fiscal_calculations;
create policy fiscal_calculations_insert on public.fiscal_calculations for insert to authenticated
  with check (company_id = (select public.current_company_id()) and (select public.has_table_access('fiscal', 'insert')));
drop policy if exists fiscal_calculation_items_read on public.fiscal_calculation_items;
create policy fiscal_calculation_items_read on public.fiscal_calculation_items for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('fiscal', 'select')));
drop policy if exists fiscal_calculation_items_insert on public.fiscal_calculation_items;
create policy fiscal_calculation_items_insert on public.fiscal_calculation_items for insert to authenticated
  with check (company_id = (select public.current_company_id()) and (select public.has_table_access('fiscal', 'insert')));

grant select, insert, update on public.fiscal_settings, public.fiscal_classifications to authenticated;
grant select, insert on public.fiscal_calculations, public.fiscal_calculation_items to authenticated;
