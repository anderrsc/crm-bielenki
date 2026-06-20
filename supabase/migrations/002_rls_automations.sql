-- Segurança, visões e automações transacionais.
create or replace function public.current_company_id() returns uuid language sql stable security definer set search_path=public as $$
  select company_id from public.profiles where id=auth.uid()
$$;

create or replace function public.has_role(roles public.app_role[]) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where profile_id=auth.uid() and role=any(roles))
$$;

create or replace function public.has_table_access(resource text, action text) returns boolean language plpgsql stable security definer set search_path=public as $$
declare allowed boolean;
begin
  if public.has_role(array['administrador','gerente']::public.app_role[]) then return true; end if;
  select case action when 'select' then p.can_view when 'insert' then p.can_create when 'update' then p.can_update when 'delete' then p.can_delete else false end
    into allowed from public.permissions p join public.user_roles ur on ur.role=p.role where ur.profile_id=auth.uid() and p.resource=resource limit 1;
  return coalesce(allowed,false);
end $$;

alter table public.companies enable row level security;
create policy company_member_select on public.companies for select using(id=public.current_company_id());
create policy company_admin_update on public.companies for update using(id=public.current_company_id() and public.has_role(array['administrador']::public.app_role[]));
alter table public.profiles enable row level security;
create policy profiles_company_select on public.profiles for select using(company_id=public.current_company_id());
create policy profiles_self_update on public.profiles for update using(id=auth.uid() or (company_id=public.current_company_id() and public.has_role(array['administrador']::public.app_role[])));
alter table public.permissions enable row level security;
create policy permissions_authenticated_read on public.permissions for select to authenticated using(true);

do $$
declare t text;
begin
  foreach t in array array['user_roles','client_types','clients','sale_types','sales','sale_items','quotes','quote_items','gutter_quotes','gutter_quote_items','orders','order_items','checklist_templates','checklist_template_items','order_checklists','order_checklist_items','supplier_categories','suppliers','purchase_requests','purchase_request_items','purchase_orders','purchase_order_items','material_categories','materials','stock_locations','stock_movements','production_orders','production_order_items','production_materials','installations','installation_checklists','financial_entries','payments','commissions','pipeline_stages','leads','activities','tasks','followups','conversations','messages','campaigns','notifications','files','audit_logs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy %I on public.%I for select using(company_id=public.current_company_id() and public.has_table_access(%L,''select''))',t||'_select',t,t);
    execute format('create policy %I on public.%I for insert with check(company_id=public.current_company_id() and public.has_table_access(%L,''insert''))',t||'_insert',t,t);
    execute format('create policy %I on public.%I for update using(company_id=public.current_company_id() and public.has_table_access(%L,''update'')) with check(company_id=public.current_company_id())',t||'_update',t,t);
    execute format('create policy %I on public.%I for delete using(company_id=public.current_company_id() and public.has_table_access(%L,''delete''))',t||'_delete',t,t);
  end loop;
end $$;

-- Perfil inicial: company_id e função devem ser definidos em app_metadata por convite administrativo.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare c uuid; r public.app_role;
begin
  c := nullif(new.raw_app_meta_data->>'company_id','')::uuid;
  if c is null then return new; end if;
  insert into public.profiles(id,company_id,full_name) values(new.id,c,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)));
  r := coalesce(nullif(new.raw_app_meta_data->>'role','')::public.app_role,'atendente');
  insert into public.user_roles(company_id,profile_id,role) values(c,new.id,r);
  return new;
end $$;
create trigger auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
do $$ declare t text; begin foreach t in array array['companies','profiles','clients','sales','quotes','orders','suppliers','purchase_orders','financial_entries'] loop execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',t||'_touch',t); end loop; end $$;

create or replace function public.next_number(prefix text, relation regclass, company uuid) returns text language plpgsql security definer set search_path=public as $$
declare n bigint;
begin execute format('select count(*)+1 from %s where company_id=$1',relation) into n using company; return prefix||'-'||to_char(current_date,'YYYY')||'-'||lpad(n::text,5,'0'); end $$;

create or replace function public.recalculate_quote() returns trigger language plpgsql security definer set search_path=public as $$
declare q uuid:=coalesce(new.quote_id,old.quote_id);
begin update public.quotes set subtotal=coalesce((select sum(total) from public.quote_items where quote_id=q),0) where id=q; return coalesce(new,old); end $$;
create trigger quote_item_totals after insert or update or delete on public.quote_items for each row execute function public.recalculate_quote();

create or replace function public.create_gutter_quote(p_payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_company_id(); st uuid; q uuid; g uuid; x jsonb; sub numeric:=0;
begin
  if c is null then raise exception 'Usuário sem empresa'; end if;
  select id into st from public.sale_types where (company_id=c or company_id is null) and name ilike 'Calhas%' order by company_id nulls last limit 1;
  if st is null then raise exception 'Cadastre o tipo de venda Calhas instaladas'; end if;
  select coalesce(sum((i->>'quantity')::numeric*(i->>'meters')::numeric*(i->>'unit_price')::numeric),0) into sub from jsonb_array_elements(p_payload->'items') i;
  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,notes,valid_until)
    values(c,public.next_number('ORC','public.quotes',c),(p_payload->>'client_id')::uuid,st,auth.uid(),sub,(p_payload->>'discount')::numeric,(p_payload->>'freight')::numeric,p_payload->>'notes',current_date+15) returning id into q;
  insert into public.gutter_quotes(company_id,quote_id) values(c,q) returning id into g;
  for x in select * from jsonb_array_elements(p_payload->'items') loop
    insert into public.gutter_quote_items(company_id,gutter_quote_id,product,thickness,cut,quantity,meters,unit_price) values(c,g,x->>'product',x->>'thickness',x->>'cut',(x->>'quantity')::numeric,(x->>'meters')::numeric,(x->>'unit_price')::numeric);
    insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production) values(c,q,x->>'product',(x->>'thickness')||' · corte '||(x->>'cut'),'m',(x->>'quantity')::numeric*(x->>'meters')::numeric,(x->>'unit_price')::numeric,true,true);
  end loop;
  return q;
end $$;

create or replace function public.approve_quote(p_quote_id uuid, p_due_date date default null) returns uuid language plpgsql security definer set search_path=public as $$
declare q public.quotes; s uuid; o uuid; ck uuid; tpl uuid; pr uuid; po uuid;
begin
  select * into q from public.quotes where id=p_quote_id and company_id=public.current_company_id() for update;
  if q.id is null then raise exception 'Orçamento não encontrado'; end if;
  if q.status='aprovado' then return q.sale_id; end if;
  insert into public.sales(company_id,sale_number,client_id,sale_type_id,seller_id,total,operational_status,next_action,next_action_date,notes)
    values(q.company_id,public.next_number('VEN','public.sales',q.company_id),q.client_id,q.sale_type_id,q.seller_id,q.total,'pedido_aberto','Confirmar entrada',current_date+2,q.notes) returning id into s;
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
end $$;

-- Uma compra com valor cria/atualiza sua conta a pagar.
create or replace function public.sync_purchase_payable() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.total>0 then
    insert into public.financial_entries(company_id,entry_type,origin,supplier_id,purchase_order_id,description,total_amount,due_date,status)
      values(new.company_id,'pagar','compra',new.supplier_id,new.id,'Compra '||new.order_number,new.total,coalesce(new.expected_at,current_date+30),'aguardando_pagamento')
      on conflict do nothing;
    update public.financial_entries set total_amount=new.total,supplier_id=new.supplier_id where purchase_order_id=new.id and origin='compra';
  end if; return new;
end $$;
create unique index financial_purchase_unique on public.financial_entries(purchase_order_id) where purchase_order_id is not null and origin='compra';
create trigger purchase_payable after insert or update of total,supplier_id on public.purchase_orders for each row execute function public.sync_purchase_payable();

create or replace function public.register_payment(p_entry_id uuid,p_amount numeric,p_paid_at date,p_method text,p_notes text default null) returns uuid language plpgsql security definer set search_path=public as $$
declare e public.financial_entries; pid uuid; total_paid numeric;
begin
  select * into e from public.financial_entries where id=p_entry_id and company_id=public.current_company_id() for update;
  if e.id is null then raise exception 'Lançamento não encontrado'; end if;
  if p_amount<=0 or p_amount>e.open_amount then raise exception 'Valor inválido ou superior ao saldo aberto'; end if;
  insert into public.payments(company_id,financial_entry_id,amount,paid_at,payment_method,notes,created_by) values(e.company_id,e.id,p_amount,p_paid_at,p_method,p_notes,auth.uid()) returning id into pid;
  select sum(amount) into total_paid from public.payments where financial_entry_id=e.id;
  update public.financial_entries set paid_amount=total_paid,paid_at=case when total_paid>=total_amount then p_paid_at else null end,payment_method=p_method,status=case when total_paid>=total_amount then 'pago'::public.financial_status else 'parcialmente_pago'::public.financial_status end where id=e.id;
  if e.sale_id is not null then update public.sales set paid_amount=total_paid,financial_status=case when total_paid>=total then 'pago'::public.financial_status else 'parcialmente_pago'::public.financial_status end where id=e.sale_id; end if;
  if e.purchase_order_id is not null then update public.purchase_orders set paid_amount=total_paid where id=e.purchase_order_id; end if;
  return pid;
end $$;

create or replace function public.receive_purchase_item(p_item_id uuid,p_quantity numeric,p_location_id uuid,p_unit_cost numeric default null,p_notes text default null) returns uuid language plpgsql security definer set search_path=public as $$
declare i public.purchase_order_items; movement uuid; all_received boolean; prod uuid;
begin
  select * into i from public.purchase_order_items where id=p_item_id and company_id=public.current_company_id() for update;
  if i.id is null or i.material_id is null then raise exception 'Item ou material inválido'; end if;
  if p_quantity<=0 or p_quantity>i.pending_quantity then raise exception 'Quantidade excede o saldo pendente'; end if;
  update public.purchase_order_items set received_quantity=received_quantity+p_quantity,status=case when received_quantity+p_quantity>=purchased_quantity then 'recebido_completo' else 'recebido_parcial' end where id=i.id;
  insert into public.stock_movements(company_id,material_id,location_id,movement_type,quantity,unit_cost,purchase_order_item_id,order_id,notes,created_by) values(i.company_id,i.material_id,p_location_id,'entrada',p_quantity,coalesce(p_unit_cost,i.unit_price),i.id,i.order_id,p_notes,auth.uid()) returning id into movement;
  select bool_and(pending_quantity=0) into all_received from public.purchase_order_items where purchase_order_id=i.purchase_order_id;
  update public.purchase_orders set status=case when all_received then 'recebido_completo' else 'recebido_parcial' end,received_at=case when all_received then current_date else null end where id=i.purchase_order_id;
  if i.order_id is not null then
    update public.production_materials pm set received_quantity=least(pm.required_quantity,pm.received_quantity+p_quantity),status=case when pm.received_quantity+p_quantity>=pm.required_quantity then 'recebido_completo' else 'recebido_parcial' end from public.production_orders po where pm.production_order_id=po.id and po.order_id=i.order_id and pm.material_id=i.material_id returning pm.production_order_id into prod;
    if not exists(select 1 from public.production_materials where production_order_id=prod and required and received_quantity<required_quantity) then update public.production_orders set status='liberado' where id=prod; update public.orders set production_status='liberado',purchase_status='recebido_completo' where id=i.order_id; end if;
  end if;
  return movement;
end $$;

create or replace function public.check_order_completion() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.order_checklist_items where order_id=new.order_id and required and status<>'concluido') then
    update public.order_checklists set status='concluido',completed_at=now() where order_id=new.order_id;
    update public.orders set operational_status='finalizado',next_action=null,next_action_date=null where id=new.order_id;
  else update public.order_checklists set status='em_andamento',completed_at=null where order_id=new.order_id; end if;
  return new;
end $$;
create trigger checklist_completion after update of status on public.order_checklist_items for each row execute function public.check_order_completion();

create or replace function public.complete_installation() returns trigger language plpgsql security definer set search_path=public as $$
declare s public.sales;
begin
  if new.status='concluida' and old.status is distinct from new.status then
    update public.orders set installation_status='concluida',next_action='Realizar pós-venda',next_action_date=current_date+3 where id=new.order_id;
    select s1.* into s from public.sales s1 join public.orders o on o.sale_id=s1.id where o.id=new.order_id;
    if s.open_amount>0 and exists(select 1 from public.financial_entries where sale_id=s.id and open_amount>0) then
      update public.financial_entries set due_date=current_date+3,notes=concat_ws(E'\n',notes,'Saldo final cobrado após instalação.') where sale_id=s.id and open_amount>0;
    elsif s.open_amount>0 then
      insert into public.financial_entries(company_id,entry_type,origin,client_id,sale_id,description,total_amount,due_date) values(s.company_id,'receber','venda',s.client_id,s.id,'Saldo final da venda '||s.sale_number,s.open_amount,current_date+3);
    end if;
    insert into public.followups(company_id,client_id,sale_id,due_at,action,status,notes) values(s.company_id,s.client_id,s.id,now()+interval '3 days','Pós-venda da instalação','pendente','Gerado automaticamente');
  end if; return new;
end $$;
create trigger installation_completed after update of status on public.installations for each row execute function public.complete_installation();

create or replace view public.v_order_overview with (security_invoker=true) as
select o.id,o.company_id,o.order_number,c.name client_name,st.name sale_type,s.total,s.paid_amount,s.open_amount,s.financial_status,o.operational_status,o.purchase_status,o.production_status,o.installation_status,o.next_action,o.next_action_date,o.blocked_reason,p.full_name current_responsible
from public.orders o join public.clients c on c.id=o.client_id join public.sale_types st on st.id=o.sale_type_id join public.sales s on s.id=o.sale_id left join public.profiles p on p.id=o.current_responsible_id;
create or replace view public.v_supplier_summary with (security_invoker=true) as
select s.id,s.company_id,s.name,s.tax_id,sc.name category,coalesce(sum(po.total),0) total_purchased,coalesce(sum(po.paid_amount),0) total_paid,coalesce(sum(po.open_amount),0) total_open,count(*) filter(where fe.status='vencido' or (fe.open_amount>0 and fe.due_date<current_date)) late_count
from public.suppliers s left join public.supplier_categories sc on sc.id=s.category_id left join public.purchase_orders po on po.supplier_id=s.id left join public.financial_entries fe on fe.purchase_order_id=po.id group by s.id,sc.name;
create or replace view public.v_stock_balance with (security_invoker=true) as
select m.id,m.company_id,m.sku,m.name,mc.name category,sl.name location,m.unit,coalesce(sum(case when sm.movement_type in ('entrada','devolucao') then sm.quantity when sm.movement_type='ajuste' then sm.quantity else -abs(sm.quantity) end),0) balance
from public.materials m left join public.material_categories mc on mc.id=m.category_id cross join public.stock_locations sl left join public.stock_movements sm on sm.material_id=m.id and sm.location_id=sl.id where sl.company_id=m.company_id group by m.id,mc.name,sl.name;
create or replace view public.v_order_materials with (security_invoker=true) as
select poi.id,poi.company_id,o.order_number,c.name client_name,st.name sale_type,oi.product,coalesce(m.name,poi.description) material_name,sup.name supplier_name,po.ordered_at,po.expected_at,po.received_at,po.status purchase_status,poi.purchased_quantity,poi.received_quantity,poi.pending_quantity,poi.status material_status,(poi.pending_quantity=0) released_for_production,poi.notes
from public.purchase_order_items poi join public.purchase_orders po on po.id=poi.purchase_order_id left join public.orders o on o.id=poi.order_id left join public.clients c on c.id=o.client_id left join public.sale_types st on st.id=o.sale_type_id left join public.order_items oi on oi.order_id=o.id left join public.materials m on m.id=poi.material_id left join public.suppliers sup on sup.id=poi.supplier_id;

create or replace function public.dashboard_summary() returns jsonb language sql stable security invoker set search_path=public as $$
select jsonb_build_object(
 'month_sales',coalesce((select sum(total) from sales where created_at>=date_trunc('month',now())),0),
 'receivable',coalesce((select sum(open_amount) from financial_entries where entry_type='receber' and status not in ('pago','cancelado')),0),
 'payable',coalesce((select sum(open_amount) from financial_entries where entry_type='pagar' and status not in ('pago','cancelado')),0),
 'blocked_orders',(select count(*) from orders where blocked_reason is not null and operational_status<>'finalizado'),
 'late_purchases',(select count(*) from purchase_orders where expected_at<current_date and status not in ('recebido_completo','conferido','liberado_para_producao','cancelado')),
 'waiting_materials',(select count(*) from production_orders where status='aguardando_material'),
 'late_followups',(select count(*) from followups where due_at<now() and status='pendente'))
$$;

grant execute on function public.dashboard_summary() to authenticated;
grant execute on function public.create_gutter_quote(jsonb) to authenticated;
grant execute on function public.approve_quote(uuid,date) to authenticated;
grant execute on function public.register_payment(uuid,numeric,date,text,text) to authenticated;
grant execute on function public.receive_purchase_item(uuid,numeric,uuid,numeric,text) to authenticated;
