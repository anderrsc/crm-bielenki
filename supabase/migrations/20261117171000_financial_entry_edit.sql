begin;
-- Corrigir conta lancada errado. Descricao, vencimento e observacao: qualquer conta.
-- Valor e cliente/fornecedor: so contas avulsas (manual/despesa/ajuste); venda e compra
-- se corrigem na venda/compra. Cancelar: so conta sem pagamento valido. Tudo auditado.
create or replace function public.update_financial_entry(p_id uuid, p_description text, p_total numeric, p_due_date date, p_notes text, p_party uuid default null)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare e public.financial_entries; n public.financial_entries; c uuid := public.current_company_id(); avulsa boolean; total numeric;
begin
  perform public.require_table_access('financial_entries','update');
  select * into e from public.financial_entries where id = p_id and company_id = c for update;
  if e.id is null then raise exception 'Lançamento não encontrado'; end if;
  if e.status = 'cancelado' then raise exception 'Conta cancelada não pode ser editada'; end if;
  if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Informe a descrição'; end if;
  avulsa := e.origin in ('manual','despesa','ajuste') and e.sale_id is null and e.purchase_order_id is null;
  total := round(coalesce(p_total, e.total_amount), 2);
  if total <> e.total_amount and not avulsa then raise exception 'O valor desta conta vem da venda/compra. Corrija por lá'; end if;
  if total <= 0 then raise exception 'Valor inválido'; end if;
  if total < e.paid_amount then raise exception 'O valor não pode ficar menor que o já pago (%). Estorne o pagamento antes', e.paid_amount; end if;
  if p_party is not null and avulsa then
    if e.entry_type::text = 'pagar' and not exists(select 1 from public.suppliers where id = p_party and company_id = c) then raise exception 'Fornecedor inválido'; end if;
    if e.entry_type::text = 'receber' and not exists(select 1 from public.clients where id = p_party and company_id = c) then raise exception 'Cliente inválido'; end if;
  end if;
  update public.financial_entries set
    description = left(btrim(p_description), 300),
    total_amount = total,
    due_date = p_due_date,
    notes = nullif(btrim(coalesce(p_notes,'')),''),
    supplier_id = case when avulsa and entry_type::text = 'pagar' then coalesce(p_party, supplier_id) else supplier_id end,
    client_id = case when avulsa and entry_type::text = 'receber' then coalesce(p_party, client_id) else client_id end,
    status = case when paid_amount >= total then 'pago'::public.financial_status when paid_amount > 0 then 'parcialmente_pago'::public.financial_status else 'aguardando_pagamento'::public.financial_status end
    where id = e.id returning * into n;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'financial_entries', e.id, 'EDIT', to_jsonb(e), to_jsonb(n));
end $$;
revoke all on function public.update_financial_entry(uuid,text,numeric,date,text,uuid) from public, anon;
grant execute on function public.update_financial_entry(uuid,text,numeric,date,text,uuid) to authenticated;

create or replace function public.cancel_financial_entry(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare e public.financial_entries; c uuid := public.current_company_id();
begin
  perform public.require_table_access('financial_entries','update');
  select * into e from public.financial_entries where id = p_id and company_id = c for update;
  if e.id is null then raise exception 'Lançamento não encontrado'; end if;
  if e.status = 'cancelado' then raise exception 'Conta já cancelada'; end if;
  if e.sale_id is not null or e.purchase_order_id is not null then raise exception 'Esta conta vem de uma venda/compra. Cancele por lá'; end if;
  if exists(select 1 from public.payments where financial_entry_id = e.id and reversed_at is null) then raise exception 'Estorne os pagamentos antes de cancelar'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo'; end if;
  update public.financial_entries set status = 'cancelado', notes = concat_ws(E'\n', notes, 'Cancelada: ' || left(btrim(p_reason),300)) where id = e.id;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'financial_entries', e.id, 'CANCEL', to_jsonb(e), jsonb_build_object('motivo', left(btrim(p_reason),500)));
end $$;
revoke all on function public.cancel_financial_entry(uuid,text) from public, anon;
grant execute on function public.cancel_financial_entry(uuid,text) to authenticated;
commit;
