-- Cadastros manuais transacionais e permissão granular da tabela de calhas.
drop policy if exists gutter_prices_read on public.gutter_prices;
drop policy if exists gutter_prices_manage on public.gutter_prices;
create policy gutter_prices_read on public.gutter_prices for select to authenticated
using(company_id=public.current_company_id() and public.has_table_access('gutter_prices','select'));
create policy gutter_prices_create on public.gutter_prices for insert to authenticated
with check(company_id=public.current_company_id() and public.has_table_access('gutter_prices','insert'));
create policy gutter_prices_update on public.gutter_prices for update to authenticated
using(company_id=public.current_company_id() and public.has_table_access('gutter_prices','update')) with check(company_id=public.current_company_id());
create policy gutter_prices_delete on public.gutter_prices for delete to authenticated
using(company_id=public.current_company_id() and public.has_table_access('gutter_prices','delete'));

insert into public.permissions(role,resource,can_view,can_create,can_update,can_delete) values
  ('vendedor','gutter_prices',true,false,false,false),
  ('compras','gutter_prices',true,true,true,false),
  ('financeiro','gutter_prices',true,false,false,false),
  ('producao','gutter_prices',false,false,false,false),
  ('estoque','gutter_prices',false,false,false,false),
  ('instalador','gutter_prices',false,false,false,false),
  ('atendente','gutter_prices',false,false,false,false)
on conflict(role,resource) do update set can_view=excluded.can_view,can_create=excluded.can_create,can_update=excluded.can_update,can_delete=excluded.can_delete;

create or replace function public.has_table_access(resource text,action text) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare allowed boolean;
begin
  if public.has_role(array['administrador','gerente']::public.app_role[]) then return true; end if;
  select bool_or(case action when 'select' then p.can_view when 'insert' then p.can_create when 'update' then p.can_update when 'delete' then p.can_delete else false end)
  into allowed from public.permissions p join public.user_roles ur on ur.role=p.role where ur.profile_id=auth.uid() and p.resource=resource;
  return coalesce(allowed,false);
end $$;

create or replace function public.create_manual_sale(p_payload jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_company_id(); s uuid; f uuid; item jsonb; total_value numeric; paid_value numeric:=coalesce((p_payload->>'paid_amount')::numeric,0); client uuid; sale_type uuid;
begin
  if c is null then raise exception 'Usuário sem empresa'; end if;
  client:=(p_payload->>'client_id')::uuid; sale_type:=(p_payload->>'sale_type_id')::uuid;
  if not exists(select 1 from public.clients where id=client and company_id=c) then raise exception 'Cliente inválido'; end if;
  if not exists(select 1 from public.sale_types where id=sale_type and company_id=c) then raise exception 'Tipo de venda inválido'; end if;
  select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) into total_value from jsonb_array_elements(p_payload->'items') x;
  if total_value<=0 then raise exception 'Inclua ao menos um item com valor'; end if;
  if paid_value<0 or paid_value>total_value then raise exception 'Valor pago inválido'; end if;
  insert into public.sales(company_id,sale_number,client_id,sale_type_id,seller_id,total,operational_status,next_action,next_action_date,notes)
  values(c,public.next_number('VEN','public.sales',c),client,sale_type,auth.uid(),total_value,'venda_avulsa','Acompanhar pagamento',coalesce(nullif(p_payload->>'due_date','')::date,current_date),p_payload->>'notes') returning id into s;
  for item in select * from jsonb_array_elements(p_payload->'items') loop
    insert into public.sale_items(company_id,sale_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production,notes)
    values(c,s,item->>'product',item->>'description',coalesce(nullif(item->>'unit',''),'un'),(item->>'quantity')::numeric,(item->>'unit_price')::numeric,coalesce((item->>'requires_purchase')::boolean,false),coalesce((item->>'requires_production')::boolean,false),item->>'notes');
  end loop;
  insert into public.financial_entries(company_id,entry_type,origin,client_id,sale_id,description,total_amount,due_date,notes)
  values(c,'receber','venda',client,s,'Venda manual '||(select sale_number from public.sales where id=s),total_value,coalesce(nullif(p_payload->>'due_date','')::date,current_date),p_payload->>'notes') returning id into f;
  if paid_value>0 then perform public.register_payment(f,paid_value,coalesce(nullif(p_payload->>'paid_at','')::date,current_date),p_payload->>'payment_method','Pagamento informado no cadastro da venda'); end if;
  insert into public.activities(company_id,client_id,sale_id,activity_type,subject,description,created_by) values(c,client,s,'venda','Venda cadastrada manualmente',p_payload->>'notes',auth.uid());
  return s;
end $$;

create or replace function public.create_manual_purchase(p_payload jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_company_id(); po uuid; entry_id uuid; item jsonb; total_value numeric; paid_value numeric:=coalesce((p_payload->>'paid_amount')::numeric,0); supplier uuid; material uuid; category_id uuid; item_name text;
begin
  if c is null then raise exception 'Usuário sem empresa'; end if;
  supplier:=(p_payload->>'supplier_id')::uuid;
  if not exists(select 1 from public.suppliers where id=supplier and company_id=c) then raise exception 'Fornecedor inválido'; end if;
  select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) into total_value from jsonb_array_elements(p_payload->'items') x;
  if total_value<=0 then raise exception 'Inclua ao menos um item com valor'; end if;
  if paid_value<0 or paid_value>total_value then raise exception 'Valor pago inválido'; end if;
  insert into public.purchase_orders(company_id,order_number,supplier_id,buyer_id,status,total,ordered_at,expected_at,notes)
  values(c,public.next_number('COM','public.purchase_orders',c),supplier,auth.uid(),'pedido_enviado_ao_fornecedor',total_value,current_date,nullif(p_payload->>'expected_at','')::date,p_payload->>'notes') returning id into po;
  for item in select * from jsonb_array_elements(p_payload->'items') loop
    item_name:=trim(item->>'description'); material:=null; category_id:=null;
    if nullif(item->>'material_id','') is not null then select id into material from public.materials where id=(item->>'material_id')::uuid and company_id=c; end if;
    if material is null then
      select id into category_id from public.material_categories where company_id=c and lower(name)=lower(coalesce(item->>'category','Outros')) limit 1;
      if category_id is null then insert into public.material_categories(company_id,name) values(c,coalesce(nullif(item->>'category',''),'Outros')) returning id into category_id; end if;
      select id into material from public.materials where company_id=c and lower(name)=lower(item_name) limit 1;
      if material is null then insert into public.materials(company_id,category_id,name,unit,active) values(c,category_id,item_name,coalesce(nullif(item->>'unit',''),'un'),true) returning id into material; end if;
    end if;
    insert into public.purchase_order_items(company_id,purchase_order_id,material_id,category,description,unit,requested_quantity,purchased_quantity,unit_price,supplier_id,status,notes)
    values(c,po,material,item->>'category',item_name,coalesce(nullif(item->>'unit',''),'un'),(item->>'quantity')::numeric,(item->>'quantity')::numeric,(item->>'unit_price')::numeric,supplier,'comprado',item->>'notes');
  end loop;
  if paid_value>0 then select id into entry_id from public.financial_entries where purchase_order_id=po and origin='compra'; perform public.register_payment(entry_id,paid_value,coalesce(nullif(p_payload->>'paid_at','')::date,current_date),p_payload->>'payment_method','Pagamento informado no cadastro da compra'); end if;
  return po;
end $$;

grant execute on function public.create_manual_sale(jsonb) to authenticated;
grant execute on function public.create_manual_purchase(jsonb) to authenticated;

create or replace function public.current_user_roles() returns public.app_role[]
language sql stable security definer set search_path=public as $$ select coalesce(array_agg(role),array[]::public.app_role[]) from public.user_roles where profile_id=auth.uid() $$;
grant execute on function public.current_user_roles() to authenticated;
