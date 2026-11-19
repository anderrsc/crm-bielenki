-- Cobranças Pix: o "Cobrar via Pix" do Atendimento passa a ficar registrado na conta escolhida.
-- A cobrança enviada aparece no extrato da conta como "aguardando pagamento" (não é dinheiro em caixa);
-- ao confirmar o recebimento, vira baixa naquela conta e entra no saldo e no extrato.
create table if not exists public.pix_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  receiving_account_id uuid not null references public.receiving_accounts(id),
  account_name text not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  financial_entry_id uuid references public.financial_entries(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  description text not null check (length(trim(description)) between 1 and 200),
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'aguardando' check (status in ('aguardando', 'recebida', 'cancelada')),
  payment_id uuid references public.payments(id) on delete set null,
  paid_at date,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz
);
create index if not exists pix_charges_account_idx on public.pix_charges(company_id, receiving_account_id, status, created_at desc);
create index if not exists pix_charges_conversation_idx on public.pix_charges(conversation_id, created_at desc);
alter table public.pix_charges enable row level security;
-- Ver: quem vê o financeiro, ou quem enviou a cobrança. Gravar e mudar só pelas funções abaixo.
drop policy if exists pix_charges_read on public.pix_charges;
create policy pix_charges_read on public.pix_charges for select to authenticated
  using (company_id = (select public.current_company_id())
    and ((select public.has_table_access('financial_entries', 'select')) or created_by = (select auth.uid())));
grant select on public.pix_charges to authenticated;

-- Registra a cobrança que acabou de ser enviada. Tudo precisa ser da mesma empresa.
create or replace function public.record_pix_charge(
  p_account uuid, p_amount numeric, p_description text,
  p_conversation uuid default null, p_client uuid default null, p_entry uuid default null, p_quote uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid := public.current_company_id(); acc public.receiving_accounts; v_client uuid := p_client; v_id uuid;
begin
  if c is null or auth.uid() is null then raise exception using errcode = 'P0001', message = 'Sessão expirada. Entre novamente.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception using errcode = 'P0001', message = 'Valor da cobrança inválido.'; end if;
  select * into acc from public.receiving_accounts where id = p_account and company_id = c;
  if acc.id is null then raise exception using errcode = 'P0001', message = 'Conta de recebimento não encontrada.'; end if;
  if p_conversation is not null and not exists (select 1 from public.conversations where id = p_conversation and company_id = c) then
    raise exception using errcode = 'P0001', message = 'Conversa não encontrada.'; end if;
  if v_client is not null and not exists (select 1 from public.clients where id = v_client and company_id = c) then v_client := null; end if;
  if p_entry is not null then
    select coalesce(v_client, client_id) into v_client from public.financial_entries where id = p_entry and company_id = c and entry_type::text = 'receber';
    if not found then raise exception using errcode = 'P0001', message = 'Conta a receber não encontrada.'; end if;
  end if;
  if p_quote is not null then
    select coalesce(v_client, client_id) into v_client from public.quotes where id = p_quote and company_id = c;
    if not found then raise exception using errcode = 'P0001', message = 'Orçamento não encontrado.'; end if;
  end if;
  insert into public.pix_charges(company_id, receiving_account_id, account_name, conversation_id, client_id, financial_entry_id, quote_id, description, amount)
  values (c, acc.id, acc.name, p_conversation, v_client, p_entry, p_quote, left(coalesce(nullif(trim(p_description), ''), 'Cobrança Pix'), 200), round(p_amount, 2))
  returning id into v_id;
  return v_id;
end $$;

-- Confirma que o Pix caiu: dá baixa na conta a receber certa, na conta escolhida na cobrança.
-- Cobrança de orçamento: usa a conta a receber da venda (o orçamento precisa estar aprovado).
-- Cobrança avulsa: cria a conta a receber e já dá baixa.
create or replace function public.confirm_pix_charge(p_charge uuid, p_paid_at date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid := public.current_company_id(); ch public.pix_charges; e public.financial_entries; v_entry uuid; v_sale uuid; v_payment uuid;
begin
  perform public.require_table_access('payments', 'insert');
  select * into ch from public.pix_charges where id = p_charge and company_id = c for update;
  if ch.id is null then raise exception using errcode = 'P0001', message = 'Cobrança não encontrada.'; end if;
  if ch.status <> 'aguardando' then raise exception using errcode = 'P0001', message = 'Esta cobrança já foi ' || case when ch.status = 'recebida' then 'recebida.' else 'cancelada.' end; end if;
  if p_paid_at is null or p_paid_at > current_date + 1 then raise exception using errcode = 'P0001', message = 'Data do recebimento inválida.'; end if;

  v_entry := ch.financial_entry_id;
  if v_entry is null and ch.quote_id is not null then
    select sale_id into v_sale from public.quotes where id = ch.quote_id and company_id = c;
    if v_sale is null then raise exception using errcode = 'P0001', message = 'Aprove o orçamento antes de confirmar: a aprovação cria a conta a receber onde o Pix entra.'; end if;
    select id into v_entry from public.financial_entries
     where company_id = c and sale_id = v_sale and entry_type::text = 'receber' and status::text <> 'cancelado' and open_amount > 0
     order by due_date nulls last, created_at limit 1;
    if v_entry is null then raise exception using errcode = 'P0001', message = 'A venda deste orçamento não tem saldo em aberto.'; end if;
  end if;
  if v_entry is null then
    perform public.require_table_access('financial_entries', 'insert');
    insert into public.financial_entries(company_id, entry_type, origin, client_id, description, total_amount, due_date, notes)
    values (c, 'receber', 'manual', ch.client_id, ch.description, ch.amount, p_paid_at, 'Cobrança Pix enviada pelo Atendimento.')
    returning id into v_entry;
  end if;

  select * into e from public.financial_entries where id = v_entry and company_id = c;
  if e.id is null or e.status::text = 'cancelado' then raise exception using errcode = 'P0001', message = 'A conta a receber desta cobrança foi cancelada.'; end if;
  if ch.amount > e.open_amount + 0.009 then
    raise exception using errcode = 'P0001', message = 'O valor cobrado é maior que o saldo em aberto (' || to_char(e.open_amount, 'FM999G999G990D00') || '). Dê a baixa pelo Financeiro.';
  end if;
  v_payment := public.register_payment_with_adjustment(e.id, ch.amount, p_paid_at, 'pix', 'Cobrança Pix (' || ch.account_name || ')',
    e.interest_amount, e.discount_amount, greatest(1, e.installment_count), coalesce(e.first_installment_due_date, e.due_date, p_paid_at));
  perform public.set_payment_account(v_payment, ch.receiving_account_id);
  update public.pix_charges set status = 'recebida', payment_id = v_payment, paid_at = p_paid_at, financial_entry_id = e.id,
    resolved_by = auth.uid(), resolved_at = now() where id = ch.id;
  return v_payment;
end $$;

-- Cancela a cobrança que não vai ser paga (não mexe no financeiro).
create or replace function public.cancel_pix_charge(p_charge uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ch public.pix_charges;
begin
  select * into ch from public.pix_charges where id = p_charge and company_id = public.current_company_id() for update;
  if ch.id is null then raise exception using errcode = 'P0001', message = 'Cobrança não encontrada.'; end if;
  if ch.created_by is distinct from auth.uid() and public.has_table_access('payments', 'insert') is not true then
    raise exception using errcode = 'P0001', message = 'Só quem enviou ou o financeiro pode cancelar a cobrança.'; end if;
  if ch.status <> 'aguardando' then raise exception using errcode = 'P0001', message = 'Só dá para cancelar cobrança aguardando pagamento.'; end if;
  update public.pix_charges set status = 'cancelada', resolved_by = auth.uid(), resolved_at = now() where id = ch.id;
end $$;

revoke all on function public.record_pix_charge(uuid, numeric, text, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.confirm_pix_charge(uuid, date) from public, anon;
revoke all on function public.cancel_pix_charge(uuid) from public, anon;
grant execute on function public.record_pix_charge(uuid, numeric, text, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.confirm_pix_charge(uuid, date) to authenticated;
grant execute on function public.cancel_pix_charge(uuid) to authenticated;
