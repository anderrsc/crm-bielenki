begin;
-- Desfazer entrada de material no estoque e voltar etapa da producao. Aditivo e auditado.
alter table public.stock_movements add column if not exists reverses_movement_id uuid references public.stock_movements(id);
create unique index if not exists stock_movements_reverses_key on public.stock_movements(reverses_movement_id) where reverses_movement_id is not null;

create or replace function public.undo_stock_receipt(p_movement_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare c uuid := public.current_company_id(); m public.stock_movements; i public.purchase_order_items; bal numeric; any_received boolean; all_received boolean;
begin
  perform public.require_table_access('purchase_order_items','update');
  perform public.require_table_access('stock_movements','insert');
  select * into m from public.stock_movements where id = p_movement_id and company_id = c for update;
  if m.id is null or m.movement_type <> 'entrada' or m.purchase_order_item_id is null then raise exception 'Entrada de compra não encontrada'; end if;
  if exists(select 1 from public.stock_movements where reverses_movement_id = m.id) then raise exception 'Esta entrada já foi desfeita'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo'; end if;
  select balance into bal from public.v_stock_balance where id = m.material_id and location = (select name from public.stock_locations where id = m.location_id);
  if coalesce(bal,0) < m.quantity then raise exception 'O material já foi usado (saldo no local: %). Não dá para desfazer a entrada inteira', coalesce(bal,0); end if;
  select * into i from public.purchase_order_items where id = m.purchase_order_item_id for update;
  insert into public.stock_movements(company_id,material_id,location_id,movement_type,quantity,unit_cost,purchase_order_item_id,order_id,notes,created_by,reverses_movement_id)
    values (c, m.material_id, m.location_id, 'saida', m.quantity, m.unit_cost, m.purchase_order_item_id, m.order_id, 'Entrada desfeita: ' || left(btrim(p_reason),300), auth.uid(), m.id);
  update public.purchase_order_items set received_quantity = greatest(received_quantity - m.quantity, 0),
    status = case when received_quantity - m.quantity <= 0 then 'comprado' else 'recebido_parcial' end where id = i.id;
  select bool_or(received_quantity > 0), bool_and(pending_quantity = 0) into any_received, all_received from public.purchase_order_items where purchase_order_id = i.purchase_order_id;
  update public.purchase_orders set status = case when all_received then 'recebido_completo' when any_received then 'recebido_parcial' else 'pedido_enviado_ao_fornecedor' end,
    received_at = case when all_received then received_at else null end
    where id = i.purchase_order_id and status not in ('cancelado','cancelada');
  if i.order_id is not null then
    update public.production_materials pm set received_quantity = greatest(pm.received_quantity - m.quantity, 0),
      status = case when pm.received_quantity - m.quantity <= 0 then 'comprado' else 'recebido_parcial' end
      from public.production_orders po where pm.production_order_id = po.id and po.order_id = i.order_id and pm.material_id = i.material_id;
    -- Producao liberada e ainda nao iniciada volta a esperar material.
    update public.production_orders po set status = 'aguardando_material'
      where po.order_id = i.order_id and po.status = 'liberado' and po.current_step <= 1
        and exists(select 1 from public.production_materials pm where pm.production_order_id = po.id and pm.required and pm.received_quantity < pm.required_quantity);
  end if;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'stock_movements', m.id, 'UNDO_RECEIPT', to_jsonb(m), jsonb_build_object('motivo', left(btrim(p_reason),500)));
end $$;
revoke all on function public.undo_stock_receipt(uuid,text) from public, anon;
grant execute on function public.undo_stock_receipt(uuid,text) to authenticated;

create or replace function public.production_step_back(p_production_order_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare c uuid := public.current_company_id(); po public.production_orders; prev integer;
begin
  perform public.require_table_access('production_orders','update');
  select * into po from public.production_orders where id = p_production_order_id and company_id = c for update;
  if po.id is null then raise exception 'Ordem de produção não encontrada'; end if;
  if po.status = 'cancelado' then raise exception 'Produção cancelada'; end if;
  if po.current_step <= 1 then raise exception 'A produção já está na primeira etapa'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo'; end if;
  prev := po.current_step - 1;
  update public.production_step_logs set completed_at = null, notes = concat_ws(E'\n', notes, 'Etapa reaberta: ' || left(btrim(p_reason),300))
    where production_order_id = po.id and step_number = prev;
  update public.production_orders set current_step = prev, status = 'em_producao', finished_at = null where id = po.id;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'production_orders', po.id, 'STEP_BACK', to_jsonb(po), jsonb_build_object('etapa', prev, 'motivo', left(btrim(p_reason),500)));
  return prev;
end $$;
revoke all on function public.production_step_back(uuid,text) from public, anon;
grant execute on function public.production_step_back(uuid,text) to authenticated;
commit;
