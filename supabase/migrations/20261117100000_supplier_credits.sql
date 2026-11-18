begin;
-- Credito com fornecedores: valor pago a mais numa conta a pagar, adiantamento ou
-- abatimento combinado. O saldo e usado para quitar contas futuras do mesmo fornecedor.
-- Aditivo: contas, baixas e saldos existentes nao mudam.
create table if not exists public.supplier_credits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  supplier_id uuid not null references public.suppliers(id),
  -- Positivo entra no credito; negativo e uso do credito.
  amount numeric(14,2) not null check (amount <> 0),
  kind text not null check (kind in ('excedente','adiantamento','abatimento','uso','estorno_uso','ajuste')),
  financial_entry_id uuid references public.financial_entries(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  -- Conta de onde o dinheiro saiu (so para excedente e adiantamento).
  account_id uuid references public.receiving_accounts(id) on delete set null,
  moved_at date not null default (now() at time zone 'America/Sao_Paulo')::date,
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists supplier_credits_supplier_idx on public.supplier_credits(company_id, supplier_id, created_at desc);
create index if not exists supplier_credits_entry_idx on public.supplier_credits(financial_entry_id);
create unique index if not exists supplier_credits_payment_use_key on public.supplier_credits(payment_id, kind) where payment_id is not null;
create index if not exists supplier_credits_account_idx on public.supplier_credits(account_id);
create index if not exists supplier_credits_created_by_idx on public.supplier_credits(created_by);
alter table public.supplier_credits enable row level security;
revoke all on public.supplier_credits from public, anon, authenticated;
grant select on public.supplier_credits to authenticated;
drop policy if exists supplier_credits_select on public.supplier_credits;
create policy supplier_credits_select on public.supplier_credits for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('financial_entries','select')));

create or replace view public.v_supplier_credit_balance with (security_invoker = true) as
  select sc.company_id, sc.supplier_id, s.name as supplier_name, sum(sc.amount) as balance, max(sc.created_at) as last_move
  from public.supplier_credits sc join public.suppliers s on s.id = sc.supplier_id and s.company_id = sc.company_id
  group by sc.company_id, sc.supplier_id, s.name;
revoke all on public.v_supplier_credit_balance from public, anon;
grant select on public.v_supplier_credit_balance to authenticated;

create or replace function crm_private.supplier_credit_balance(p_company uuid, p_supplier uuid) returns numeric
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(amount), 0) from public.supplier_credits where company_id = p_company and supplier_id = p_supplier;
$$;
revoke all on function crm_private.supplier_credit_balance(uuid, uuid) from public, anon, authenticated;

-- Baixa de conta a pagar que aceita valor maior que o aberto: o que passar vira credito
-- com o fornecedor (saiu da conta informada na data da baixa). Demais casos = baixa normal.
create or replace function public.register_payment_with_supplier_credit(
  p_entry_id uuid, p_amount numeric, p_paid_at date, p_method text, p_notes text default null,
  p_interest numeric default 0, p_discount numeric default 0, p_installments integer default 1,
  p_first_due_date date default null, p_account uuid default null
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare e public.financial_entries; adjusted numeric; open_after numeric; pay numeric; excess numeric; pid uuid;
begin
  perform public.require_table_access('payments','insert');
  perform public.require_table_access('financial_entries','update');
  select * into e from public.financial_entries where id = p_entry_id and company_id = public.current_company_id() for update;
  if e.id is null then raise exception 'Lancamento nao encontrado'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Valor invalido'; end if;
  adjusted := greatest(e.total_amount - e.interest_amount + e.discount_amount + coalesce(p_interest,0) - coalesce(p_discount,0), 0);
  open_after := greatest(adjusted - e.paid_amount, 0);
  pay := least(p_amount, open_after);
  excess := round(p_amount - pay, 2);
  if excess > 0 and (e.entry_type::text <> 'pagar' or e.supplier_id is null) then
    raise exception 'Valor superior ao saldo aberto. Pagamento a mais so vira credito em conta a pagar de fornecedor';
  end if;
  if p_account is not null and not exists(select 1 from public.receiving_accounts where id = p_account and company_id = e.company_id) then
    raise exception 'Conta invalida'; end if;
  if pay > 0 then
    pid := public.register_payment_with_adjustment(p_entry_id, pay, p_paid_at, p_method, p_notes, p_interest, p_discount, p_installments, p_first_due_date);
  end if;
  if excess > 0 then
    insert into public.supplier_credits(company_id, supplier_id, amount, kind, financial_entry_id, payment_id, account_id, moved_at, notes)
      values (e.company_id, e.supplier_id, excess, 'excedente', e.id, pid, p_account, coalesce(p_paid_at, current_date),
        'Pago a mais na conta "' || left(e.description, 200) || '"');
  end if;
  return pid;
end $$;
revoke all on function public.register_payment_with_supplier_credit(uuid,numeric,date,text,text,numeric,numeric,integer,date,uuid) from public, anon;
grant execute on function public.register_payment_with_supplier_credit(uuid,numeric,date,text,text,numeric,numeric,integer,date,uuid) to authenticated;

-- Lancamento direto de credito: adiantamento (saiu dinheiro da conta) ou abatimento
-- combinado/devolucao (sem dinheiro). Ajuste negativo corrige saldo, so gerencia.
create or replace function public.add_supplier_credit(p_supplier uuid, p_amount numeric, p_kind text, p_date date default null, p_account uuid default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare c uuid := public.current_company_id(); v_id uuid;
begin
  perform public.require_table_access('financial_entries','update');
  if p_kind not in ('adiantamento','abatimento','ajuste') then raise exception 'Tipo invalido'; end if;
  if p_amount is null or p_amount = 0 or (p_kind <> 'ajuste' and p_amount < 0) then raise exception 'Valor invalido'; end if;
  if p_kind = 'ajuste' and not exists(select 1 from unnest(public.current_user_roles()) r where r::text in ('administrador','gerente')) then
    raise exception 'Somente a gerencia ajusta o credito' using errcode = '42501'; end if;
  if not exists(select 1 from public.suppliers where id = p_supplier and company_id = c) then raise exception 'Fornecedor invalido'; end if;
  if p_kind = 'adiantamento' and p_account is null then raise exception 'Informe a conta de onde saiu o dinheiro'; end if;
  if p_account is not null and not exists(select 1 from public.receiving_accounts where id = p_account and company_id = c) then raise exception 'Conta invalida'; end if;
  if p_amount < 0 and crm_private.supplier_credit_balance(c, p_supplier) + p_amount < 0 then raise exception 'O ajuste deixaria o credito negativo'; end if;
  if nullif(btrim(coalesce(p_notes,'')),'') is null then raise exception 'Informe o motivo'; end if;
  insert into public.supplier_credits(company_id, supplier_id, amount, kind, account_id, moved_at, notes)
    values (c, p_supplier, round(p_amount, 2), p_kind, case when p_kind = 'adiantamento' then p_account end, coalesce(p_date, current_date), left(btrim(p_notes), 500))
    returning supplier_credits.id into v_id;
  return v_id;
end $$;
revoke all on function public.add_supplier_credit(uuid,numeric,text,date,uuid,text) from public, anon;
grant execute on function public.add_supplier_credit(uuid,numeric,text,date,uuid,text) to authenticated;

-- Usa o credito para quitar (parte de) uma conta a pagar do mesmo fornecedor.
-- Vira uma baixa com forma "credito_fornecedor", que nao conta como saida de dinheiro.
create or replace function public.use_supplier_credit(p_entry_id uuid, p_amount numeric, p_date date default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare e public.financial_entries; balance numeric; pid uuid;
begin
  perform public.require_table_access('payments','insert');
  select * into e from public.financial_entries where id = p_entry_id and company_id = public.current_company_id() for update;
  if e.id is null then raise exception 'Lancamento nao encontrado'; end if;
  if e.entry_type::text <> 'pagar' or e.supplier_id is null then raise exception 'So conta a pagar de fornecedor usa credito'; end if;
  perform pg_advisory_xact_lock(hashtextextended('supplier-credit:' || e.supplier_id::text, 0));
  balance := crm_private.supplier_credit_balance(e.company_id, e.supplier_id);
  if p_amount is null or p_amount <= 0 then raise exception 'Valor invalido'; end if;
  if p_amount > balance then raise exception 'Credito insuficiente: o fornecedor tem % de credito', balance; end if;
  if p_amount > e.open_amount then raise exception 'Valor maior que o aberto da conta'; end if;
  pid := public.register_payment(p_entry_id, p_amount, coalesce(p_date, current_date), 'credito_fornecedor', 'Uso de credito com o fornecedor');
  insert into public.supplier_credits(company_id, supplier_id, amount, kind, financial_entry_id, payment_id, moved_at, notes)
    values (e.company_id, e.supplier_id, -round(p_amount, 2), 'uso', e.id, pid, coalesce(p_date, current_date), 'Usado na conta "' || left(e.description, 200) || '"');
  return pid;
end $$;
revoke all on function public.use_supplier_credit(uuid,numeric,date) from public, anon;
grant execute on function public.use_supplier_credit(uuid,numeric,date) to authenticated;

-- Estornar a baixa feita com credito devolve o credito; estornar a baixa que gerou
-- excedente retira o excedente (se ainda nao foi usado).
create or replace function crm_private.supplier_credit_on_reversal() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r record;
begin
  if new.reversed_at is null or old.reversed_at is not null then return new; end if;
  for r in select * from public.supplier_credits where payment_id = new.id and kind in ('uso','excedente') loop
    insert into public.supplier_credits(company_id, supplier_id, amount, kind, financial_entry_id, payment_id, account_id, moved_at, notes)
      values (r.company_id, r.supplier_id, -r.amount, case when r.kind = 'uso' then 'estorno_uso' else 'ajuste' end, r.financial_entry_id, new.id,
        null, (now() at time zone 'America/Sao_Paulo')::date, 'Estorno da baixa')
      on conflict do nothing;
  end loop;
  return new;
end $$;
revoke all on function crm_private.supplier_credit_on_reversal() from public, anon, authenticated;
drop trigger if exists payments_supplier_credit_reversal on public.payments;
create trigger payments_supplier_credit_reversal after update of reversed_at on public.payments
  for each row execute function crm_private.supplier_credit_on_reversal();

-- Caixa e extrato: baixa com credito nao e saida de dinheiro; excedente e adiantamento sao.
create or replace function crm_private.cash_ledger_overview(p_days integer default 30)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
  with company as (select public.current_company_id() as id),
  horizon as (select least(greatest(coalesce(p_days,30),1),366) as days),
  moves as (
    select p.receiving_account_id as account_id, e.entry_type::text as kind, p.amount, p.paid_at
    from public.payments p
    join public.financial_entries e on e.id=p.financial_entry_id and e.company_id=p.company_id
    where p.company_id=(select id from company) and p.reversed_at is null and p.paid_at <= (now() at time zone 'America/Sao_Paulo')::date
      and coalesce(p.payment_method,'')<>'credito_fornecedor'
    union all
    -- Dinheiro que saiu como credito com fornecedor (valor pago a mais ou adiantamento).
    select sc.account_id, 'pagar', sc.amount, sc.moved_at
    from public.supplier_credits sc
    where sc.company_id=(select id from company) and sc.account_id is not null and sc.kind in ('excedente','adiantamento')
      and sc.moved_at <= (now() at time zone 'America/Sao_Paulo')::date
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
      and coalesce(p.payment_method,'')<>'credito_fornecedor'
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

create or replace function public.account_statement(p_account uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare
  a public.receiving_accounts;
  v_start date;
  v_before numeric := 0;
  v_moves jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception using errcode = 'P0001', message = 'Período inválido.'; end if;
  if p_to - p_from > 1830 then raise exception using errcode = 'P0001', message = 'Escolha um período de até 5 anos.'; end if;
  if public.has_table_access('financial_entries', 'select') is not true then
    raise exception using errcode = 'P0001', message = 'Sem permissão para ver o financeiro.';
  end if;
  select * into a from public.receiving_accounts where id = p_account and company_id = public.current_company_id();
  if a.id is null then raise exception using errcode = 'P0001', message = 'Conta não encontrada.'; end if;

  -- Baixas antes da data do saldo inicial não fazem parte do saldo da conta.
  v_start := coalesce(a.opening_date, '-infinity'::date);
  select coalesce(case when a.opening_date is null or a.opening_date < p_from then a.opening_balance else 0 end, 0)
       + coalesce(sum(case when e.entry_type::text = 'receber' then p.amount else -p.amount end), 0)
    into v_before
    from public.payments p
    join public.financial_entries e on e.id = p.financial_entry_id and e.company_id = p.company_id
   where p.company_id = a.company_id and p.receiving_account_id = a.id and p.reversed_at is null
     and p.paid_at >= v_start and p.paid_at < p_from and coalesce(p.payment_method,'') <> 'credito_fornecedor';
  -- Credito com fornecedor pago por esta conta tambem e saida de dinheiro.
  v_before := v_before - coalesce((select sum(sc.amount) from public.supplier_credits sc
    where sc.company_id = a.company_id and sc.account_id = a.id and sc.kind in ('excedente','adiantamento')
      and sc.moved_at >= v_start and sc.moved_at < p_from), 0);

  with moves as (
    select a.opening_date as data, 0 as ordem, 'saldo_inicial'::text as tipo, 'Saldo inicial da conta'::text as descricao,
           null::text as pessoa, null::text as forma, a.opening_balance as valor, null::timestamptz as criado
     where a.opening_date between p_from and p_to and a.opening_balance <> 0
    union all
    select p.paid_at, 1, case when e.entry_type::text = 'receber' then 'entrada' else 'saida' end,
           e.description, coalesce(c.name, s.name), p.payment_method,
           case when e.entry_type::text = 'receber' then p.amount else -p.amount end, p.created_at
      from public.payments p
      join public.financial_entries e on e.id = p.financial_entry_id and e.company_id = p.company_id
      left join public.clients c on c.id = e.client_id
      left join public.suppliers s on s.id = e.supplier_id
     where p.company_id = a.company_id and p.receiving_account_id = a.id and p.reversed_at is null
       and p.paid_at between greatest(p_from, v_start) and p_to and coalesce(p.payment_method,'') <> 'credito_fornecedor'
    union all
    select sc.moved_at, 1, 'saida', case when sc.kind = 'excedente' then 'Crédito com fornecedor (pago a mais)' else 'Adiantamento a fornecedor' end,
           s.name, null, -sc.amount, sc.created_at
      from public.supplier_credits sc
      left join public.suppliers s on s.id = sc.supplier_id
     where sc.company_id = a.company_id and sc.account_id = a.id and sc.kind in ('excedente','adiantamento')
       and sc.moved_at between greatest(p_from, v_start) and p_to
  ), ordered as (
    select *, v_before + sum(valor) over (order by data, ordem, criado, descricao rows unbounded preceding) as saldo from moves
  )
  select coalesce(jsonb_agg(jsonb_build_object('data', data, 'tipo', tipo, 'descricao', descricao, 'pessoa', pessoa,
           'forma', forma, 'valor', valor, 'saldo', saldo) order by data, ordem, criado, descricao), '[]'::jsonb)
    into v_moves from ordered;

  return jsonb_build_object(
    'conta', jsonb_build_object('id', a.id, 'nome', a.name, 'detalhes', a.details, 'ativa', a.active, 'saldo_inicial_data', a.opening_date),
    'de', p_from, 'ate', p_to,
    'saldo_anterior', v_before,
    'entradas', (select coalesce(sum((m->>'valor')::numeric), 0) from jsonb_array_elements(v_moves) m where m->>'tipo' = 'entrada'),
    'saidas', (select coalesce(-sum((m->>'valor')::numeric), 0) from jsonb_array_elements(v_moves) m where m->>'tipo' = 'saida'),
    'saldo_final', v_before + (select coalesce(sum((m->>'valor')::numeric), 0) from jsonb_array_elements(v_moves) m),
    'movimentos', v_moves
  );
end $$;
commit;
