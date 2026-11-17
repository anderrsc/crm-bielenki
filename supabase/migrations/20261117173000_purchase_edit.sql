begin;
-- Corrigir compra lancada errado: fornecedor, previsao, pedido, observacao e itens
-- (descricao, tipo, quantidade, valor) enquanto nada foi recebido. Cancelar compra sem
-- pagamento valido e sem recebimento. A conta a pagar acompanha. Tudo auditado.
create or replace function public.update_purchase_order(p_id uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare c uuid := public.current_company_id(); po public.purchase_orders; e public.financial_entries; item jsonb; it public.purchase_order_items;
  new_total numeric; target_order uuid := nullif(p_payload->>'order_id','')::uuid; o public.orders; supplier uuid := nullif(p_payload->>'supplier_id','')::uuid;
  received boolean; before jsonb;
begin
  perform public.require_table_access('purchase_orders','update');
  select * into po from public.purchase_orders where id = p_id and company_id = c for update;
  if po.id is null then raise exception 'Compra não encontrada'; end if;
  if po.status in ('cancelado','cancelada') then raise exception 'Compra cancelada não pode ser editada'; end if;
  select jsonb_build_object('compra', to_jsonb(po), 'itens', coalesce(jsonb_agg(to_jsonb(i)), '[]')) into before from public.purchase_order_items i where i.purchase_order_id = po.id;
  select * into e from public.financial_entries where purchase_order_id = po.id and origin = 'compra' for update;
  received := exists(select 1 from public.purchase_order_items where purchase_order_id = po.id and received_quantity > 0);
  if target_order is not null then
    select * into o from public.orders where id = target_order and company_id = c;
    if o.id is null then raise exception 'Pedido inválido'; end if;
  end if;
  if supplier is not null and supplier <> po.supplier_id then
    if not exists(select 1 from public.suppliers where id = supplier and company_id = c) then raise exception 'Fornecedor inválido'; end if;
    if e.id is not null and exists(select 1 from public.payments where financial_entry_id = e.id and reversed_at is null) then
      raise exception 'Já tem pagamento para este fornecedor. Estorne o pagamento antes de trocar o fornecedor'; end if;
  end if;
  if jsonb_typeof(p_payload->'items') = 'array' then
    for item in select * from jsonb_array_elements(p_payload->'items') loop
      select * into it from public.purchase_order_items where id = (item->>'id')::uuid and purchase_order_id = po.id for update;
      if it.id is null then raise exception 'Item inválido'; end if;
      if (item->>'quantity')::numeric <= 0 or (item->>'unit_price')::numeric < 0 then raise exception 'Quantidade ou valor inválido'; end if;
      if received and ((item->>'quantity')::numeric <> it.purchased_quantity or (item->>'unit_price')::numeric <> it.unit_price) then
        raise exception 'Material já recebido no estoque: quantidade e valor não podem mudar'; end if;
      update public.purchase_order_items set description = coalesce(nullif(btrim(item->>'description'),''), description), category = coalesce(nullif(item->>'category',''), category),
        purchased_quantity = (item->>'quantity')::numeric, requested_quantity = (item->>'quantity')::numeric, unit_price = (item->>'unit_price')::numeric,
        order_id = case when p_payload ? 'order_id' then o.id else order_id end, sale_id = case when p_payload ? 'order_id' then o.sale_id else sale_id end,
        client_id = case when p_payload ? 'order_id' then o.client_id else client_id end, supplier_id = coalesce(supplier, supplier_id)
        where id = it.id;
    end loop;
  end if;
  select round(coalesce(sum(total),0),2) into new_total from public.purchase_order_items where purchase_order_id = po.id;
  if new_total <= 0 then raise exception 'A compra precisa ter valor'; end if;
  if e.id is not null and new_total < e.paid_amount then raise exception 'O novo total (%) é menor que o já pago (%). Estorne o pagamento antes', new_total, e.paid_amount; end if;
  update public.purchase_orders set total = new_total, supplier_id = coalesce(supplier, supplier_id),
    expected_at = case when p_payload ? 'expected_at' then nullif(p_payload->>'expected_at','')::date else expected_at end,
    notes = case when p_payload ? 'notes' then nullif(btrim(p_payload->>'notes'),'') else notes end,
    order_id = case when p_payload ? 'order_id' then o.id else order_id end
    where id = po.id;
  if p_payload ? 'order_id' and not (jsonb_typeof(p_payload->'items') = 'array') then
    update public.purchase_order_items set order_id = o.id, sale_id = o.sale_id, client_id = o.client_id where purchase_order_id = po.id;
  end if;
  update public.financial_entries set status = case when paid_amount >= total_amount then 'pago'::public.financial_status when paid_amount > 0 then 'parcialmente_pago'::public.financial_status else 'aguardando_pagamento'::public.financial_status end
    where purchase_order_id = po.id and origin = 'compra' and status <> 'cancelado';
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'purchase_orders', po.id, 'EDIT', before, p_payload);
end $$;
revoke all on function public.update_purchase_order(uuid,jsonb) from public, anon;
grant execute on function public.update_purchase_order(uuid,jsonb) to authenticated;

create or replace function public.cancel_purchase_order(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare c uuid := public.current_company_id(); po public.purchase_orders;
begin
  perform public.require_table_access('purchase_orders','update');
  select * into po from public.purchase_orders where id = p_id and company_id = c for update;
  if po.id is null then raise exception 'Compra não encontrada'; end if;
  if po.status in ('cancelado','cancelada') then raise exception 'Compra já cancelada'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo'; end if;
  if exists(select 1 from public.payments p join public.financial_entries e on e.id = p.financial_entry_id where e.purchase_order_id = po.id and p.reversed_at is null) then
    raise exception 'Estorne os pagamentos desta compra antes de cancelar'; end if;
  if exists(select 1 from public.purchase_order_items where purchase_order_id = po.id and received_quantity > 0) then
    raise exception 'Material já entrou no estoque. Não é possível cancelar a compra'; end if;
  update public.purchase_orders set status = 'cancelado', notes = concat_ws(E'\n', notes, 'Cancelada: ' || left(btrim(p_reason),300)) where id = po.id;
  update public.purchase_order_items set status = 'cancelado' where purchase_order_id = po.id;
  update public.financial_entries set status = 'cancelado' where purchase_order_id = po.id;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'purchase_orders', po.id, 'CANCEL', to_jsonb(po), jsonb_build_object('motivo', left(btrim(p_reason),500)));
end $$;
revoke all on function public.cancel_purchase_order(uuid,text) from public, anon;
grant execute on function public.cancel_purchase_order(uuid,text) to authenticated;
commit;
