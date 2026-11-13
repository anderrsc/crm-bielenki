begin;
-- Cash as of the Brazilian business day; future settlements remain projected.
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.receiving_accounts'::regclass and conname='cash_opening_finite') then
    alter table public.receiving_accounts add constraint cash_opening_finite check(opening_balance between -999999999999.99 and 999999999999.99);
  end if;
end $$;
create or replace function public.cash_overview(p_days integer default 30)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
  with company as (select public.current_company_id() as id),
  horizon as (select least(greatest(coalesce(p_days,30),1),366) as days),
  moves as (
    select p.receiving_account_id as account_id, e.entry_type::text as kind, p.amount, p.paid_at
    from public.payments p
    join public.financial_entries e on e.id=p.financial_entry_id and e.company_id=p.company_id
    where p.company_id=(select id from company) and p.reversed_at is null and p.paid_at <= (now() at time zone 'America/Sao_Paulo')::date
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
    union all
    select e.entry_type::text,p.paid_at,p.amount from public.payments p
    join public.financial_entries e on e.id=p.financial_entry_id and e.company_id=p.company_id
    where p.company_id=(select id from company) and p.reversed_at is null and p.paid_at>(now() at time zone 'America/Sao_Paulo')::date
  )
  select jsonb_build_object(
    'today', (now() at time zone 'America/Sao_Paulo')::date,
    'days', (select days from horizon),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active,'opening_balance',opening_balance,'opening_date',opening_date,
        'inflow',inflow,'outflow',outflow,'balance',case when opening_date>(now() at time zone 'America/Sao_Paulo')::date then 0 else opening_balance+inflow-outflow end) order by active desc, name) from accounts),'[]'::jsonb),
    'unassigned', (select jsonb_build_object('inflow',coalesce(sum(amount) filter (where kind='receber'),0),'outflow',coalesce(sum(amount) filter (where kind='pagar'),0))
        from moves where account_id is null),
    'overdue_receivable', (select coalesce(sum(amount),0) from cashflows where kind='receber' and due_date<(now() at time zone 'America/Sao_Paulo')::date and amount>0),
    'overdue_payable', (select coalesce(sum(amount),0) from cashflows where kind='pagar' and due_date<(now() at time zone 'America/Sao_Paulo')::date and amount>0),
    'undated', (select coalesce(sum(amount),0) from cashflows where due_date is null and amount>0),
    'flows', coalesce((select jsonb_agg(jsonb_build_object('date',due_date,'receivable',receivable,'payable',payable) order by due_date) from (
        select due_date, coalesce(sum(amount) filter (where kind='receber'),0) as receivable, coalesce(sum(amount) filter (where kind='pagar'),0) as payable
        from cashflows where amount>0 and due_date between (now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date+(select days from horizon) group by due_date) d),'[]'::jsonb)
  );
$$;
revoke all on function public.cash_overview(integer) from public,anon;
grant execute on function public.cash_overview(integer) to authenticated;
create or replace function public.guard_cash_opening_balance() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if (tg_op='INSERT' and (new.opening_balance<>0 or new.opening_date is not null)) or
     (tg_op='UPDATE' and (new.opening_balance,new.opening_date) is distinct from (old.opening_balance,old.opening_date)) then
    if current_user not in ('postgres','service_role') then
      if new.company_id is distinct from public.current_company_id() or not public.has_table_access('financial_entries','update') then
        raise exception 'Sem permissao para alterar saldo inicial' using errcode='42501';
      end if;
      if new.opening_date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Saldo inicial nao pode ter data futura'; end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_cash_opening_balance() from public,anon,authenticated;
drop trigger if exists cash_opening_guard on public.receiving_accounts;
create trigger cash_opening_guard before insert or update on public.receiving_accounts for each row execute function public.guard_cash_opening_balance();

create or replace function crm_private.audit_cash_opening_balance() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous jsonb; following jsonb;
begin
  if tg_table_schema<>'public' or tg_table_name<>'receiving_accounts' then raise exception 'Unsupported audit target'; end if;
  if tg_op='UPDATE' then
    if (new.opening_balance,new.opening_date) is not distinct from (old.opening_balance,old.opening_date) then return new; end if;
    previous:=jsonb_build_object('opening_balance',old.opening_balance,'opening_date',old.opening_date);
  end if;
  following:=jsonb_build_object('opening_balance',new.opening_balance,'opening_date',new.opening_date);
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values(new.company_id,auth.uid(),'receiving_accounts',new.id,tg_op,previous,following);
  return new;
end $$;
revoke all on function crm_private.audit_cash_opening_balance() from public,anon,authenticated;
drop trigger if exists cash_opening_audit on public.receiving_accounts;
create trigger cash_opening_audit after insert or update on public.receiving_accounts for each row execute function crm_private.audit_cash_opening_balance();
commit;
