-- Extrato por conta: tudo que entrou e saiu de uma conta num período, com saldo
-- anterior e saldo linha a linha. Mesma regra do caixa (cash_overview): baixas não
-- estornadas, contadas a partir da data do saldo inicial da conta. Respeita a RLS.
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
     and p.paid_at >= v_start and p.paid_at < p_from;

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
       and p.paid_at between greatest(p_from, v_start) and p_to
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
revoke all on function public.account_statement(uuid, date, date) from public, anon;
grant execute on function public.account_statement(uuid, date, date) to authenticated;
