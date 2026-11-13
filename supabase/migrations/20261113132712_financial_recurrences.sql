begin;
-- Recurrences are forecasts until explicitly materialized. No automatic payment.
create table if not exists public.financial_recurrences (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 description text not null check(length(btrim(description)) between 3 and 180),
 entry_type public.financial_entry_type not null,kind text not null default 'normal' check(kind in ('normal','payroll')),
 amount numeric(14,2) not null check(amount between 0.01 and 999999999999.99),
 starts_on date not null,ends_on date not null,day_of_month integer not null check(day_of_month between 1 and 31),
 interval_months integer not null default 1 check(interval_months in (1,3,6,12)),
 category_id uuid,cost_center_id uuid,active boolean not null default true,
 created_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(starts_on>=date '1900-01-01' and ends_on<=date '2100-12-31' and ends_on>=starts_on and ends_on<=starts_on+interval '10 years'),check(kind<>'payroll' or entry_type='pagar'),
 unique(id,company_id),
 foreign key(category_id,company_id,entry_type) references public.financial_categories(id,company_id,entry_type),
 foreign key(cost_center_id,company_id) references public.financial_cost_centers(id,company_id)
);
create unique index if not exists recurring_entry_company_key on public.financial_entries(id,company_id);
create table if not exists public.financial_recurrence_occurrences (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 recurrence_id uuid not null,month date not null check(month=date_trunc('month',month)::date),
 entry_id uuid not null,created_by uuid references public.profiles(id),created_at timestamptz not null default now(),
 unique(recurrence_id,month),unique(entry_id),
 foreign key(recurrence_id,company_id) references public.financial_recurrences(id,company_id),
 foreign key(entry_id,company_id) references public.financial_entries(id,company_id)
);
create index if not exists recurrence_company_idx on public.financial_recurrences(company_id,active,kind);
create index if not exists recurrence_category_idx on public.financial_recurrences(category_id,company_id,entry_type);
create index if not exists recurrence_center_idx on public.financial_recurrences(cost_center_id,company_id);
create index if not exists recurrence_creator_idx on public.financial_recurrences(created_by);
create index if not exists recurrence_occurrence_company_idx on public.financial_recurrence_occurrences(company_id,recurrence_id,month);
create index if not exists recurrence_occurrence_creator_idx on public.financial_recurrence_occurrences(created_by);
insert into public.permissions(role,resource,can_view,can_create,can_update,can_delete)
 select role,resource,
   role::text in ('administrador','gerente') or resource='financial_recurrences' and role::text='financeiro',
   role::text in ('administrador','gerente') or resource='financial_recurrences' and role::text='financeiro',
   role::text in ('administrador','gerente') or resource='financial_recurrences' and role::text='financeiro',false
 from unnest(enum_range(null::public.app_role)) role cross join unnest(array['financial_recurrences','financial_payroll']) resource on conflict(role,resource) do nothing;
alter table public.financial_recurrences enable row level security;
alter table public.financial_recurrence_occurrences enable row level security;
revoke all on public.financial_recurrences,public.financial_recurrence_occurrences from public,anon,authenticated;
grant select on public.financial_recurrences,public.financial_recurrence_occurrences to authenticated;
drop policy if exists recurrence_read on public.financial_recurrences;
create policy recurrence_read on public.financial_recurrences for select to authenticated using(
 company_id=(select public.current_company_id()) and (select public.has_table_access('financial_recurrences','select'))
 and (kind<>'payroll' or (select public.has_table_access('financial_payroll','select')))
 and exists(select 1 from public.profiles where id=(select auth.uid()) and status='ativo'));
drop policy if exists recurrence_occurrence_read on public.financial_recurrence_occurrences;
create policy recurrence_occurrence_read on public.financial_recurrence_occurrences for select to authenticated using(
 company_id=(select public.current_company_id()) and exists(select 1 from public.financial_recurrences r where r.id=recurrence_id and r.company_id=financial_recurrence_occurrences.company_id));

create or replace function crm_private.recurrence_context(p_action text,p_kind text default 'normal') returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=public.current_company_id();begin
 if auth.uid() is null or c is null or not exists(select 1 from public.profiles where id=auth.uid() and company_id=c and status='ativo')
 or not public.has_table_access('financial_recurrences','select') or not public.has_table_access('financial_recurrences',p_action)
 or (p_kind='payroll' and (not public.has_table_access('financial_payroll','select') or not public.has_table_access('financial_payroll',p_action))) then
 raise exception 'Sem permissao para esta recorrencia' using errcode='42501';end if;return c;end $$;
revoke all on function crm_private.recurrence_context(text,text) from public,anon;
grant usage on schema crm_private to authenticated;
grant execute on function crm_private.recurrence_context(text,text) to authenticated;

create or replace function crm_private.save_financial_recurrence(p_id uuid,p_data jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid;previous public.financial_recurrences;result public.financial_recurrences;k text:=coalesce(p_data->>'kind','normal');begin
 c:=crm_private.recurrence_context(case when p_id is null then 'insert' else 'update' end,k);
 if length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Informe a justificativa';end if;
 if p_id is not null then
  select * into previous from public.financial_recurrences where id=p_id and company_id=c for update;
  if previous.id is null then raise exception 'Recorrencia indisponivel';end if;
  perform crm_private.recurrence_context('update',previous.kind);
  if previous.kind<>k or previous.entry_type::text<>p_data->>'entry_type' then raise exception 'Tipo e natureza nao podem ser alterados. Pause e cadastre outra recorrencia';end if;
 end if;
 if not public.has_table_access('financial_entries','select') then raise exception 'Sem acesso financeiro' using errcode='42501';end if;
 if nullif(p_data->>'category_id','') is not null and not exists(select 1 from public.financial_categories where id=(p_data->>'category_id')::uuid and company_id=c and active and entry_type::text=p_data->>'entry_type') then raise exception 'Categoria indisponivel';end if;
 if nullif(p_data->>'cost_center_id','') is not null and not exists(select 1 from public.financial_cost_centers where id=(p_data->>'cost_center_id')::uuid and company_id=c and active) then raise exception 'Centro de custos indisponivel';end if;
 insert into public.financial_recurrences(id,company_id,description,entry_type,kind,amount,starts_on,ends_on,day_of_month,interval_months,category_id,cost_center_id,active,created_by)
 values(coalesce(p_id,gen_random_uuid()),c,btrim(p_data->>'description'),(p_data->>'entry_type')::public.financial_entry_type,k,(p_data->>'amount')::numeric,(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,
 (p_data->>'day_of_month')::integer,(p_data->>'interval_months')::integer,nullif(p_data->>'category_id','')::uuid,nullif(p_data->>'cost_center_id','')::uuid,coalesce((p_data->>'active')::boolean,true),auth.uid())
 on conflict(id) do update set description=excluded.description,amount=excluded.amount,starts_on=excluded.starts_on,ends_on=excluded.ends_on,day_of_month=excluded.day_of_month,
 interval_months=excluded.interval_months,category_id=excluded.category_id,cost_center_id=excluded.cost_center_id,active=excluded.active,updated_at=now()
 returning * into result;
 insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
 values(c,auth.uid(),'financial_recurrences',result.id,case when p_id is null then 'INSERT' else 'UPDATE' end,to_jsonb(previous),to_jsonb(result)||jsonb_build_object('reason',btrim(p_reason)));
 return result.id;end $$;
revoke all on function crm_private.save_financial_recurrence(uuid,jsonb,text) from public,anon;
grant execute on function crm_private.save_financial_recurrence(uuid,jsonb,text) to authenticated;
create or replace function public.save_financial_recurrence(p_id uuid,p_data jsonb,p_reason text) returns uuid language sql security invoker set search_path=pg_catalog as $$select crm_private.save_financial_recurrence(p_id,p_data,p_reason)$$;
revoke all on function public.save_financial_recurrence(uuid,jsonb,text) from public,anon;
grant execute on function public.save_financial_recurrence(uuid,jsonb,text) to authenticated;

create or replace function public.financial_recurrence_forecast(p_end date) returns table(recurrence_id uuid,month date,due_date date,amount numeric,entry_type text,kind text,description text)
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
 begin
 if not public.has_table_access('financial_recurrences','select') then return;end if;
 perform crm_private.recurrence_context('select');
 return query select r.id,m.d::date,d.due,r.amount,r.entry_type::text,r.kind,r.description
 from public.financial_recurrences r cross join lateral generate_series(date_trunc('month',r.starts_on)::date,date_trunc('month',least(r.ends_on,p_end))::date,make_interval(months=>r.interval_months)) m(d)
 cross join lateral (select least(m.d::date+r.day_of_month-1,(m.d+interval '1 month -1 day')::date) due) d
 where r.active and r.company_id=crm_private.recurrence_context('select') and d.due between r.starts_on and least(r.ends_on,p_end)
 and not exists(select 1 from public.financial_recurrence_occurrences o where o.recurrence_id=r.id and o.company_id=r.company_id and o.month=m.d::date)
 order by d.due,r.id;
 end;
$$;
revoke all on function public.financial_recurrence_forecast(date) from public,anon;
grant execute on function public.financial_recurrence_forecast(date) to authenticated;

create or replace function crm_private.materialize_financial_recurrence(p_id uuid,p_month date,p_reason text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid;r public.financial_recurrences;existing uuid;due date;entry uuid;months integer;begin
 c:=crm_private.recurrence_context('update');
 select * into r from public.financial_recurrences where id=p_id and company_id=c for update;
 if r.id is null then raise exception 'Recorrencia indisponivel';end if;
 perform crm_private.recurrence_context('update',r.kind);
 if not public.has_table_access('financial_entries','insert') or not public.has_table_access('financial_entries','select') then raise exception 'Sem permissao para criar contas' using errcode='42501';end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Informe a justificativa';end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Competencia invalida';end if;
 select entry_id into existing from public.financial_recurrence_occurrences where recurrence_id=r.id and month=p_month;
 if existing is not null then return existing;end if;
 due:=least(p_month+r.day_of_month-1,(p_month+interval '1 month -1 day')::date);
 months:=(extract(year from p_month)::int-extract(year from r.starts_on)::int)*12+extract(month from p_month)::int-extract(month from r.starts_on)::int;
 if not r.active or due not between r.starts_on and r.ends_on or months<0 or months%r.interval_months<>0 then raise exception 'Mes fora da programacao ativa';end if;
 insert into public.financial_entries(company_id,entry_type,origin,description,total_amount,due_date,competence_date,category_id,cost_center_id,notes)
 values(c,r.entry_type,'manual',r.description||' · '||to_char(p_month,'MM/YYYY'),r.amount,due,p_month,r.category_id,r.cost_center_id,btrim(p_reason)) returning id into entry;
 insert into public.financial_recurrence_occurrences(company_id,recurrence_id,month,entry_id,created_by) values(c,r.id,p_month,entry,auth.uid());
 insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,new_data)
 values(c,auth.uid(),'financial_recurrences',r.id,'MATERIALIZE',jsonb_build_object('month',p_month,'entry_id',entry,'amount',r.amount,'reason',btrim(p_reason)));
 return entry;end $$;
revoke all on function crm_private.materialize_financial_recurrence(uuid,date,text) from public,anon;
grant execute on function crm_private.materialize_financial_recurrence(uuid,date,text) to authenticated;
create or replace function public.materialize_financial_recurrence(p_id uuid,p_month date,p_reason text) returns uuid language sql security invoker set search_path=pg_catalog as $$select crm_private.materialize_financial_recurrence(p_id,p_month,p_reason)$$;
revoke all on function public.materialize_financial_recurrence(uuid,date,text) from public,anon;
grant execute on function public.materialize_financial_recurrence(uuid,date,text) to authenticated;
create or replace function crm_private.cash_ledger_overview(p_days integer default 30)
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
revoke all on function crm_private.cash_ledger_overview(integer) from public,anon;
grant execute on function crm_private.cash_ledger_overview(integer) to authenticated;
create or replace function public.cash_overview(p_days integer default 30) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
 with base as (select crm_private.cash_ledger_overview(p_days) data),
 limits as (select (data->>'today')::date today,(data->>'today')::date+(data->>'days')::integer until from base),
 recurring as (
  select f.due_date,f.amount,f.entry_type,f.kind from public.financial_recurrence_forecast((select until from limits)) f
  where public.has_table_access('financial_recurrences','select')
 ),
 purchases as (
  select p.expected_at due_date,p.open_amount amount,'pagar'::text entry_type,'purchase'::text kind from public.purchase_orders p
  where p.company_id=public.current_company_id() and public.has_table_access('financial_entries','select') and public.has_table_access('purchase_orders','select')
  and p.status in ('pedido_enviado_ao_fornecedor','recebido_parcial','recebido_completo') and p.open_amount>0
  and not exists(select 1 from public.financial_entries e where e.purchase_order_id=p.id and e.company_id=p.company_id)
 ), extra as (select * from recurring union all select * from purchases),
 flows as (
  select (f->>'date')::date d,(f->>'receivable')::numeric receivable,(f->>'payable')::numeric payable from base cross join lateral jsonb_array_elements(data->'flows') f
  union all select due_date,case when entry_type='receber' then amount else 0 end,case when entry_type='pagar' then amount else 0 end
  from extra where due_date between (select today from limits) and (select until from limits)
 )
 select data||jsonb_build_object(
  'overdue_receivable',(data->>'overdue_receivable')::numeric+coalesce((select sum(amount) from extra where entry_type='receber' and due_date<(select today from limits)),0),
  'overdue_payable',(data->>'overdue_payable')::numeric+coalesce((select sum(amount) from extra where entry_type='pagar' and due_date<(select today from limits)),0),
  'undated',(data->>'undated')::numeric+coalesce((select sum(amount) from extra where due_date is null),0),
  'forecast_sources',jsonb_build_object('recurrences',public.has_table_access('financial_recurrences','select'),'payroll',public.has_table_access('financial_payroll','select'),'purchases',public.has_table_access('purchase_orders','select'),
   'pending_occurrences',(select count(*) from recurring),'unposted_purchases',(select count(*) from purchases)),
  'flows',coalesce((select jsonb_agg(jsonb_build_object('date',d,'receivable',receivable,'payable',payable) order by d) from (select d,sum(receivable) receivable,sum(payable) payable from flows group by d) totals),'[]'::jsonb)
 ) from base;
$$;
revoke all on function public.cash_overview(integer) from public,anon;
grant execute on function public.cash_overview(integer) to authenticated;
commit;
