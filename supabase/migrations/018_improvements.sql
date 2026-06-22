-- ============================================================
-- 018 — Melhorias: prazo de instalação em orçamentos,
--       alertas financeiros, fluxo de produção calhas
-- ============================================================

-- Campo de prazo de instalação no orçamento (texto livre)
alter table public.quotes
  add column if not exists installation_deadline text;

-- Campo de validade em dias (além da data) para clareza
alter table public.quotes
  add column if not exists valid_days integer default 30;

-- Atualizar dashboard_summary para incluir alertas financeiros
create or replace function public.dashboard_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  r   jsonb;
begin
  select company_id into cid
    from profiles where id = auth.uid();
  if cid is null then return '{}'::jsonb; end if;

  select jsonb_build_object(
    'month_sales',       coalesce((select sum(total) from sales where company_id=cid and date_trunc('month',created_at)=date_trunc('month',now())),0),
    'receivable',        coalesce((select sum(open_amount) from financial_entries where company_id=cid and entry_type='receber' and status not in ('pago','cancelado')),0),
    'payable',           coalesce((select sum(open_amount) from financial_entries where company_id=cid and entry_type='pagar' and status not in ('pago','cancelado')),0),
    'overdue_receivable',coalesce((select count(*) from financial_entries where company_id=cid and entry_type='receber' and status not in ('pago','cancelado') and due_date < current_date),0),
    'overdue_payable',   coalesce((select count(*) from financial_entries where company_id=cid and entry_type='pagar' and status not in ('pago','cancelado') and due_date < current_date),0),
    'due_today',         coalesce((select count(*) from financial_entries where company_id=cid and status not in ('pago','cancelado') and due_date = current_date),0),
    'blocked_orders',    coalesce((select count(*) from orders where company_id=cid and operational_status='bloqueado'),0),
    'late_purchases',    coalesce((select count(*) from purchase_orders where company_id=cid and status not in ('recebido','cancelado') and expected_at < current_date),0),
    'waiting_materials', coalesce((select count(*) from production_orders where company_id=cid and status='aguardando_material'),0),
    'late_followups',    coalesce((select count(*) from leads where company_id=cid and status='aberto' and next_action_date < current_date),0),
    'quotes_pending',    coalesce((select count(*) from quotes where company_id=cid and status='enviado'),0),
    'in_production',     coalesce((select count(*) from production_orders where company_id=cid and status='em_producao'),0)
  ) into r;
  return r;
end $$;

-- Garantir que financial_entries tem due_date indexado
create index if not exists idx_financial_entries_due_date
  on public.financial_entries(company_id, due_date)
  where status not in ('pago', 'cancelado');

-- View melhorada de entradas financeiras com alerta de vencimento
create or replace view public.v_financial_entries as
select
  fe.id,
  fe.description,
  fe.entry_type,
  fe.total_amount,
  fe.paid_amount,
  fe.open_amount,
  fe.due_date,
  fe.status,
  case
    when fe.status = 'pago' then 'pago'
    when fe.status = 'cancelado' then 'cancelado'
    when fe.due_date < current_date then 'vencido'
    when fe.due_date = current_date then 'vence_hoje'
    when fe.status = 'parcialmente_pago' then 'parcialmente_pago'
    else 'aguardando_pagamento'
  end as display_status,
  c.name as client_name,
  s.name as supplier_name,
  fe.created_at
from financial_entries fe
left join clients c on c.id = fe.client_id
left join suppliers s on s.id = fe.supplier_id;

