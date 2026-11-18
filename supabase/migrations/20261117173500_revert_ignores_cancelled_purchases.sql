begin;
-- Reverter aprovacao: compra cancelada nao bloqueia mais.
CREATE OR REPLACE FUNCTION public.revert_quote_approval_unchecked(p_quote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q public.quotes; s uuid; o uuid;
begin
  select * into q from public.quotes where id = p_quote_id and company_id = public.current_company_id() for update;
  if q.id is null then raise exception 'Orçamento não encontrado'; end if;
  if q.status <> 'aprovado' or q.sale_id is null then raise exception 'Este orçamento não está aprovado'; end if;
  s := q.sale_id;
  select id into o from public.orders where sale_id = s;

  -- So bloqueia pagamento valido; pagamento ja estornado nao impede reverter.
  if exists (select 1 from public.payments p join public.financial_entries e on e.id = p.financial_entry_id where e.sale_id = s and p.reversed_at is null) then
    raise exception 'Este pedido tem pagamento válido. Estorne o pagamento (Financeiro > abrir a conta > Estornar) antes de reverter.';
  end if;
  if exists (select 1 from public.bank_statement_rows b join public.payments p on p.id in (b.payment_id, b.generated_payment_id) join public.financial_entries e on e.id = p.financial_entry_id where e.sale_id = s) then
    raise exception 'Um pagamento deste pedido está ligado à conciliação bancária. Desfaça a conciliação antes de reverter.';
  end if;
  if exists (select 1 from public.commissions where sale_id = s and (status <> 'pendente' or paid_at is not null)) then
    raise exception 'A comissão deste pedido já foi paga. Não é possível reverter.';
  end if;
  if o is not null then
    if exists (select 1 from public.purchase_orders po where (po.order_id = o or po.request_id in (select id from public.purchase_requests where order_id = o)) and po.status not in ('cancelado','cancelada'))
       or exists (select 1 from public.purchase_order_items i join public.purchase_orders po on po.id = i.purchase_order_id where (i.order_id = o or i.sale_id = s) and po.status not in ('cancelado','cancelada')) then
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

    -- Compras canceladas ficam, sem o vinculo com o pedido.
    update public.purchase_order_items set order_id = null, sale_id = null where order_id = o or sale_id = s;
    update public.purchase_orders set order_id = null where order_id = o;
    update public.purchase_orders set request_id = null where request_id in (select id from public.purchase_requests where order_id = o);
    delete from public.installations where order_id = o;
    delete from public.production_orders where order_id = o;
    delete from public.purchase_requests where order_id = o;
    delete from public.orders where id = o;
  end if;

  update public.activities set sale_id = null where sale_id = s;
  update public.followups set sale_id = null where sale_id = s;
  delete from public.commissions where sale_id = s;
  -- Pagamentos estornados saem junto com a conta; ficam guardados no historico.
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    select p.company_id, auth.uid(), 'payments', p.id, 'DELETE_REVERSED_ON_QUOTE_REVERT', to_jsonb(p), jsonb_build_object('quote_id', q.id, 'sale_id', s)
    from public.payments p join public.financial_entries e on e.id = p.financial_entry_id where e.sale_id = s;
  delete from public.payments p using public.financial_entries e where e.id = p.financial_entry_id and e.sale_id = s and p.reversed_at is not null;
  delete from public.financial_entries where sale_id = s;
  update public.quotes set status = 'enviado', approved_at = null, sale_id = null where id = q.id;
  delete from public.sales where id = s;
end $function$;
revoke all on function public.revert_quote_approval_unchecked(uuid) from public, anon, authenticated;
grant execute on function public.revert_quote_approval_unchecked(uuid) to service_role;
commit;
