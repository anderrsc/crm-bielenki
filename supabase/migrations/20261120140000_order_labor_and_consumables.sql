-- Fase 4 — Custos Automáticos e Lucratividade
-- Tabelas de mão de obra e insumos/consumíveis por obra, integradas à v_order_result.

-- ─── Mão de obra por obra ─────────────────────────────────────────────────────
create table if not exists public.order_labor_costs (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 order_id uuid not null references public.orders(id) on delete cascade,
 profile_id uuid not null references public.profiles(id),
 service_type text not null, -- corte, dobra, instalação, medição, etc.
 hours_planned numeric(10,2) not null default 0 check(hours_planned >= 0),
 hours_actual numeric(10,2) not null default 0 check(hours_actual >= 0),
 cost_per_hour numeric(14,2) not null check(cost_per_hour > 0 and cost_per_hour < 10000),
 total_cost numeric(14,2) generated always as (round(hours_actual * cost_per_hour, 2)) stored,
 notes text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create index if not exists idx_order_labor_costs_order on public.order_labor_costs(company_id, order_id);
create index if not exists idx_order_labor_costs_profile on public.order_labor_costs(profile_id);

alter table public.order_labor_costs enable row level security;
drop policy if exists order_labor_costs_select on public.order_labor_costs;
drop policy if exists order_labor_costs_select on public.order_labor_costs;
create policy order_labor_costs_select on public.order_labor_costs for select to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('financial_entries', 'select'));
drop policy if exists order_labor_costs_insert on public.order_labor_costs;
drop policy if exists order_labor_costs_insert on public.order_labor_costs;
create policy order_labor_costs_insert on public.order_labor_costs for insert to authenticated
 with check (company_id = public.current_company_id() and public.has_table_access('financial_entries', 'update'));
drop policy if exists order_labor_costs_update on public.order_labor_costs;
drop policy if exists order_labor_costs_update on public.order_labor_costs;
create policy order_labor_costs_update on public.order_labor_costs for update to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('financial_entries', 'update'))
 with check (company_id = public.current_company_id());
drop policy if exists order_labor_costs_delete on public.order_labor_costs;
drop policy if exists order_labor_costs_delete on public.order_labor_costs;
create policy order_labor_costs_delete on public.order_labor_costs for delete to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('financial_entries', 'update'));

-- Trigger updated_at
create or replace trigger order_labor_costs_touch_updated_at
 before update on public.order_labor_costs
 for each row execute function public.touch_updated_at();

-- ─── Insumos / consumíveis por obra ──────────────────────────────────────────
create table if not exists public.order_consumables (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 order_id uuid not null references public.orders(id) on delete cascade,
 description text not null,
 unit text not null default 'un',
 quantity numeric(14,3) not null check(quantity > 0),
 unit_cost numeric(14,2) not null check(unit_cost >= 0 and unit_cost < 100000),
 total_cost numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
 category text, -- parafuso, silicone, vedante, rebite, etc.
 notes text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create index if not exists idx_order_consumables_order on public.order_consumables(company_id, order_id);

alter table public.order_consumables enable row level security;
drop policy if exists order_consumables_select on public.order_consumables;
drop policy if exists order_consumables_select on public.order_consumables;
create policy order_consumables_select on public.order_consumables for select to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('financial_entries', 'select'));
drop policy if exists order_consumables_insert on public.order_consumables;
drop policy if exists order_consumables_insert on public.order_consumables;
create policy order_consumables_insert on public.order_consumables for insert to authenticated
 with check (company_id = public.current_company_id() and public.has_table_access('financial_entries', 'update'));
drop policy if exists order_consumables_update on public.order_consumables;
drop policy if exists order_consumables_update on public.order_consumables;
create policy order_consumables_update on public.order_consumables for update to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('financial_entries', 'update'))
 with check (company_id = public.current_company_id());
drop policy if exists order_consumables_delete on public.order_consumables;
drop policy if exists order_consumables_delete on public.order_consumables;
create policy order_consumables_delete on public.order_consumables for delete to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('financial_entries', 'update'));

-- Trigger updated_at
create or replace trigger order_consumables_touch_updated_at
 before update on public.order_consumables
 for each row execute function public.touch_updated_at();

-- ─── Atualiza v_order_result para incluir mão de obra e insumos ──────────────
-- DROP necessário porque CREATE OR REPLACE VIEW não permite renomear colunas existentes
drop view if exists public.v_order_result cascade;
create view public.v_order_result with (security_invoker=true) as
with alloc as (
 select a.order_id, a.company_id,
 sum(round(a.amount * e.total_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='pagar') as cost_total,
 sum(round(a.amount * e.paid_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='pagar') as cost_paid,
 sum(round(a.amount * e.total_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='receber' and e.sale_id is null) as extra_revenue
 from public.financial_entry_allocations a
 join public.financial_entries e on e.id=a.entry_id and e.company_id=a.company_id and e.status::text<>'cancelado'
 join (select entry_id, sum(amount) total from public.financial_entry_allocations group by entry_id) t on t.entry_id=a.entry_id
 where a.order_id is not null
 group by a.order_id, a.company_id
), direct as (
 select o.id as order_id,
 sum(e.total_amount) filter (where po.id is null or po.status='recebido_completo') as cost_total,
 sum(e.paid_amount) filter (where po.id is null or po.status='recebido_completo') as cost_paid,
 sum(e.total_amount) filter (where po.id is not null and po.status<>'recebido_completo') as committed
 from public.orders o
 join public.financial_entries e on e.company_id=o.company_id and e.entry_type::text='pagar' and e.status::text<>'cancelado'
 left join public.purchase_orders po on po.id=e.purchase_order_id and po.company_id=o.company_id and po.order_id=o.id and po.status not in ('cancelado','cancelada')
 where (e.sale_id=o.sale_id or po.id is not null)
 and not exists(select 1 from public.financial_entry_allocations a where a.entry_id=e.id)
 group by o.id
), labor as (
 select order_id, sum(total_cost) as labor_cost, sum(hours_actual) as labor_hours
 from public.order_labor_costs group by order_id
), consumables as (
 select order_id, sum(total_cost) as consumables_cost
 from public.order_consumables group by order_id
), aluminum as (
 select order_id, total_cost as aluminum_cost, aluminum_kg
 from public.order_aluminum_costs
)
select o.id as order_id, o.company_id, o.order_number, o.sale_id, o.sale_type_id, o.operational_status, o.created_at,
 c.name as client_name,
 s.total + coalesce(al.extra_revenue,0) as revenue,
 s.paid_amount as received,
 o.expected_cost,
 coalesce(d.committed,0) as cost_committed,
 coalesce(al.cost_total,0) + coalesce(d.cost_total,0) as cost_materials,
 coalesce(lb.labor_cost,0) as cost_labor,
 coalesce(cn.consumables_cost,0) as cost_consumables,
 coalesce(alu.aluminum_cost,0) as cost_aluminum,
 coalesce(al.cost_total,0) + coalesce(d.cost_total,0) + coalesce(lb.labor_cost,0) + coalesce(cn.consumables_cost,0) as cost_realized,
 coalesce(al.cost_paid,0) + coalesce(d.cost_paid,0) as cost_paid,
 coalesce(lb.labor_hours,0) as labor_hours_total,
 coalesce(alu.aluminum_kg,0) as aluminum_kg_total,
 s.total + coalesce(al.extra_revenue,0) - o.expected_cost as margin_expected,
 s.total + coalesce(al.extra_revenue,0)
 - coalesce(al.cost_total,0) - coalesce(d.cost_total,0)
 - coalesce(lb.labor_cost,0) - coalesce(cn.consumables_cost,0)
 - coalesce(d.committed,0) as margin_current
from public.orders o
join public.sales s on s.id=o.sale_id and s.company_id=o.company_id
left join public.clients c on c.id=o.client_id and c.company_id=o.company_id
left join alloc al on al.order_id=o.id and al.company_id=o.company_id
left join direct d on d.order_id=o.id
left join labor lb on lb.order_id=o.id
left join consumables cn on cn.order_id=o.id
left join aluminum alu on alu.order_id=o.id;

revoke all on public.v_order_result from public,anon;
grant select on public.v_order_result to authenticated;
-- ─── Recria views dependentes para garantir consistência em replays ─────────
drop view if exists public.v_order_financials cascade;
create or replace view public.v_order_financials with (security_invoker=true) as
with alloc as (
  select a.order_id, a.company_id,
    sum(round(a.amount * e.total_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='pagar') as cost_total,
    sum(round(a.amount * e.paid_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='pagar') as cost_paid,
    sum(round(a.amount * e.total_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='receber' and e.sale_id is null) as extra_revenue
  from public.financial_entry_allocations a
  join public.financial_entries e on e.id=a.entry_id and e.company_id=a.company_id and e.status::text<>'cancelado'
  join (select entry_id, sum(amount) total from public.financial_entry_allocations group by entry_id) t on t.entry_id=a.entry_id
  where a.order_id is not null
  group by a.order_id, a.company_id
), direct as (
  select o.id order_id, sum(e.total_amount) cost_total, sum(e.paid_amount) cost_paid
  from public.orders o
  join public.financial_entries e on e.sale_id=o.sale_id and e.company_id=o.company_id and e.entry_type::text='pagar' and e.status::text<>'cancelado'
  where not exists(select 1 from public.financial_entry_allocations a where a.entry_id=e.id)
  group by o.id
)
select o.id as order_id, o.company_id, o.order_number, o.sale_id, c.name as client_name,
  s.total as contracted, s.paid_amount as received, s.open_amount as receivable,
  coalesce(al.extra_revenue,0) as extra_revenue,
  coalesce(al.cost_total,0) + coalesce(d.cost_total,0) as cost_total,
  coalesce(al.cost_paid,0) + coalesce(d.cost_paid,0) as cost_paid,
  s.total + coalesce(al.extra_revenue,0) - coalesce(al.cost_total,0) - coalesce(d.cost_total,0) as margin
from public.orders o
join public.sales s on s.id=o.sale_id and s.company_id=o.company_id
left join public.clients c on c.id=o.client_id and c.company_id=o.company_id
left join alloc al on al.order_id=o.id and al.company_id=o.company_id
left join direct d on d.order_id=o.id;

revoke all on public.v_order_financials from public,anon;
grant select on public.v_order_financials to authenticated;

drop view if exists public.v_order_financial_report cascade;
create or replace view public.v_order_financial_report with (security_invoker=true) as
with alloc as (
  select a.order_id, a.company_id,
    sum(round(a.amount * e.total_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='pagar') as cost_total,
    sum(round(a.amount * e.paid_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='pagar') as cost_paid,
    sum(round(a.amount * e.total_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='receber' and e.sale_id is null) as extra_revenue,
    sum(round(a.amount * e.paid_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='receber' and e.sale_id is null) as extra_received,
    sum(round(a.amount * e.open_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='receber' and e.sale_id is null) as extra_receivable
  from public.financial_entry_allocations a
  join public.financial_entries e on e.id=a.entry_id and e.company_id=a.company_id and e.status::text<>'cancelado'
  join (select entry_id, sum(amount) total from public.financial_entry_allocations group by entry_id) t on t.entry_id=a.entry_id
  where a.order_id is not null
  group by a.order_id, a.company_id
), direct as (
  select o.id order_id, sum(e.total_amount) cost_total, sum(e.paid_amount) cost_paid
  from public.orders o
  join public.financial_entries e on e.sale_id=o.sale_id and e.company_id=o.company_id and e.entry_type::text='pagar' and e.status::text<>'cancelado'
  where not exists(select 1 from public.financial_entry_allocations a where a.entry_id=e.id)
  group by o.id
)
select o.id as order_id, o.company_id, o.order_number, o.sale_id, c.name as client_name,
  s.total as contracted, s.paid_amount as received, s.open_amount as receivable,
  coalesce(al.extra_revenue,0) as extra_revenue,
  coalesce(al.cost_total,0) + coalesce(d.cost_total,0) as cost_total,
  coalesce(al.cost_paid,0) + coalesce(d.cost_paid,0) as cost_paid,
  s.total + coalesce(al.extra_revenue,0) - coalesce(al.cost_total,0) - coalesce(d.cost_total,0) as margin, true as margin_partial,
  s.paid_amount + coalesce(al.extra_received,0) as received_total,
  s.open_amount + coalesce(al.extra_receivable,0) as receivable_total
from public.orders o
join public.sales s on s.id=o.sale_id and s.company_id=o.company_id
left join public.clients c on c.id=o.client_id and c.company_id=o.company_id
left join alloc al on al.order_id=o.id and al.company_id=o.company_id
left join direct d on d.order_id=o.id;

revoke all on public.v_order_financial_report from public,anon;
grant select on public.v_order_financial_report to authenticated;
