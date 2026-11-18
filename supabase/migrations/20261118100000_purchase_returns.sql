begin;
-- Devolucao de material ao fornecedor (ou reducao do pedido ainda nao entregue).
-- Abate do que se deve; o que ja estava pago vira credito com o fornecedor.
-- Se o material ja entrou no estoque, sai do local informado. Aditivo e auditado.
create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  purchase_order_id uuid not null references public.purchase_orders(id),
  purchase_order_item_id uuid not null references public.purchase_order_items(id),
  quantity numeric(14,3) not null check (quantity > 0),
  amount numeric(14,2) not null check (amount >= 0),
  debt_reduction numeric(14,2) not null default 0,
  credit_amount numeric(14,2) not null default 0,
  location_id uuid references public.stock_locations(id),
  stock_movement_id uuid references public.stock_movements(id),
  supplier_credit_id uuid references public.supplier_credits(id),
  reason text not null check (length(reason) between 3 and 500),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists purchase_returns_po_idx on public.purchase_returns(purchase_order_id, created_at desc);
create index if not exists purchase_returns_item_idx on public.purchase_returns(purchase_order_item_id);
create index if not exists purchase_returns_company_idx on public.purchase_returns(company_id);
create index if not exists purchase_returns_location_idx on public.purchase_returns(location_id);
create index if not exists purchase_returns_movement_idx on public.purchase_returns(stock_movement_id);
create index if not exists purchase_returns_credit_idx on public.purchase_returns(supplier_credit_id);
create index if not exists purchase_returns_created_by_idx on public.purchase_returns(created_by);
alter table public.purchase_returns enable row level security;
revoke all on public.purchase_returns from public, anon, authenticated;
grant select on public.purchase_returns to authenticated;
drop policy if exists purchase_returns_select on public.purchase_returns;
create policy purchase_returns_select on public.purchase_returns for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('purchase_orders','select')));

create or replace function public.register_purchase_return(p_item_id uuid, p_quantity numeric, p_amount numeric, p_location uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare c uuid := public.current_company_id(); i public.purchase_order_items; po public.purchase_orders; e public.financial_entries;
  from_stock numeric; bal numeric; amount numeric; debt numeric := 0; credit numeric := 0; mov uuid; cred uuid; rid uuid; new_total numeric; any_received boolean; all_received boolean;
begin
  perform public.require_table_access('purchase_orders','update');
  select * into i from public.purchase_order_items where id = p_item_id and company_id = c for update;
  if i.id is null then raise exception 'Item da compra não encontrado'; end if;
  select * into po from public.purchase_orders where id = i.purchase_order_id for update;
  if po.status in ('cancelado','cancelada') then raise exception 'Compra cancelada'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > i.purchased_quantity then raise exception 'Quantidade inválida (comprado: %)', i.purchased_quantity; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo da devolução'; end if;
  amount := round(coalesce(p_amount, p_quantity * i.unit_price), 2);
  if amount < 0 or amount > round(i.purchased_quantity * i.unit_price, 2) then raise exception 'Valor da devolução inválido'; end if;
  -- O que ainda nao chegou sai primeiro do pendente; o resto sai do estoque.
  from_stock := greatest(p_quantity - i.pending_quantity, 0);
  if from_stock > 0 then
    if i.material_id is null then raise exception 'Item sem material de estoque'; end if;
    if p_location is null then raise exception 'Informe de qual local do estoque o material sai'; end if;
    select balance into bal from public.v_stock_balance where id = i.material_id and location = (select name from public.stock_locations where id = p_location and company_id = c);
    if coalesce(bal,0) < from_stock then raise exception 'Saldo no estoque insuficiente (%). O material já foi usado?', coalesce(bal,0); end if;
    insert into public.stock_movements(company_id,material_id,location_id,movement_type,quantity,unit_cost,purchase_order_item_id,order_id,notes,created_by)
      values (c, i.material_id, p_location, 'saida', from_stock, i.unit_price, i.id, i.order_id, 'Devolução ao fornecedor: ' || left(btrim(p_reason),300), auth.uid()) returning id into mov;
  end if;
  update public.purchase_order_items set purchased_quantity = purchased_quantity - p_quantity, requested_quantity = greatest(requested_quantity - p_quantity, 0),
    received_quantity = received_quantity - from_stock,
    unit_price = case when purchased_quantity - p_quantity > 0 then round((purchased_quantity * unit_price - amount) / (purchased_quantity - p_quantity), 4) else unit_price end
    where id = i.id;
  select round(coalesce(sum(total),0),2) into new_total from public.purchase_order_items where purchase_order_id = po.id;
  select bool_or(received_quantity > 0), bool_and(pending_quantity = 0) into any_received, all_received from public.purchase_order_items where purchase_order_id = po.id and purchased_quantity > 0;
  select * into e from public.financial_entries where purchase_order_id = po.id and origin = 'compra' and status <> 'cancelado' for update;
  -- Abate do que se deve; o que passar do aberto vira credito.
  if e.id is not null then debt := least(amount, e.open_amount); credit := amount - debt; else credit := 0; end if;
  update public.purchase_orders set total = new_total,
    status = case when new_total = 0 and coalesce(any_received,false) = false then status when all_received then 'recebido_completo' when any_received then 'recebido_parcial' else status end
    where id = po.id;
  if e.id is not null then
    update public.financial_entries set total_amount = greatest(e.total_amount - amount, e.paid_amount),
      status = case when e.paid_amount >= greatest(e.total_amount - amount, e.paid_amount) and greatest(e.total_amount - amount, e.paid_amount) > 0 then 'pago'::public.financial_status
                    when greatest(e.total_amount - amount, e.paid_amount) = 0 then 'cancelado'::public.financial_status
                    when e.paid_amount > 0 then 'parcialmente_pago'::public.financial_status else 'aguardando_pagamento'::public.financial_status end
      where id = e.id;
  end if;
  if credit > 0 then
    insert into public.supplier_credits(company_id, supplier_id, amount, kind, financial_entry_id, moved_at, notes)
      values (c, po.supplier_id, credit, 'abatimento', e.id, (now() at time zone 'America/Sao_Paulo')::date, 'Devolução na compra ' || po.order_number || ': ' || left(btrim(p_reason),200)) returning id into cred;
  end if;
  insert into public.purchase_returns(company_id,purchase_order_id,purchase_order_item_id,quantity,amount,debt_reduction,credit_amount,location_id,stock_movement_id,supplier_credit_id,reason)
    values (c, po.id, i.id, p_quantity, amount, debt, credit, case when from_stock > 0 then p_location end, mov, cred, left(btrim(p_reason),500)) returning id into rid;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'purchase_orders', po.id, 'RETURN', to_jsonb(i), jsonb_build_object('quantidade', p_quantity, 'valor', amount, 'abatido', debt, 'credito', credit, 'motivo', left(btrim(p_reason),500)));
  return rid;
end $$;
revoke all on function public.register_purchase_return(uuid,numeric,numeric,uuid,text) from public, anon;
grant execute on function public.register_purchase_return(uuid,numeric,numeric,uuid,text) to authenticated;
commit;
