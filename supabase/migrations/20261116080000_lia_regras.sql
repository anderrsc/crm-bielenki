begin;
-- Regras da Lia ensinadas pela gerência ("Lia, não responda assim; quando... faça...").
-- Cada regra nasce como proposta, só vale depois de confirmada, tem versão e pode ser
-- desfeita. As ativas entram no prompt da Lia em toda conversa da empresa.
-- Aditivo: não altera ai_agent_config nem o texto de regras existente.
create table if not exists public.ai_lia_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quando text check (quando is null or length(quando) <= 300),
  instrucao text not null check (length(instrucao) between 5 and 1000),
  pedido_original text check (pedido_original is null or length(pedido_original) <= 2000),
  exemplo text check (exemplo is null or length(exemplo) <= 2000),
  status text not null default 'proposta' check (status in ('proposta','ativa','arquivada')),
  versao integer not null default 1 check (versao >= 1),
  anterior_id uuid references public.ai_lia_rules(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  ativada_em timestamptz,
  ativada_por uuid references public.profiles(id) on delete set null,
  arquivada_em timestamptz
);
create index if not exists ai_lia_rules_company_status_idx on public.ai_lia_rules(company_id, status, ativada_em);
alter table public.ai_lia_rules enable row level security;
drop policy if exists ai_lia_rules_select on public.ai_lia_rules;
create policy ai_lia_rules_select on public.ai_lia_rules for select to authenticated
  using (company_id = (select public.current_company_id()));
-- Escrita só pelas funções abaixo (gerência), que registram auditoria.
revoke insert, update, delete on public.ai_lia_rules from authenticated, anon;
grant select on public.ai_lia_rules to authenticated;
grant select on public.ai_lia_rules to service_role;

create or replace function crm_private.lia_rule_guard() returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c uuid := public.current_company_id();
begin
  if c is null or not public.has_role(array['administrador','gerente']::public.app_role[]) then
    raise exception 'Só a gerência pode ensinar regras à Lia' using errcode='42501';
  end if;
  return c;
end $$;
revoke all on function crm_private.lia_rule_guard() from public, anon, authenticated;

-- Nova regra (ou nova versão de uma regra ativa, com p_anterior). Nasce como proposta.
create or replace function public.lia_rule_propose(p_quando text, p_instrucao text, p_pedido text default null, p_exemplo text default null, p_anterior uuid default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid := crm_private.lia_rule_guard(); v integer := 1; rid uuid;
  q text := nullif(btrim(coalesce(p_quando,'')),''); i text := btrim(coalesce(p_instrucao,''));
begin
  if length(i) < 5 or length(i) > 1000 then raise exception 'A instrução precisa ter de 5 a 1000 caracteres'; end if;
  if q is not null and length(q) > 300 then raise exception 'A situação precisa ter até 300 caracteres'; end if;
  if p_anterior is not null then
    select versao + 1 into v from public.ai_lia_rules where id = p_anterior and company_id = c and status <> 'arquivada';
    if not found then raise exception 'Regra anterior não encontrada'; end if;
  end if;
  insert into public.ai_lia_rules(company_id, quando, instrucao, pedido_original, exemplo, versao, anterior_id, created_by)
  values (c, q, i, left(p_pedido, 2000), left(p_exemplo, 2000), v, p_anterior, auth.uid()) returning id into rid;
  insert into public.audit_logs(company_id, profile_id, table_name, record_id, action, old_data, new_data)
  values (c, auth.uid(), 'ai_lia_rules', rid, 'INSERT', null, jsonb_build_object('quando', q, 'instrucao', i, 'versao', v, 'anterior_id', p_anterior));
  return rid;
end $$;

-- Confirma a proposta: passa a valer e a versão anterior sai de uso.
create or replace function public.lia_rule_activate(p_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid := crm_private.lia_rule_guard(); r public.ai_lia_rules;
begin
  select * into r from public.ai_lia_rules where id = p_id and company_id = c for update;
  if not found then raise exception 'Regra não encontrada'; end if;
  if r.status = 'ativa' then return; end if;
  if r.status <> 'proposta' then raise exception 'Só uma proposta pode ser confirmada'; end if;
  update public.ai_lia_rules set status = 'ativa', ativada_em = now(), ativada_por = auth.uid() where id = p_id;
  if r.anterior_id is not null then
    update public.ai_lia_rules set status = 'arquivada', arquivada_em = now()
      where id = r.anterior_id and company_id = c and status = 'ativa';
  end if;
  insert into public.audit_logs(company_id, profile_id, table_name, record_id, action, old_data, new_data)
  values (c, auth.uid(), 'ai_lia_rules', p_id, 'UPDATE', jsonb_build_object('status', r.status), jsonb_build_object('status', 'ativa', 'substitui', r.anterior_id));
end $$;

-- Desfaz: a regra (proposta ou ativa) deixa de valer. Ao desfazer uma versão nova,
-- a anterior que ela substituiu volta a valer.
create or replace function public.lia_rule_archive(p_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid := crm_private.lia_rule_guard(); r public.ai_lia_rules;
begin
  select * into r from public.ai_lia_rules where id = p_id and company_id = c for update;
  if not found then raise exception 'Regra não encontrada'; end if;
  if r.status = 'arquivada' then return; end if;
  update public.ai_lia_rules set status = 'arquivada', arquivada_em = now() where id = p_id;
  if r.status = 'ativa' and r.anterior_id is not null then
    update public.ai_lia_rules set status = 'ativa', arquivada_em = null
      where id = r.anterior_id and company_id = c and status = 'arquivada'
        and not exists (select 1 from public.ai_lia_rules o where o.anterior_id = r.anterior_id and o.id <> p_id and o.status = 'ativa');
  end if;
  insert into public.audit_logs(company_id, profile_id, table_name, record_id, action, old_data, new_data)
  values (c, auth.uid(), 'ai_lia_rules', p_id, 'UPDATE', jsonb_build_object('status', r.status), jsonb_build_object('status', 'arquivada'));
end $$;

revoke all on function public.lia_rule_propose(text,text,text,text,uuid) from public, anon;
revoke all on function public.lia_rule_activate(uuid) from public, anon;
revoke all on function public.lia_rule_archive(uuid) from public, anon;
grant execute on function public.lia_rule_propose(text,text,text,text,uuid) to authenticated;
grant execute on function public.lia_rule_activate(uuid) to authenticated;
grant execute on function public.lia_rule_archive(uuid) to authenticated;
commit;
