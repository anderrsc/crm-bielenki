-- Comandos da Lia pelo WhatsApp (/entrada, /saida, /baixa, /compra, /desfazer, /editar...).
-- Só números cadastrados em lia_command_phones usam comandos. Tudo que grava passa por
-- confirmação (resumo + "sim") antes de chegar aqui. As funções rodam "como" o usuário do
-- CRM ligado ao número: valem as mesmas regras, permissões e gatilhos das telas.
begin;

create table if not exists public.lia_command_phones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{10,15}$'),
  label text not null check (length(btrim(label)) between 1 and 60),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, phone)
);
alter table public.lia_command_phones enable row level security;
-- Sem políticas: só o servidor (service role) lê. A tela de configuração pode vir depois.

create table if not exists public.lia_command_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  phone text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  op text not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'confirmado', 'cancelado', 'expirado', 'desfeito', 'falhou')),
  command_text text,
  fields jsonb not null default '{}'::jsonb,
  choose jsonb,
  summary text,
  result jsonb,
  target_id uuid references public.lia_command_log(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lia_command_log_phone_idx on public.lia_command_log(company_id, phone, created_at desc);
alter table public.lia_command_log enable row level security;
drop policy if exists lia_command_log_read on public.lia_command_log;
create policy lia_command_log_read on public.lia_command_log for select to authenticated
  using (company_id = (select public.current_company_id()));

-- Números liberados: o do Anderson e o do financeiro, na empresa Marquinhos.
-- Usuário do CRM: o que tem o telefone cadastrado no perfil; senão o primeiro administrador ativo.
do $$
declare c uuid; admin uuid; p uuid; rec record;
begin
  select id into c from public.companies where regexp_replace(coalesce(tax_id, ''), '[^0-9]', '', 'g') = '26887887000175' limit 1;
  if c is null then return; end if;
  select pr.id into admin from public.profiles pr
    join public.user_roles ur on ur.profile_id = pr.id and ur.role::text = 'administrador'
   where pr.company_id = c and pr.status = 'ativo' order by pr.created_at limit 1;
  if admin is null then
    select id into admin from public.profiles where company_id = c and status = 'ativo' order by created_at limit 1;
  end if;
  if admin is null then return; end if;
  for rec in select * from (values ('5547999756637', 'Anderson'), ('554730584839', 'Financeiro')) v(phone, label) loop
    select id into p from public.profiles
     where company_id = c and status = 'ativo'
       and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 8) = right(rec.phone, 8)
     limit 1;
    insert into public.lia_command_phones(company_id, phone, label, profile_id)
    values (c, rec.phone, rec.label, coalesce(p, admin))
    on conflict (company_id, phone) do nothing;
  end loop;
end $$;

-- Executa uma operação confirmada. Só o servidor chama (service role).
create or replace function public.lia_command_execute(p_company uuid, p_profile uuid, p_action jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  op text := p_action->>'op';
  v_type public.financial_entry_type;
  v_entry uuid; v_entry2 uuid; v_pay uuid; v_pay2 uuid;
  v_amount numeric; v_date date; v_method text; v_desc text; v_account uuid; v_account2 uuid;
  v_client uuid; v_supplier uuid; v_category uuid; v_due date;
  r record; out jsonb := '{}'::jsonb;
begin
  if not exists (select 1 from public.profiles where id = p_profile and company_id = p_company and status = 'ativo') then
    raise exception 'Usuário do comando inválido';
  end if;
  -- A partir daqui as funções do CRM enxergam este usuário (auth.uid()).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_profile, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_profile::text, true);

  v_amount := round(nullif(p_action->>'valor', '')::numeric, 2);
  v_date := coalesce(nullif(p_action->>'data', '')::date, current_date);
  v_method := coalesce(nullif(p_action->>'metodo', ''), 'pix');
  v_desc := left(btrim(coalesce(p_action->>'descricao', '')), 200);
  v_account := nullif(p_action->>'conta_id', '')::uuid;
  v_account2 := nullif(p_action->>'conta_destino_id', '')::uuid;
  v_client := nullif(p_action->>'client_id', '')::uuid;
  v_supplier := nullif(p_action->>'supplier_id', '')::uuid;
  v_category := nullif(p_action->>'categoria_id', '')::uuid;
  v_due := nullif(p_action->>'vencimento', '')::date;

  -- Estorno (/desfazer) ou correção (/editar último): desfaz o que o comando anterior fez.
  -- Na correção acontece na mesma transação do novo lançamento: se o novo falhar, nada muda.
  if op = 'estornar' or p_action ? 'substituir' then
    for r in select value::uuid as id from jsonb_array_elements_text(coalesce(p_action->'substituir'->'payment_ids', p_action->'payment_ids', '[]'::jsonb)) loop
      if exists (select 1 from public.payments where id = r.id and company_id = p_company and reversed_at is null) then
        perform public.reverse_payment(r.id, coalesce(nullif(p_action->>'motivo', ''), 'Desfeito pela Lia (comando WhatsApp)'));
      end if;
    end loop;
    for r in select value::uuid as id from jsonb_array_elements_text(coalesce(p_action->'substituir'->'entry_ids', p_action->'entry_ids', '[]'::jsonb)) loop
      update public.financial_entries set status = 'cancelado', updated_at = now()
       where id = r.id and company_id = p_company and paid_amount = 0;
    end loop;
    if op = 'estornar' then return jsonb_build_object('ok', true); end if;
  end if;

  if v_account is not null and not exists (select 1 from public.receiving_accounts where id = v_account and company_id = p_company) then
    raise exception 'Conta inválida'; end if;
  if v_account2 is not null and not exists (select 1 from public.receiving_accounts where id = v_account2 and company_id = p_company) then
    raise exception 'Conta de destino inválida'; end if;

  if op in ('entrada', 'saida') then
    if v_amount is null or v_amount <= 0 then raise exception 'Valor inválido'; end if;
    if v_account is null then raise exception 'Informe a conta'; end if;
    if v_desc = '' then v_desc := case when op = 'entrada' then 'Entrada via WhatsApp' else 'Saída via WhatsApp' end; end if;
    v_type := case when op = 'entrada' then 'receber' else 'pagar' end;
    perform public.require_table_access('financial_entries', 'insert');
    insert into public.financial_entries(company_id, entry_type, origin, client_id, supplier_id, description, total_amount, due_date, category_id, notes)
    values (p_company, v_type, 'manual',
      case when v_type = 'receber' then v_client end, case when v_type = 'pagar' then v_supplier end,
      v_desc, v_amount, v_date, v_category, 'Lançado pela Lia (comando WhatsApp)')
    returning id into v_entry;
    v_pay := public.register_payment_with_supplier_credit(v_entry, v_amount, v_date, v_method, 'Comando WhatsApp', 0, 0, 1, v_date, v_account);
    perform public.set_payment_account(v_pay, v_account);
    -- Entrada sem cliente (venda de balcão) não tem para quem mandar recibo.
    if v_client is null then delete from public.payment_receipts where payment_id = v_pay; end if;
    out := jsonb_build_object('entry_ids', jsonb_build_array(v_entry), 'payment_ids', jsonb_build_array(v_pay));

  elsif op = 'transferir' then
    if v_amount is null or v_amount <= 0 then raise exception 'Valor inválido'; end if;
    if v_account is null or v_account2 is null or v_account = v_account2 then raise exception 'Informe duas contas diferentes'; end if;
    perform public.require_table_access('financial_entries', 'insert');
    v_desc := coalesce(nullif(v_desc, ''), 'Transferência entre contas');
    insert into public.financial_entries(company_id, entry_type, origin, description, total_amount, due_date, notes)
    values (p_company, 'pagar', 'ajuste', v_desc || ' (saída)', v_amount, v_date, 'Transferência pela Lia (comando WhatsApp)') returning id into v_entry;
    v_pay := public.register_payment_with_supplier_credit(v_entry, v_amount, v_date, 'transferencia', 'Comando WhatsApp', 0, 0, 1, v_date, v_account);
    perform public.set_payment_account(v_pay, v_account);
    insert into public.financial_entries(company_id, entry_type, origin, description, total_amount, due_date, notes)
    values (p_company, 'receber', 'ajuste', v_desc || ' (entrada)', v_amount, v_date, 'Transferência pela Lia (comando WhatsApp)') returning id into v_entry2;
    v_pay2 := public.register_payment_with_supplier_credit(v_entry2, v_amount, v_date, 'transferencia', 'Comando WhatsApp', 0, 0, 1, v_date, v_account2);
    perform public.set_payment_account(v_pay2, v_account2);
    delete from public.payment_receipts where payment_id = v_pay2;
    out := jsonb_build_object('entry_ids', jsonb_build_array(v_entry, v_entry2), 'payment_ids', jsonb_build_array(v_pay, v_pay2));

  elsif op = 'baixa' then
    v_entry := nullif(p_action->>'entry_id', '')::uuid;
    if v_entry is null or not exists (select 1 from public.financial_entries where id = v_entry and company_id = p_company) then
      raise exception 'Conta a receber não encontrada'; end if;
    if v_amount is null or v_amount <= 0 then raise exception 'Valor inválido'; end if;
    v_pay := public.register_payment_with_supplier_credit(v_entry, v_amount, v_date, v_method, 'Baixa pela Lia (comando WhatsApp)', 0, 0, 1, v_date, v_account);
    if v_account is not null then perform public.set_payment_account(v_pay, v_account); end if;
    out := jsonb_build_object('entry_ids', '[]'::jsonb, 'payment_ids', jsonb_build_array(v_pay), 'baixa_entry_id', v_entry);

  elsif op = 'compra' then
    if v_amount is null or v_amount <= 0 then raise exception 'Valor inválido'; end if;
    if v_supplier is null or not exists (select 1 from public.suppliers where id = v_supplier and company_id = p_company) then
      raise exception 'Fornecedor não encontrado'; end if;
    perform public.require_table_access('financial_entries', 'insert');
    insert into public.financial_entries(company_id, entry_type, origin, supplier_id, description, total_amount, due_date, payment_method, category_id, notes)
    values (p_company, 'pagar', 'manual', v_supplier, coalesce(nullif(v_desc, ''), 'Compra via WhatsApp'), v_amount, coalesce(v_due, v_date),
      nullif(p_action->>'metodo', ''), v_category, 'Compra registrada pela Lia (comando WhatsApp)')
    returning id into v_entry;
    out := jsonb_build_object('entry_ids', jsonb_build_array(v_entry), 'payment_ids', '[]'::jsonb);

  elsif op = 'reenviar_recibo' then
    v_pay := nullif(p_action->>'payment_id', '')::uuid;
    perform public.retry_payment_receipt(v_pay);
    out := jsonb_build_object('payment_ids', jsonb_build_array(v_pay));

  else
    raise exception 'Operação desconhecida: %', op;
  end if;
  return out;
end $$;
revoke all on function public.lia_command_execute(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lia_command_execute(uuid, uuid, jsonb) to service_role;

-- Saldo por conta (mesma conta do Caixa: saldo inicial + baixas desde a data inicial).
create or replace function public.lia_command_balances(p_company uuid)
returns table(id uuid, name text, balance numeric) language sql stable security definer set search_path = pg_catalog, public as $$
  select a.id, a.name,
    a.opening_balance
    + coalesce(sum(p.amount) filter (where e.entry_type = 'receber'), 0)
    - coalesce(sum(p.amount) filter (where e.entry_type = 'pagar'), 0)
  from public.receiving_accounts a
  left join public.payments p on p.receiving_account_id = a.id and p.company_id = a.company_id and p.reversed_at is null
    and (a.opening_date is null or p.paid_at >= a.opening_date)
  left join public.financial_entries e on e.id = p.financial_entry_id
  where a.company_id = p_company and a.active
  group by a.id
  order by a.name;
$$;
revoke all on function public.lia_command_balances(uuid) from public, anon, authenticated;
grant execute on function public.lia_command_balances(uuid) to service_role;

commit;
