begin;
-- Caixa: saldo inicial por conta e visao de saldos + compromissos futuros.
-- Aditivo: nao altera baixas, contas nem vencimentos existentes.
alter table public.receiving_accounts add column if not exists opening_balance numeric(14,2) not null default 0;
alter table public.receiving_accounts add column if not exists opening_date date;

-- Saldos por conta (saldo inicial + baixas a partir da data inicial) e o que vence ate p_days.
-- security invoker: vale a permissao financeira de quem consulta. Vendas nao recebidas nao entram no saldo.
create or replace function public.cash_overview(p_days integer default 30)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
  with company as (select public.current_company_id() as id),
  horizon as (select least(greatest(coalesce(p_days,30),1),366) as days),
  moves as (
    select p.receiving_account_id as account_id, e.entry_type::text as kind, p.amount, p.paid_at
    from public.payments p
    join public.financial_entries e on e.id=p.financial_entry_id and e.company_id=p.company_id
    where p.company_id=(select id from company) and p.reversed_at is null
  ),
  accounts as (
    select a.id, a.name, a.active, a.opening_balance, a.opening_date,
      coalesce(sum(m.amount) filter (where m.kind='receber'),0) as inflow,
      coalesce(sum(m.amount) filter (where m.kind='pagar'),0) as outflow
    from public.receiving_accounts a
    left join moves m on m.account_id=a.id and (a.opening_date is null or m.paid_at>=a.opening_date)
    where a.company_id=(select id from company)
    group by a.id
  ),
  f as (
    select e.id, e.company_id, e.entry_type::text as kind, e.due_date, e.open_amount, e.paid_amount
    from public.financial_entries e
    where e.company_id=(select id from company) and e.open_amount>0 and e.status::text not in ('cancelado','pago')
  ),
  parts as (
    select f.id, f.kind, i.due_date, i.amount, f.paid_amount,
      coalesce(sum(i.amount) over (partition by f.id order by i.installment_number, i.id rows between unbounded preceding and 1 preceding),0) as prior_amount
    from f join public.financial_installments i on i.financial_entry_id=f.id and i.company_id=f.company_id
  ),
  cashflows as (
    select kind, due_date, greatest(amount-greatest(paid_amount-prior_amount,0),0) as amount from parts
    union all
    select f.kind, f.due_date, f.open_amount from f where not exists(select 1 from parts p where p.id=f.id)
  )
  select jsonb_build_object(
    'today', current_date,
    'days', (select days from horizon),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active,'opening_balance',opening_balance,'opening_date',opening_date,
        'inflow',inflow,'outflow',outflow,'balance',opening_balance+inflow-outflow) order by active desc, name) from accounts),'[]'::jsonb),
    'unassigned', (select jsonb_build_object('inflow',coalesce(sum(amount) filter (where kind='receber'),0),'outflow',coalesce(sum(amount) filter (where kind='pagar'),0))
        from moves where account_id is null),
    'overdue_receivable', (select coalesce(sum(amount),0) from cashflows where kind='receber' and due_date<current_date and amount>0),
    'overdue_payable', (select coalesce(sum(amount),0) from cashflows where kind='pagar' and due_date<current_date and amount>0),
    'undated', (select coalesce(sum(amount),0) from cashflows where due_date is null and amount>0),
    'flows', coalesce((select jsonb_agg(jsonb_build_object('date',due_date,'receivable',receivable,'payable',payable) order by due_date) from (
        select due_date, coalesce(sum(amount) filter (where kind='receber'),0) as receivable, coalesce(sum(amount) filter (where kind='pagar'),0) as payable
        from cashflows where amount>0 and due_date between current_date and current_date+(select days from horizon) group by due_date) d),'[]'::jsonb)
  );
$$;
revoke all on function public.cash_overview(integer) from public,anon;
grant execute on function public.cash_overview(integer) to authenticated;
commit;
