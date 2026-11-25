-- Recibo de pagamento automático.
-- Toda baixa de conta a receber (Financeiro, "Lançar no financeiro" do Atendimento,
-- Pix "Recebido", venda manual com valor já recebido...) grava um pagamento em
-- public.payments. O gatilho abaixo cria o recibo numerado na mesma transação, então
-- nenhum caminho de baixa fica sem recibo. O servidor gera o PDF e envia ao cliente
-- pelo WhatsApp (fila processada logo após a baixa e, de reserva, pelo agendador).

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_id uuid not null unique references public.payments(id) on delete cascade,
  financial_entry_id uuid references public.financial_entries(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  receipt_number integer not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'enviado', 'sem_whatsapp', 'falhou', 'cancelado', 'historico')),
  attempts integer not null default 0,
  last_error text,
  locked_at timestamptz,
  pdf_path text,
  phone text,
  message_id uuid,
  sent_at timestamptz,
  snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, receipt_number)
);
create index if not exists payment_receipts_queue_idx on public.payment_receipts(status, created_at);
create index if not exists payment_receipts_entry_idx on public.payment_receipts(financial_entry_id);
create index if not exists payment_receipts_client_idx on public.payment_receipts(client_id);

alter table public.payment_receipts enable row level security;
drop policy if exists payment_receipts_read on public.payment_receipts;
create policy payment_receipts_read on public.payment_receipts for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('payments', 'select')));
grant select on public.payment_receipts to authenticated;

-- Cria o recibo da baixa (só contas a receber). Número sequencial por empresa.
create or replace function public.create_payment_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
declare e public.financial_entries; v_number integer;
begin
  select * into e from public.financial_entries where id = new.financial_entry_id;
  if e.id is null or e.entry_type::text <> 'receber' then return new; end if;
  perform pg_advisory_xact_lock(hashtext('payment_receipt:' || new.company_id::text));
  select coalesce(max(receipt_number), 0) + 1 into v_number from public.payment_receipts where company_id = new.company_id;
  insert into public.payment_receipts(company_id, payment_id, financial_entry_id, client_id, receipt_number)
  values (new.company_id, new.id, e.id, e.client_id, v_number)
  on conflict (payment_id) do nothing;
  return new;
end $$;

drop trigger if exists payments_create_receipt on public.payments;
create trigger payments_create_receipt after insert on public.payments
  for each row execute function public.create_payment_receipt();

-- Baixa estornada: o recibo deixa de valer e sai da fila (se ainda não foi enviado).
create or replace function public.cancel_payment_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reversed_at is not null and old.reversed_at is null then
    update public.payment_receipts
       set status = 'cancelado', last_error = coalesce(new.reversal_notes, 'Pagamento estornado'), updated_at = now()
     where payment_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists payments_cancel_receipt on public.payments;
create trigger payments_cancel_receipt after update of reversed_at on public.payments
  for each row execute function public.cancel_payment_receipt();

-- Fila (somente servidor): reserva recibos para gerar/enviar, sem dois processos pegarem o mesmo.
-- Pega: pendentes; com falha (até 5 tentativas, a cada 5 min); travados há mais de 10 min.
create or replace function public.claim_payment_receipts(p_limit integer default 5, p_payment uuid default null)
returns setof public.payment_receipts language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.payment_receipts r
     set status = 'processando', locked_at = now(), attempts = r.attempts + 1, updated_at = now()
   where r.id in (
     select x.id from public.payment_receipts x
      where (p_payment is null or x.payment_id = p_payment)
        and x.created_at > now() - interval '3 days'
        and (x.status = 'pendente'
          or (x.status = 'falhou' and x.attempts < 5 and x.updated_at < now() - interval '5 minutes')
          or (x.status = 'processando' and x.locked_at < now() - interval '10 minutes'))
      order by x.created_at
      limit greatest(1, least(coalesce(p_limit, 5), 20))
      for update skip locked)
  returning r.*;
end $$;

-- Reenviar (botão no CRM): volta o recibo para a fila.
create or replace function public.retry_payment_receipt(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.payment_receipts;
begin
  perform public.require_table_access('payments', 'insert');
  select * into r from public.payment_receipts where payment_id = p_payment and company_id = public.current_company_id() for update;
  if r.id is null then raise exception using errcode = 'P0001', message = 'Recibo não encontrado.'; end if;
  if r.status = 'cancelado' then raise exception using errcode = 'P0001', message = 'Pagamento estornado: o recibo foi cancelado.'; end if;
  update public.payment_receipts set status = 'pendente', attempts = 0, last_error = null, locked_at = null,
    created_at = greatest(created_at, now() - interval '2 days'), updated_at = now()
   where id = r.id;
end $$;

-- Recibo para as baixas que já existiam: número reservado, sem envio (não dispara para o passado).
do $$
declare p record; n integer;
begin
  for p in
    select pay.id, pay.company_id, pay.financial_entry_id, e.client_id, pay.reversed_at
      from public.payments pay join public.financial_entries e on e.id = pay.financial_entry_id
     where e.entry_type::text = 'receber'
       and not exists (select 1 from public.payment_receipts r where r.payment_id = pay.id)
     order by pay.company_id, pay.created_at, pay.id
  loop
    select coalesce(max(receipt_number), 0) + 1 into n from public.payment_receipts where company_id = p.company_id;
    insert into public.payment_receipts(company_id, payment_id, financial_entry_id, client_id, receipt_number, status, last_error, created_at)
    values (p.company_id, p.id, p.financial_entry_id, p.client_id, n,
            case when p.reversed_at is null then 'historico' else 'cancelado' end,
            'Baixa anterior ao recibo automático (não enviada).', now() - interval '4 days');
  end loop;
end $$;

-- PDFs dos recibos: privados, leitura pela empresa.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('payment-receipts', 'payment-receipts', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

revoke all on function public.create_payment_receipt() from public, anon, authenticated;
revoke all on function public.cancel_payment_receipt() from public, anon, authenticated;
revoke all on function public.claim_payment_receipts(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_payment_receipts(integer, uuid) to service_role;
revoke all on function public.retry_payment_receipt(uuid) from public, anon;
grant execute on function public.retry_payment_receipt(uuid) to authenticated;
