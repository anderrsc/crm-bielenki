-- Reverter orçamento aprovado (pedido fechado sem querer).
-- Desfaz tudo o que approve_quote criou (venda, itens, pedido, checklist,
-- conta a receber, solicitação de compra, ordem de produção) e devolve o
-- orçamento para "enviado". Bloqueia quando o pedido já teve movimento real:
-- pagamento, compra, estoque, produção iniciada, instalação concluída ou
-- comissão já paga. Pode ser rodada mais de uma vez.

create or replace function public.revert_quote_approval_unchecked(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare q public.quotes; s uuid; o uuid;
begin
  select * into q from public.quotes where id = p_quote_id and company_id = public.current_company_id() for update;
  if q.id is null then raise exception 'Orçamento não encontrado'; end if;
  if q.status <> 'aprovado' or q.sale_id is null then raise exception 'Este orçamento não está aprovado'; end if;
  s := q.sale_id;
  select id into o from public.orders where sale_id = s;

  if exists (select 1 from public.payments p join public.financial_entries e on e.id = p.financial_entry_id where e.sale_id = s) then
    raise exception 'Já existe pagamento registrado para este pedido. Estorne o pagamento antes de reverter.';
  end if;
  if exists (select 1 from public.commissions where sale_id = s and (status <> 'pendente' or paid_at is not null)) then
    raise exception 'A comissão deste pedido já foi paga. Não é possível reverter.';
  end if;
  if o is not null then
    if exists (select 1 from public.purchase_orders po where po.order_id = o or po.request_id in (select id from public.purchase_requests where order_id = o))
       or exists (select 1 from public.purchase_order_items where order_id = o or sale_id = s) then
      raise exception 'Já existe compra lançada para este pedido. Cancele a compra antes de reverter.';
    end if;
    if exists (select 1 from public.stock_movements where order_id = o) then
      raise exception 'Já houve movimentação de estoque para este pedido. Não é possível reverter.';
    end if;
    if exists (select 1 from public.production_orders where order_id = o and (started_at is not null or status not in ('aguardando_material', 'cancelado'))) then
      raise exception 'A produção deste pedido já começou. Não é possível reverter.';
    end if;
    if exists (select 1 from public.installations where order_id = o and (completed_at is not null or status = 'concluida')) then
      raise exception 'A instalação deste pedido já foi concluída. Não é possível reverter.';
    end if;

    -- Registros que só apontam para o pedido ficam, sem o vínculo.
    update public.measurements set order_id = null where order_id = o;
    update public.measurements set production_order_id = null where production_order_id in (select id from public.production_orders where order_id = o);
    update public.measurements set installation_id = null where installation_id in (select id from public.installations where order_id = o);
    update public.operational_events set order_id = null where order_id = o;
    update public.operational_events set installation_id = null where installation_id in (select id from public.installations where order_id = o);
    update public.files set order_id = null where order_id = o;

    delete from public.installations where order_id = o;
    delete from public.production_orders where order_id = o;
    delete from public.purchase_requests where order_id = o;
    delete from public.orders where id = o;
  end if;

  update public.activities set sale_id = null where sale_id = s;
  update public.followups set sale_id = null where sale_id = s;
  delete from public.commissions where sale_id = s;
  delete from public.financial_entries where sale_id = s;
  update public.quotes set status = 'enviado', approved_at = null, sale_id = null where id = q.id;
  delete from public.sales where id = s;
end $function$;

create or replace function public.revert_quote_approval(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.require_table_access('quotes', 'update');
  perform public.require_table_access('sales', 'delete');
  perform public.revert_quote_approval_unchecked(p_quote_id);
end $function$;

revoke all on function public.revert_quote_approval_unchecked(uuid) from public, anon, authenticated;
grant execute on function public.revert_quote_approval_unchecked(uuid) to service_role;
revoke all on function public.revert_quote_approval(uuid) from public, anon;
grant execute on function public.revert_quote_approval(uuid) to authenticated, service_role;
