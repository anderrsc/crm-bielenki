begin;
-- Rateio de uma conta entre obras (pedidos) e centros de custos. Aditivo: nenhuma
-- conta, baixa ou vencimento existente e alterado. A soma fecha exatamente o total.
create table if not exists public.financial_entry_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entry_id uuid not null references public.financial_entries(id) on delete cascade,
  order_id uuid references public.orders(id),
  cost_center_id uuid,
  amount numeric(14,2) not null check(amount > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint financial_allocation_target check(order_id is not null or cost_center_id is not null),
  constraint financial_allocation_center_fk foreign key(cost_center_id,company_id) references public.financial_cost_centers(id,company_id)
);
create index if not exists financial_allocations_entry_idx on public.financial_entry_allocations(entry_id);
create index if not exists financial_allocations_order_idx on public.financial_entry_allocations(company_id,order_id);
create index if not exists financial_allocations_center_idx on public.financial_entry_allocations(cost_center_id,company_id);
create index if not exists financial_allocations_created_by_idx on public.financial_entry_allocations(created_by);
alter table public.financial_entry_allocations enable row level security;
revoke all on public.financial_entry_allocations from public,anon,authenticated;
grant select on public.financial_entry_allocations to authenticated;
drop policy if exists allocations_select on public.financial_entry_allocations;
create policy allocations_select on public.financial_entry_allocations for select to authenticated
  using(company_id=(select public.current_company_id()) and (select public.has_table_access('financial_entries','select')));

-- Grava o rateio inteiro de uma vez. p_rows: [{order_id?, cost_center_id?, amount? | percent?}].
-- Lista vazia remove o rateio. Percentuais precisam somar 100; valores, o total da conta.
create or replace function public.set_financial_entry_allocations(p_entry_id uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid := public.current_company_id(); entry record; item jsonb; n integer := 0; total_rows integer;
        by_percent boolean; pct numeric; pct_sum numeric := 0; v_amount numeric(14,2); assigned numeric(14,2) := 0;
        o uuid; cc uuid; previous jsonb; seen text[] := '{}'; pair text;
begin
  if c is null or not public.has_table_access('financial_entries','update') then
    raise exception 'Sem permissao para ratear contas' using errcode='42501';
  end if;
  select id,company_id,total_amount,status into entry from public.financial_entries where id=p_entry_id and company_id=c for update;
  if entry.id is null then raise exception 'Conta nao encontrada'; end if;
  if entry.status::text='cancelado' then raise exception 'Conta cancelada nao pode ser rateada'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Rateio invalido'; end if;
  total_rows := jsonb_array_length(p_rows);
  if total_rows > 50 then raise exception 'Rateio com linhas demais'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('order_id',order_id,'cost_center_id',cost_center_id,'amount',amount) order by created_at,id),'[]'::jsonb)
    into previous from public.financial_entry_allocations where entry_id=p_entry_id;
  delete from public.financial_entry_allocations where entry_id=p_entry_id;
  by_percent := total_rows > 0 and (p_rows->0) ? 'percent' and nullif(p_rows->0->>'percent','') is not null;
  for item in select value from jsonb_array_elements(p_rows) loop
    n := n + 1;
    o := nullif(item->>'order_id','')::uuid; cc := nullif(item->>'cost_center_id','')::uuid;
    if o is null and cc is null then raise exception 'Informe a obra ou o centro de custos em cada linha'; end if;
    if o is not null and not exists(select 1 from public.orders where id=o and company_id=c) then raise exception 'Obra invalida'; end if;
    if cc is not null and not exists(select 1 from public.financial_cost_centers where id=cc and company_id=c and active) then raise exception 'Centro de custos indisponivel'; end if;
    pair := coalesce(o::text,'-')||'|'||coalesce(cc::text,'-');
    if pair = any(seen) then raise exception 'Obra e centro de custos repetidos no rateio'; end if;
    seen := seen || pair;
    if by_percent then
      pct := nullif(item->>'percent','')::numeric;
      if pct is null or pct <= 0 then raise exception 'Percentual invalido'; end if;
      pct_sum := pct_sum + pct;
      -- A ultima linha recebe a sobra dos centavos para fechar exatamente o total.
      v_amount := case when n = total_rows then entry.total_amount - assigned else round(entry.total_amount * pct / 100, 2) end;
    else
      v_amount := round(nullif(item->>'amount','')::numeric, 2);
    end if;
    if v_amount is null or v_amount <= 0 then raise exception 'Valor invalido no rateio'; end if;
    assigned := assigned + v_amount;
    insert into public.financial_entry_allocations(company_id,entry_id,order_id,cost_center_id,amount,created_by) values(c,p_entry_id,o,cc,v_amount,auth.uid());
  end loop;
  if by_percent and pct_sum <> 100 then raise exception 'Os percentuais precisam somar 100 (somam %)', pct_sum; end if;
  if total_rows > 0 and assigned <> entry.total_amount then
    raise exception 'A soma do rateio (%) precisa ser igual ao total da conta (%)', assigned, entry.total_amount;
  end if;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values(c,auth.uid(),'financial_entry_allocations',p_entry_id,'UPDATE',previous,
      (select coalesce(jsonb_agg(jsonb_build_object('order_id',order_id,'cost_center_id',cost_center_id,'amount',amount) order by created_at,id),'[]'::jsonb)
         from public.financial_entry_allocations where entry_id=p_entry_id));
  return n;
end $$;
revoke all on function public.set_financial_entry_allocations(uuid,jsonb) from public,anon;
grant execute on function public.set_financial_entry_allocations(uuid,jsonb) to authenticated;

-- Resultado por obra sem contar nada duas vezes: conta rateada entra so pela parte
-- rateada; conta sem rateio ligada a venda da obra entra inteira.
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
commit;
