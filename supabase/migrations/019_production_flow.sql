-- Migration 019 — Production flow steps + responsible per checklist

-- Tipo de fluxo e etapa atual na ordem de producao
alter table public.production_orders
  add column if not exists flow_type text not null default 'calhas'
    check (flow_type in ('calhas','esquadrias')),
  add column if not exists current_step integer not null default 1;

-- Log de etapas de producao (responsavel + timestamp por etapa)
create table if not exists public.production_step_logs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  step_number      integer not null,
  step_name        text not null,
  started_at       timestamptz,
  completed_at     timestamptz,
  responsible_id   uuid references public.profiles(id),
  notes            text,
  created_at       timestamptz default now()
);

alter table public.production_step_logs enable row level security;

drop policy if exists "psl_company_isolation" on public.production_step_logs;
create policy "psl_company_isolation" on public.production_step_logs
  using (company_id = (select company_id from profiles where id = auth.uid()));

-- Responsavel por item do checklist de instalacao
alter table public.installation_checklists
  add column if not exists responsible_id uuid references public.profiles(id);

-- Deadline de instalacao para checklist (15 dias apos fechamento do pedido, item 10)
alter table public.installation_checklists
  add column if not exists deadline date;

-- Index para busca por producao
create index if not exists idx_production_step_logs_order
  on public.production_step_logs(company_id, production_order_id, step_number);

create index if not exists idx_production_orders_flow
  on public.production_orders(company_id, flow_type, current_step);
