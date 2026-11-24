begin;
-- LIA V2, fase 1: tabelas do motor de regras e das aprovações humanas.
-- Aditivo: não altera nenhuma tabela existente (ai_lia_rules, da LIA atual, continua como está).
-- Usadas por crm-bielenki-audit/app/(crm)/lia-rules*. Acesso: toda a empresa lê as regras; só gerência cria e altera;
-- qualquer usuário pede aprovação de uma exceção; só gerência aprova ou recusa.

-- ── Regras ───────────────────────────────────────────────────────────────────
create table if not exists public.lia_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  title text check (title is null or length(btrim(title)) between 1 and 200),
  category text check (category is null or length(btrim(category)) between 1 and 80),
  -- Nomes usados pelas ações do servidor (name, rule_type, condition, action); o gatilho abaixo mantém os dois pares iguais.
  name text check (name is null or length(btrim(name)) between 1 and 200),
  rule_type text check (rule_type is null or length(btrim(rule_type)) between 1 and 80),
  description text check (description is null or length(description) <= 2000),
  condition_json jsonb not null default '{}'::jsonb,
  action_json jsonb not null default '{}'::jsonb,
  condition text check (condition is null or length(condition) <= 4000),
  action text check (action is null or length(action) <= 4000),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lia_rules_has_title check (coalesce(title, name) is not null)
);
create index if not exists lia_rules_company_active_idx on public.lia_rules(company_id, is_active, created_at desc);

create or replace function crm_private.lia_rules_sync() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  new.title := coalesce(nullif(btrim(new.title), ''), nullif(btrim(new.name), ''));
  new.name := coalesce(nullif(btrim(new.name), ''), new.title);
  new.category := coalesce(nullif(btrim(new.category), ''), nullif(btrim(new.rule_type), ''));
  new.rule_type := coalesce(nullif(btrim(new.rule_type), ''), new.category);
  new.updated_at := now();
  return new;
end $$;
revoke all on function crm_private.lia_rules_sync() from public, anon, authenticated;
drop trigger if exists lia_rules_sync on public.lia_rules;
create trigger lia_rules_sync before insert or update on public.lia_rules for each row execute function crm_private.lia_rules_sync();

alter table public.lia_rules enable row level security;
drop policy if exists lia_rules_select on public.lia_rules;
create policy lia_rules_select on public.lia_rules for select to authenticated
  using (company_id = (select public.current_company_id()));
drop policy if exists lia_rules_insert on public.lia_rules;
create policy lia_rules_insert on public.lia_rules for insert to authenticated
  with check (company_id = (select public.current_company_id()) and public.has_role(array['administrador','gerente']::public.app_role[]));
drop policy if exists lia_rules_update on public.lia_rules;
create policy lia_rules_update on public.lia_rules for update to authenticated
  using (company_id = (select public.current_company_id()) and public.has_role(array['administrador','gerente']::public.app_role[]))
  with check (company_id = (select public.current_company_id()) and public.has_role(array['administrador','gerente']::public.app_role[]));
revoke all on public.lia_rules from anon;
revoke delete on public.lia_rules from authenticated;  -- regra não se apaga: desativa (is_active = false) e fica no histórico
grant select, insert, update on public.lia_rules to authenticated;
grant select, insert, update, delete on public.lia_rules to service_role;

-- ── Aprovações (exceções às regras financeiras) ─────────────────────────────
create table if not exists public.lia_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  budget_id uuid not null,
  violation_type text not null check (violation_type in ('DOWN_PAYMENT_MINIMUM','INSTALLMENT_MINIMUM')),
  requested_override_value numeric(14,2),
  requested_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  justification text not null check (length(btrim(justification)) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lia_approvals_review_consistent check ((status = 'pending') = (reviewed_at is null))
);
create index if not exists lia_approvals_company_status_idx on public.lia_approvals(company_id, status, created_at desc);
create index if not exists lia_approvals_budget_idx on public.lia_approvals(budget_id);

-- Quem decide é sempre quem está logado; ninguém aprova a própria solicitação nem altera o pedido original.
create or replace function crm_private.lia_approvals_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
    new.requested_by := coalesce(auth.uid(), new.requested_by);
    return new;
  end if;
  if new.budget_id is distinct from old.budget_id or new.violation_type is distinct from old.violation_type
     or new.requested_by is distinct from old.requested_by or new.requested_override_value is distinct from old.requested_override_value
     or new.justification is distinct from old.justification or new.company_id is distinct from old.company_id then
    raise exception 'O pedido de aprovação não pode ser alterado; só a decisão' using errcode = '42501';
  end if;
  if old.status <> 'pending' then raise exception 'Esta solicitação já foi decidida' using errcode = '42501'; end if;
  if new.status <> 'pending' then
    if auth.uid() is not null and auth.uid() = old.requested_by then raise exception 'Quem pediu não pode decidir a própria solicitação' using errcode = '42501'; end if;
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function crm_private.lia_approvals_guard() from public, anon, authenticated;
drop trigger if exists lia_approvals_guard on public.lia_approvals;
create trigger lia_approvals_guard before insert or update on public.lia_approvals for each row execute function crm_private.lia_approvals_guard();

alter table public.lia_approvals enable row level security;
drop policy if exists lia_approvals_select on public.lia_approvals;
create policy lia_approvals_select on public.lia_approvals for select to authenticated
  using (company_id = (select public.current_company_id())
         and (requested_by = (select auth.uid()) or public.has_role(array['administrador','gerente']::public.app_role[])));
drop policy if exists lia_approvals_insert on public.lia_approvals;
create policy lia_approvals_insert on public.lia_approvals for insert to authenticated
  with check (company_id = (select public.current_company_id()) and requested_by = (select auth.uid()));
drop policy if exists lia_approvals_update on public.lia_approvals;
create policy lia_approvals_update on public.lia_approvals for update to authenticated
  using (company_id = (select public.current_company_id()) and public.has_role(array['administrador','gerente']::public.app_role[]))
  with check (company_id = (select public.current_company_id()) and public.has_role(array['administrador','gerente']::public.app_role[]));
revoke all on public.lia_approvals from anon;
revoke delete on public.lia_approvals from authenticated;
grant select, insert, update on public.lia_approvals to authenticated;
grant select, insert, update, delete on public.lia_approvals to service_role;
commit;
