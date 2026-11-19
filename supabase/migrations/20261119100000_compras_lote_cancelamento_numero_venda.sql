-- Compras: receber a compra inteira, desfazer várias entradas, impedir nota duplicada e
-- cancelar compra tirando do estoque e do financeiro. Venda com o mesmo número do orçamento.
-- Aditiva: nenhum dado existente é alterado; números antigos de venda continuam como estão.

CREATE OR REPLACE FUNCTION public.approve_quote_unchecked(p_quote_id uuid, p_due_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q public.quotes; num text; s uuid; o uuid; ck uuid; tpl uuid; pr uuid; po uuid;
begin
  select * into q from public.quotes where id=p_quote_id and company_id=public.current_company_id() for update;
  if q.id is null then raise exception 'Orçamento não encontrado'; end if;
  if q.status='aprovado' then return q.sale_id; end if;
  -- A venda leva o MESMO número do orçamento (ORC-2026-00128 na proposta, na venda, na conta e nas mensagens).
  -- Só se esse número já estiver em outra venda (dado antigo) cai na numeração própria, sem travar a aprovação.
  num := case when exists(select 1 from public.sales where company_id=q.company_id and sale_number=q.quote_number) then null else q.quote_number end;
  insert into public.sales(company_id,sale_number,client_id,sale_type_id,seller_id,total,operational_status,next_action,next_action_date,notes)
    values(q.company_id,coalesce(num,public.next_number('VEN','public.sales',q.company_id)),q.client_id,q.sale_type_id,q.seller_id,q.total,'pedido_aberto','Confirmar entrada',current_date+2,q.notes) returning id into s;
  insert into public.sale_items(company_id,sale_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production) select company_id,s,product,description,unit,quantity,unit_price,requires_purchase,requires_production from public.quote_items where quote_id=q.id;
  insert into public.orders(company_id,order_number,sale_id,client_id,sale_type_id,next_action,next_action_date) values(q.company_id,public.next_number('PED','public.orders',q.company_id),s,q.client_id,q.sale_type_id,'Executar checklist inicial',current_date+1) returning id into o;
  insert into public.order_items(company_id,order_id,sale_item_id,product,description,unit,quantity) select company_id,o,id,product,description,unit,quantity from public.sale_items where sale_id=s;
  insert into public.financial_entries(company_id,entry_type,origin,client_id,sale_id,description,total_amount,due_date) values(q.company_id,'receber','venda',q.client_id,s,'Venda '||(select sale_number from public.sales where id=s),q.total,coalesce(p_due_date,current_date+7));
  select ct.id into tpl from public.checklist_templates ct where ct.sale_type_id=q.sale_type_id and ct.active order by ct.is_default desc limit 1;
  insert into public.order_checklists(company_id,order_id,template_id) values(q.company_id,o,tpl) returning id into ck;
  insert into public.order_checklist_items(company_id,checklist_id,order_id,title,due_date,required,sort_order) select q.company_id,ck,o,title,current_date+coalesce(due_days,sort_order),required,sort_order from public.checklist_template_items where template_id=tpl order by sort_order;
  if exists(select 1 from public.quote_items where quote_id=q.id and requires_purchase) then
    insert into public.purchase_requests(company_id,request_number,order_id,requested_by,status,needed_by,notes) values(q.company_id,public.next_number('SOL','public.purchase_requests',q.company_id),o,auth.uid(),'solicitacao_criada',current_date+7,'Gerada pelo orçamento '||q.quote_number) returning id into pr;
    insert into public.purchase_request_items(company_id,request_id,description,unit,requested_quantity) select q.company_id,pr,product,unit,quantity from public.quote_items where quote_id=q.id and requires_purchase;
  end if;
  if exists(select 1 from public.quote_items where quote_id=q.id and requires_production) then insert into public.production_orders(company_id,production_number,order_id,status) values(q.company_id,public.next_number('OP','public.production_orders',q.company_id),o,'aguardando_material') returning id into po; end if;
  update public.quotes set status='aprovado',approved_at=now(),sale_id=s where id=q.id;
  return s;
end $function$;

CREATE OR REPLACE FUNCTION public.create_manual_purchase_unchecked(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c uuid:=public.current_company_id(); dup text; names text[]; po uuid; entry_id uuid; item jsonb; total_value numeric;
  paid_value numeric:=round(coalesce(nullif(p_payload->>'paid_amount','')::numeric,0),2);
  credit_value numeric:=round(coalesce(nullif(p_payload->>'use_credit','')::numeric,0),2);
  paid_on date:=coalesce(nullif(p_payload->>'paid_at','')::date,current_date);
  account uuid:=nullif(p_payload->>'receiving_account_id','')::uuid;
  due date:=nullif(p_payload->>'due_date','')::date;
  target_order uuid:=nullif(p_payload->>'order_id','')::uuid; o public.orders; supplier uuid; material uuid; category_id uuid; item_name text; pay_now numeric; excess numeric; pid uuid;
begin
  if c is null then raise exception 'Usuário sem empresa'; end if;
  supplier:=(p_payload->>'supplier_id')::uuid;
  if not exists(select 1 from public.suppliers where id=supplier and company_id=c) then raise exception 'Fornecedor inválido'; end if;
  select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) into total_value from jsonb_array_elements(p_payload->'items') x;
  total_value:=round(total_value,2);
  if total_value<=0 then raise exception 'Inclua ao menos um item com valor'; end if;
  if paid_value<0 or credit_value<0 then raise exception 'Valor pago inválido'; end if;
  if credit_value>total_value then raise exception 'Crédito usado maior que o valor da compra'; end if;
  if target_order is not null then
    select * into o from public.orders where id=target_order and company_id=c;
    if o.id is null then raise exception 'Pedido inválido'; end if;
  end if;
  if account is not null and not exists(select 1 from public.receiving_accounts where id=account and company_id=c) then raise exception 'Conta inválida'; end if;
  -- Evita lançar a mesma nota duas vezes: mesmo fornecedor, mesmo valor (±R$ 1) e mesmos itens, nos últimos 30 dias.
  -- Se for mesmo outra compra, a tela manda allow_duplicate=true.
  if not coalesce(nullif(p_payload->>'allow_duplicate','')::boolean,false) then
    select array_agg(lower(trim(coalesce(nullif(trim(x->>'description'),''),x->>'category'))) order by lower(trim(coalesce(nullif(trim(x->>'description'),''),x->>'category')))) into names
      from jsonb_array_elements(p_payload->'items') x;
    select p.order_number into dup from public.purchase_orders p
      where p.company_id=c and p.supplier_id=supplier and p.status not in ('cancelado','cancelada')
        and abs(p.total-total_value)<=1 and p.created_at>now()-interval '30 days'
        and names = (select array_agg(lower(trim(i.description)) order by lower(trim(i.description))) from public.purchase_order_items i where i.purchase_order_id=p.id)
      order by p.created_at desc limit 1;
    if dup is not null then
      raise exception 'Compra parecida já lançada: % (mesmo fornecedor, valor e itens). Se for outra compra, marque "É outra compra, não é duplicada" e salve de novo.', dup;
    end if;
  end if;
  insert into public.purchase_orders(company_id,order_number,supplier_id,buyer_id,status,total,ordered_at,expected_at,notes,order_id)
  values(c,public.next_number('COM','public.purchase_orders',c),supplier,auth.uid(),'pedido_enviado_ao_fornecedor',total_value,current_date,nullif(p_payload->>'expected_at','')::date,p_payload->>'notes',o.id) returning id into po;
  for item in select * from jsonb_array_elements(p_payload->'items') loop
    item_name:=trim(coalesce(nullif(trim(item->>'description'),''),item->>'category'));
    if item_name is null or item_name='' then raise exception 'Informe o que está comprando'; end if;
    material:=null; category_id:=null;
    if nullif(item->>'material_id','') is not null then select id into material from public.materials where id=(item->>'material_id')::uuid and company_id=c; end if;
    if material is null then
      select id into category_id from public.material_categories where company_id=c and lower(name)=lower(coalesce(nullif(item->>'category',''),'Outros')) limit 1;
      if category_id is null then insert into public.material_categories(company_id,name) values(c,coalesce(nullif(item->>'category',''),'Outros')) returning id into category_id; end if;
      select id into material from public.materials where company_id=c and lower(name)=lower(item_name) limit 1;
      if material is null then insert into public.materials(company_id,category_id,name,unit,active) values(c,category_id,item_name,coalesce(nullif(item->>'unit',''),'un'),true) returning id into material; end if;
    end if;
    insert into public.purchase_order_items(company_id,purchase_order_id,material_id,category,description,unit,requested_quantity,purchased_quantity,unit_price,supplier_id,status,notes,order_id,sale_id,client_id)
    values(c,po,material,item->>'category',item_name,coalesce(nullif(item->>'unit',''),'un'),(item->>'quantity')::numeric,(item->>'quantity')::numeric,(item->>'unit_price')::numeric,supplier,'comprado',item->>'notes',o.id,o.sale_id,o.client_id);
  end loop;
  select id into entry_id from public.financial_entries where purchase_order_id=po and origin='compra';
  if due is not null and entry_id is not null then update public.financial_entries set due_date=due where id=entry_id; end if;
  if credit_value>0 then perform public.use_supplier_credit(entry_id,credit_value,paid_on); end if;
  pay_now:=least(paid_value,total_value-credit_value);
  excess:=paid_value-pay_now;
  if pay_now>0 then
    pid:=public.register_payment(entry_id,pay_now,paid_on,coalesce(nullif(p_payload->>'payment_method',''),'pix'),'Pagamento informado no cadastro da compra');
    if account is not null then perform public.set_payment_account(pid,account); end if;
  end if;
  if excess>0 then
    insert into public.supplier_credits(company_id,supplier_id,amount,kind,financial_entry_id,payment_id,account_id,moved_at,notes)
      values(c,supplier,excess,'excedente',entry_id,pid,account,paid_on,'Pago a mais na compra');
  end if;
  return po;
end $function$;

-- Recebe todos os itens pendentes da compra (ou só os escolhidos) num local, numa transação.
-- Itens travados antes: dois cliques/duas pessoas ao mesmo tempo não recebem em dobro.
create or replace function public.receive_purchase_all(p_po uuid, p_location_id uuid, p_item_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare c uuid := public.current_company_id(); po public.purchase_orders; it record; got int := 0; skipped int := 0;
begin
  perform public.require_table_access('purchase_order_items','update');
  perform public.require_table_access('stock_movements','insert');
  select * into po from public.purchase_orders where id = p_po and company_id = c for update;
  if po.id is null then raise exception 'Compra não encontrada'; end if;
  if po.status in ('cancelado','cancelada') then raise exception 'Compra cancelada: não dá para receber'; end if;
  for it in select i.id, i.material_id from public.purchase_order_items i
      where i.purchase_order_id = po.id and i.company_id = c and i.pending_quantity > 0
        and (p_item_ids is null or i.id = any(p_item_ids))
      order by i.id for update
  loop
    if it.material_id is null then skipped := skipped + 1; continue; end if;
    perform public.receive_purchase_item(it.id, (select pending_quantity from public.purchase_order_items where id = it.id), p_location_id, null, 'Recebimento da compra ' || po.order_number);
    got := got + 1;
  end loop;
  if got = 0 and skipped = 0 then raise exception 'Nada pendente para receber nesta compra'; end if;
  return jsonb_build_object('received', got, 'skipped', skipped);
end $$;
revoke all on function public.receive_purchase_all(uuid,uuid,uuid[]) from public, anon;
grant execute on function public.receive_purchase_all(uuid,uuid,uuid[]) to authenticated, service_role;

-- Desfaz várias entradas de uma vez (cada uma com a mesma regra e o mesmo registro de auditoria).
-- Entrada já desfeita é pulada: repetir não desfaz duas vezes.
create or replace function public.undo_stock_receipts(p_movement_ids uuid[], p_reason text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare c uuid := public.current_company_id(); mid uuid; done int := 0; skipped int := 0;
begin
  if coalesce(array_length(p_movement_ids,1),0) = 0 then raise exception 'Selecione ao menos uma entrada'; end if;
  if coalesce(array_length(p_movement_ids,1),0) > 200 then raise exception 'Selecione no máximo 200 entradas por vez'; end if;
  foreach mid in array p_movement_ids loop
    if exists(select 1 from public.stock_movements where reverses_movement_id = mid and company_id = c) then skipped := skipped + 1; continue; end if;
    perform public.undo_stock_receipt(mid, p_reason);
    done := done + 1;
  end loop;
  return jsonb_build_object('undone', done, 'skipped', skipped);
end $$;
revoke all on function public.undo_stock_receipts(uuid[],text) from public, anon;
grant execute on function public.undo_stock_receipts(uuid[],text) to authenticated, service_role;

-- Cancelar compra: tira o material recebido do estoque (movimento de saída ligado à entrada),
-- cancela a conta a pagar em aberto e deixa a compra só como Cancelada. Nada é apagado.
-- Bloqueia (sem mexer em nada) se houver pagamento válido, devolução registrada ou material já usado.
create or replace function public.cancel_purchase_order(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare c uuid := public.current_company_id(); po public.purchase_orders; m record;
begin
  perform public.require_table_access('purchase_orders','update');
  select * into po from public.purchase_orders where id = p_id and company_id = c for update;
  if po.id is null then raise exception 'Compra não encontrada'; end if;
  if po.status in ('cancelado','cancelada') then raise exception 'Compra já cancelada'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo'; end if;
  if exists(select 1 from public.payments p join public.financial_entries e on e.id = p.financial_entry_id where e.purchase_order_id = po.id and p.reversed_at is null) then
    raise exception 'Esta compra tem pagamento. Estorne o pagamento (Financeiro > abrir a conta > Estornar) antes de cancelar'; end if;
  if exists(select 1 from public.purchase_returns where purchase_order_id = po.id) then
    raise exception 'Esta compra tem devolução registrada. Não dá para cancelar por inteiro; ajuste pela própria devolução'; end if;
  -- Entradas ainda valendo saem do estoque (a função confere se o material ainda está no local).
  for m in select sm.id from public.stock_movements sm join public.purchase_order_items i on i.id = sm.purchase_order_item_id
      where i.purchase_order_id = po.id and sm.company_id = c and sm.movement_type = 'entrada'
        and not exists(select 1 from public.stock_movements r where r.reverses_movement_id = sm.id)
      order by sm.created_at
  loop
    perform public.undo_stock_receipt(m.id, 'Compra cancelada: ' || left(btrim(p_reason),280));
  end loop;
  update public.purchase_orders set status = 'cancelado', notes = concat_ws(E'\n', notes, 'Cancelada: ' || left(btrim(p_reason),300)) where id = po.id;
  update public.purchase_order_items set status = 'cancelado' where purchase_order_id = po.id;
  update public.financial_entries set status = 'cancelado' where purchase_order_id = po.id;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'purchase_orders', po.id, 'CANCEL', to_jsonb(po), jsonb_build_object('motivo', left(btrim(p_reason),500)));
end $$;
