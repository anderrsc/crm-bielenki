begin;
-- Resultado por obra com previsto, comprometido e realizado. Aditivo: as views
-- existentes (v_order_financials, v_order_financial_report) nao sao alteradas.
alter table public.orders add column if not exists expected_cost numeric(14,2);
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.orders'::regclass and conname='orders_expected_cost_check') then
    alter table public.orders add constraint orders_expected_cost_check check(expected_cost is null or expected_cost >= 0);
  end if;
end $$;

-- Custo previsto da obra: so quem pode alterar o financeiro. Fica registrado na auditoria.
create or replace function public.set_order_expected_cost(p_order_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid := public.current_company_id(); previous numeric;
begin
  if c is null or not public.has_table_access('financial_entries','update') then raise exception 'Sem permissao para alterar o custo previsto' using errcode='42501'; end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 999999999) then raise exception 'Valor invalido'; end if;
  select expected_cost into previous from public.orders where id=p_order_id and company_id=c for update;
  if not found then raise exception 'Obra nao encontrada'; end if;
  update public.orders set expected_cost=round(p_amount,2) where id=p_order_id;
  if previous is distinct from round(p_amount,2) then
    insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
      values(c,auth.uid(),'orders',p_order_id,'UPDATE',jsonb_build_object('expected_cost',previous),jsonb_build_object('expected_cost',round(p_amount,2)));
  end if;
end $$;
revoke all on function public.set_order_expected_cost(uuid,numeric) from public,anon;
grant execute on function public.set_order_expected_cost(uuid,numeric) to authenticated;

-- Uma linha por obra, sem contar nada duas vezes:
--  realizado    = contas a pagar rateadas para a obra + contas sem rateio ligadas a venda ou a uma compra ja recebida;
--  comprometido = contas de compras da obra cujo material ainda nao chegou por completo;
--  previsto     = custo informado na obra.
create or replace view public.v_order_result with (security_invoker=true) as
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
  -- Contas a pagar sem rateio ligadas a venda da obra ou a uma compra feita para ela.
  -- A compra ja gera a conta a pagar; enquanto o material nao chegou por completo, o valor conta como comprometido.
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
)
select o.id as order_id, o.company_id, o.order_number, o.sale_id, o.sale_type_id, o.operational_status, o.created_at,
  c.name as client_name,
  s.total + coalesce(al.extra_revenue,0) as revenue,
  s.paid_amount as received,
  o.expected_cost,
  coalesce(d.committed,0) as cost_committed,
  coalesce(al.cost_total,0) + coalesce(d.cost_total,0) as cost_realized,
  coalesce(al.cost_paid,0) + coalesce(d.cost_paid,0) as cost_paid,
  s.total + coalesce(al.extra_revenue,0) - o.expected_cost as margin_expected,
  s.total + coalesce(al.extra_revenue,0) - coalesce(al.cost_total,0) - coalesce(d.cost_total,0) - coalesce(d.committed,0) as margin_current
from public.orders o
join public.sales s on s.id=o.sale_id and s.company_id=o.company_id
left join public.clients c on c.id=o.client_id and c.company_id=o.company_id
left join alloc al on al.order_id=o.id and al.company_id=o.company_id
left join direct d on d.order_id=o.id;
revoke all on public.v_order_result from public,anon;
grant select on public.v_order_result to authenticated;
commit;
