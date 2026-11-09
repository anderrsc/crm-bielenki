-- Contas onde a empresa recebe (Pix de cada CNPJ/CPF, bancos, caixa) e em qual conta caiu cada pagamento.
create table if not exists public.receiving_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  details text check (details is null or length(details) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists receiving_accounts_company_idx on public.receiving_accounts(company_id, active, name);
alter table public.receiving_accounts enable row level security;
drop policy if exists receiving_accounts_rls on public.receiving_accounts;
create policy receiving_accounts_rls on public.receiving_accounts for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant select, insert, update on public.receiving_accounts to authenticated;

alter table public.payments add column if not exists receiving_account_id uuid references public.receiving_accounts(id) on delete set null;
alter table public.payments add column if not exists receiving_account_name text;

-- Liga o pagamento recém-registrado à conta (mesma empresa, só quem pode registrar pagamento).
create or replace function public.set_payment_account(p_payment_id uuid, p_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare acc public.receiving_accounts;
begin
  perform public.require_table_access('payments', 'insert');
  select * into acc from public.receiving_accounts where id = p_account_id and company_id = public.current_company_id();
  if acc.id is null then raise exception 'Conta de recebimento não encontrada'; end if;
  update public.payments set receiving_account_id = acc.id, receiving_account_name = acc.name
    where id = p_payment_id and company_id = public.current_company_id();
  if not found then raise exception 'Pagamento não encontrado'; end if;
end $$;
revoke all on function public.set_payment_account(uuid, uuid) from public;
grant execute on function public.set_payment_account(uuid, uuid) to authenticated;
