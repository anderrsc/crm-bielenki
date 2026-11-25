-- Ajustes do recibo automático (revisão de 25/11/2026).
-- 1) Status "sem_confirmacao": o WhatsApp não confirmou o envio. Não reenvia sozinho
--    (evita recibo em dobro); a equipe confere a conversa e reenvia se precisar.
-- 2) Reenviar: não aceita recibo que está sendo enviado agora (duplo clique) e
--    esquece a mensagem anterior, para mandar de novo de verdade.
-- 3) Estorno de recibo já enviado: continua cancelado, mas guarda que o cliente recebeu
--    (sent_at) para a tela avisar a equipe.
-- 4) O recibo substitui a mensagem antiga "Pagamento confirmado" (texto com saldo por
--    conta, que divergia do saldo do pedido e chegava em dobro).

alter table public.payment_receipts drop constraint if exists payment_receipts_status_check;
alter table public.payment_receipts add constraint payment_receipts_status_check
  check (status in ('pendente', 'processando', 'enviado', 'sem_confirmacao', 'sem_whatsapp', 'falhou', 'cancelado', 'historico'));

create or replace function public.cancel_payment_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reversed_at is not null and old.reversed_at is null then
    update public.payment_receipts
       set status = 'cancelado',
           last_error = case when status in ('enviado', 'sem_confirmacao')
             then 'Pagamento estornado depois de o recibo ser enviado ao cliente. Avise o cliente que o recibo nº '
                  || lpad(receipt_number::text, 6, '0') || ' foi cancelado.'
             else coalesce(new.reversal_notes, 'Pagamento estornado') end,
           sent_at = case when status = 'sem_confirmacao' then coalesce(sent_at, updated_at) else sent_at end,
           updated_at = now()
     where payment_id = new.id;
  end if;
  return new;
end $$;

create or replace function public.retry_payment_receipt(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.payment_receipts;
begin
  perform public.require_table_access('payments', 'insert');
  select * into r from public.payment_receipts where payment_id = p_payment and company_id = public.current_company_id() for update;
  if r.id is null then raise exception using errcode = 'P0001', message = 'Recibo não encontrado.'; end if;
  if r.status = 'cancelado' then raise exception using errcode = 'P0001', message = 'Pagamento estornado: o recibo foi cancelado.'; end if;
  if r.status = 'processando' and r.locked_at > now() - interval '10 minutes' then
    raise exception using errcode = 'P0001', message = 'O recibo está sendo enviado agora. Aguarde um instante.'; end if;
  update public.payment_receipts set status = 'pendente', attempts = 0, last_error = null, locked_at = null, message_id = null,
    created_at = greatest(created_at, now() - interval '2 days'), updated_at = now()
   where id = r.id;
end $$;

-- Mensagem antiga de pagamento confirmado: desligada (o recibo já avisa o cliente).
update public.automation_rules set enabled = false where automation_type = 'payment_confirmation' and enabled;
create or replace function public.queue_payment_confirmation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Substituída pelo recibo automático (public.payment_receipts).
  return new;
end $$;

revoke all on function public.cancel_payment_receipt() from public, anon, authenticated;
revoke all on function public.retry_payment_receipt(uuid) from public, anon;
grant execute on function public.retry_payment_receipt(uuid) to authenticated;
revoke all on function public.queue_payment_confirmation() from public, anon, authenticated;
