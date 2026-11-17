begin;
-- Compra manual simplificada: informa se pagou, como, quando e de qual conta.
-- Pagou a mais -> excedente vira credito com o fornecedor. Pagou menos -> o resto
-- fica em aberto (conta a pagar) com o vencimento informado. Pode usar credito
-- que o fornecedor ja tinha. Compras antigas nao mudam.
create or replace function public.create_manual_purchase_unchecked(p_payload jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare c uuid:=public.current_company_id(); po uuid; entry_id uuid; item jsonb; total_value numeric;
  paid_value numeric:=round(coalesce(nullif(p_payload->>'paid_amount','')::numeric,0),2);
  credit_value numeric:=round(coalesce(nullif(p_payload->>'use_credit','')::numeric,0),2);
  paid_on date:=coalesce(nullif(p_payload->>'paid_at','')::date,current_date);
  account uuid:=nullif(p_payload->>'receiving_account_id','')::uuid;
  due date:=nullif(p_payload->>'due_date','')::date;
  supplier uuid; material uuid; category_id uuid; item_name text; pay_now numeric; excess numeric; pid uuid;
begin
  if c is null then raise exception 'Usuário sem empresa'; end if;
  supplier:=(p_payload->>'supplier_id')::uuid;
  if not exists(select 1 from public.suppliers where id=supplier and company_id=c) then raise exception 'Fornecedor inválido'; end if;
  select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) into total_value from jsonb_array_elements(p_payload->'items') x;
  total_value:=round(total_value,2);
  if total_value<=0 then raise exception 'Inclua ao menos um item com valor'; end if;
  if paid_value<0 or credit_value<0 then raise exception 'Valor pago inválido'; end if;
  if credit_value>total_value then raise exception 'Crédito usado maior que o valor da compra'; end if;
  if account is not null and not exists(select 1 from public.receiving_accounts where id=account and company_id=c) then raise exception 'Conta inválida'; end if;
  insert into public.purchase_orders(company_id,order_number,supplier_id,buyer_id,status,total,ordered_at,expected_at,notes)
  values(c,public.next_number('COM','public.purchase_orders',c),supplier,auth.uid(),'pedido_enviado_ao_fornecedor',total_value,current_date,nullif(p_payload->>'expected_at','')::date,p_payload->>'notes') returning id into po;
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
    insert into public.purchase_order_items(company_id,purchase_order_id,material_id,category,description,unit,requested_quantity,purchased_quantity,unit_price,supplier_id,status,notes)
    values(c,po,material,item->>'category',item_name,coalesce(nullif(item->>'unit',''),'un'),(item->>'quantity')::numeric,(item->>'quantity')::numeric,(item->>'unit_price')::numeric,supplier,'comprado',item->>'notes');
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
revoke all on function public.create_manual_purchase_unchecked(jsonb) from public, anon, authenticated;
commit;
