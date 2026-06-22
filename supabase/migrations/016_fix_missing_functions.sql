-- 016 — Correção de funções ausentes / com bug identificados na auditoria

-- 1. Fix has_table_access: usar $1/$2 posicionais para evitar ambiguidade resource (parâmetro) vs resource (coluna)
create or replace function public.has_table_access(resource text, action text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare allowed boolean;
begin
  if public.has_role(array['administrador','gerente']::public.app_role[]) then return true; end if;
  select bool_or(case $2
    when 'select' then p.can_view
    when 'insert' then p.can_create
    when 'update' then p.can_update
    when 'delete' then p.can_delete
    else false end)
  into allowed
  from public.permissions p
  join public.user_roles ur on ur.role = p.role
  where ur.profile_id = auth.uid() and p.resource = $1;
  return coalesce(allowed, false);
end $$;
grant execute on function public.has_table_access(text,text) to authenticated;

-- 2. Recriar create_gutter_quote (ausente no banco)
create or replace function public.create_gutter_quote(p_payload jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_company_id(); st uuid; q uuid; g uuid; x jsonb; sub numeric:=0;
begin
  if c is null then raise exception 'Usuário sem empresa'; end if;
  select id into st from public.sale_types where (company_id=c or company_id is null) and name ilike 'Calhas%' order by company_id nulls last limit 1;
  if st is null then raise exception 'Cadastre o tipo de venda Calhas instaladas'; end if;
  select coalesce(sum((i->>'quantity')::numeric*(i->>'meters')::numeric*(i->>'unit_price')::numeric),0) into sub from jsonb_array_elements(p_payload->'items') i;
  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,notes,valid_until)
    values(c,public.next_number('ORC','public.quotes',c),(p_payload->>'client_id')::uuid,st,auth.uid(),sub,
      coalesce((p_payload->>'discount')::numeric,0),coalesce((p_payload->>'freight')::numeric,0),
      p_payload->>'notes',current_date+coalesce(nullif((select default_validity_days from public.companies where id=c),null),15))
    returning id into q;
  insert into public.gutter_quotes(company_id,quote_id) values(c,q) returning id into g;
  for x in select * from jsonb_array_elements(p_payload->'items') loop
    insert into public.gutter_quote_items(company_id,gutter_quote_id,product,thickness,cut,color,quantity,meters,unit_price)
    values(c,g,x->>'product',x->>'thickness',x->>'cut',x->>'color',
      (x->>'quantity')::numeric,(x->>'meters')::numeric,(x->>'unit_price')::numeric);
    insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production)
    values(c,q,x->>'product',(x->>'thickness')||' · corte '||(x->>'cut'),'m',
      (x->>'quantity')::numeric*(x->>'meters')::numeric,(x->>'unit_price')::numeric,true,true);
  end loop;
  return q;
end $$;
grant execute on function public.create_gutter_quote(jsonb) to authenticated;

-- 3. Recriar register_payment (ausente no banco)
create or replace function public.register_payment(p_entry_id uuid, p_amount numeric, p_paid_at date, p_method text, p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare e public.financial_entries; pid uuid; total_paid numeric;
begin
  select * into e from public.financial_entries where id=p_entry_id and company_id=public.current_company_id() for update;
  if e.id is null then raise exception 'Lançamento não encontrado'; end if;
  if p_amount<=0 or p_amount>e.open_amount then raise exception 'Valor inválido ou superior ao saldo aberto'; end if;
  insert into public.payments(company_id,financial_entry_id,amount,paid_at,payment_method,notes,created_by)
  values(e.company_id,e.id,p_amount,p_paid_at,p_method,p_notes,auth.uid()) returning id into pid;
  select sum(amount) into total_paid from public.payments where financial_entry_id=e.id;
  update public.financial_entries set
    paid_amount=total_paid,
    paid_at=case when total_paid>=total_amount then p_paid_at else null end,
    payment_method=p_method,
    status=case when total_paid>=total_amount then 'pago'::public.financial_status else 'parcialmente_pago'::public.financial_status end
  where id=e.id;
  if e.sale_id is not null then
    update public.sales set paid_amount=total_paid,
      financial_status=case when total_paid>=total then 'pago'::public.financial_status else 'parcialmente_pago'::public.financial_status end
    where id=e.sale_id;
  end if;
  if e.purchase_order_id is not null then
    update public.purchase_orders set paid_amount=total_paid where id=e.purchase_order_id;
  end if;
  return pid;
end $$;
grant execute on function public.register_payment(uuid,numeric,date,text,text) to authenticated;

-- 4. Recriar receive_purchase_item (ausente no banco)
create or replace function public.receive_purchase_item(p_item_id uuid, p_quantity numeric, p_location_id uuid, p_unit_cost numeric default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare i public.purchase_order_items; movement uuid; all_received boolean; prod uuid;
begin
  select * into i from public.purchase_order_items where id=p_item_id and company_id=public.current_company_id() for update;
  if i.id is null or i.material_id is null then raise exception 'Item ou material inválido'; end if;
  if p_quantity<=0 or p_quantity>i.pending_quantity then raise exception 'Quantidade excede o saldo pendente'; end if;
  update public.purchase_order_items set
    received_quantity=received_quantity+p_quantity,
    status=case when received_quantity+p_quantity>=purchased_quantity then 'recebido_completo' else 'recebido_parcial' end
  where id=i.id;
  insert into public.stock_movements(company_id,material_id,location_id,movement_type,quantity,unit_cost,purchase_order_item_id,order_id,notes,created_by)
  values(i.company_id,i.material_id,p_location_id,'entrada',p_quantity,coalesce(p_unit_cost,i.unit_price),i.id,i.order_id,p_notes,auth.uid())
  returning id into movement;
  select bool_and(pending_quantity=0) into all_received from public.purchase_order_items where purchase_order_id=i.purchase_order_id;
  update public.purchase_orders set
    status=case when all_received then 'recebido_completo' else 'recebido_parcial' end,
    received_at=case when all_received then current_date else null end
  where id=i.purchase_order_id;
  if i.order_id is not null then
    update public.production_materials pm set
      received_quantity=least(pm.required_quantity,pm.received_quantity+p_quantity),
      status=case when pm.received_quantity+p_quantity>=pm.required_quantity then 'recebido_completo' else 'recebido_parcial' end
    from public.production_orders po
    where pm.production_order_id=po.id and po.order_id=i.order_id and pm.material_id=i.material_id
    returning pm.production_order_id into prod;
    if prod is not null and not exists(
      select 1 from public.production_materials where production_order_id=prod and required and received_quantity<required_quantity
    ) then
      update public.production_orders set status='liberado' where id=prod;
      update public.orders set production_status='liberado',purchase_status='recebido_completo' where id=i.order_id;
    end if;
  end if;
  return movement;
end $$;
grant execute on function public.receive_purchase_item(uuid,numeric,uuid,numeric,text) to authenticated;

-- 5. Busca global (migration 007 não aplicada)
create or replace function public.global_search(p_query text)
returns table(entity_type text,entity_id uuid,title text,subtitle text,status text,href text,priority integer)
language sql stable security invoker set search_path=public as $$
  with term as (select '%'||trim(p_query)||'%' as value), matches as (
    select 'cliente'::text,c.id,c.name,
      concat_ws(' · ',nullif(c.whatsapp,''),nullif(c.phone,''),nullif(c.city,''))::text,
      c.status::text,('/clientes/'||c.id)::text,1
    from clients c,term where length(trim(p_query))>=2
      and (c.name ilike term.value or c.phone ilike term.value or c.whatsapp ilike term.value or c.email ilike term.value or c.tax_id ilike term.value)
    union all
    select 'pedido',o.id,o.order_number,concat_ws(' · ',c.name,st.name),
      o.operational_status,('/pedidos/'||o.id),2
    from orders o join clients c on c.id=o.client_id join sale_types st on st.id=o.sale_type_id,term
    where o.order_number ilike term.value or c.name ilike term.value or c.phone ilike term.value
    union all
    select 'orçamento',q.id,q.quote_number,concat_ws(' · ',c.name,st.name),
      q.status,('/orcamentos/'||q.id),3
    from quotes q join clients c on c.id=q.client_id join sale_types st on st.id=q.sale_type_id,term
    where q.quote_number ilike term.value or c.name ilike term.value or c.phone ilike term.value
    union all
    select 'venda',s.id,s.sale_number,concat_ws(' · ',c.name,st.name),
      s.financial_status::text,('/vendas/'||s.id),4
    from sales s join clients c on c.id=s.client_id join sale_types st on st.id=s.sale_type_id,term
    where s.sale_number ilike term.value or c.name ilike term.value or c.phone ilike term.value
    union all
    select 'compra',po.id,po.order_number,sup.name,
      po.status,('/compras/'||po.id),5
    from purchase_orders po join suppliers sup on sup.id=po.supplier_id,term
    where po.order_number ilike term.value or sup.name ilike term.value
    union all
    select 'fornecedor',s.id,s.name,concat_ws(' · ',s.city,s.state),
      s.status::text,('/fornecedores/'||s.id),6
    from suppliers s,term where s.name ilike term.value or s.tax_id ilike term.value or s.phone ilike term.value
    union all
    select 'material',m.id,m.name,concat_ws(' · ',m.sku,m.unit),
      case when m.active then 'ativo' else 'inativo' end,('/estoque?material='||m.id),7
    from materials m,term where m.name ilike term.value or m.sku ilike term.value
  ) select * from matches order by priority,title limit 60
$$;
grant execute on function public.global_search(text) to authenticated;

-- 6. Relatórios (migration 007 não aplicada)
create or replace function public.reporting_summary(p_start date, p_end date) returns jsonb
language sql stable security invoker set search_path=public as $$
select jsonb_build_object(
  'sales_total',coalesce((select sum(total) from sales where created_at::date between p_start and p_end),0),
  'sales_count',(select count(*) from sales where created_at::date between p_start and p_end),
  'average_ticket',coalesce((select avg(total) from sales where created_at::date between p_start and p_end),0),
  'received',coalesce((select sum(p.amount) from payments p join financial_entries f on f.id=p.financial_entry_id where f.entry_type='receber' and p.paid_at between p_start and p_end),0),
  'paid',coalesce((select sum(p.amount) from payments p join financial_entries f on f.id=p.financial_entry_id where f.entry_type='pagar' and p.paid_at between p_start and p_end),0),
  'receivable',coalesce((select sum(open_amount) from financial_entries where entry_type='receber' and status not in ('pago','cancelado')),0),
  'payable',coalesce((select sum(open_amount) from financial_entries where entry_type='pagar' and status not in ('pago','cancelado')),0),
  'overdue_receivable',coalesce((select sum(open_amount) from financial_entries where entry_type='receber' and open_amount>0 and due_date<current_date and status<>'cancelado'),0),
  'late_purchases',(select count(*) from purchase_orders where expected_at<current_date and status not in ('recebido_completo','conferido','liberado_para_producao','cancelado')),
  'blocked_orders',(select count(*) from orders where blocked_reason is not null and operational_status<>'finalizado'),
  'waiting_materials',(select count(*) from production_orders where status='aguardando_material'),
  'quotes_open',(select count(*) from quotes where status not in ('aprovado','recusado','cancelado') and created_at::date between p_start and p_end),
  'sales_by_type',coalesce((select jsonb_agg(x order by x.total desc) from (select st.name,sum(s.total) total,count(*) quantity from sales s join sale_types st on st.id=s.sale_type_id where s.created_at::date between p_start and p_end group by st.name) x),'[]'::jsonb),
  'quotes_by_status',coalesce((select jsonb_agg(x order by x.quantity desc) from (select status,count(*) quantity,coalesce(sum(total),0) total from quotes where created_at::date between p_start and p_end group by status) x),'[]'::jsonb),
  'pipeline_by_stage',coalesce((select jsonb_agg(x order by x.sort_order) from (select ps.name,ps.color,ps.sort_order,count(l.id) quantity,coalesce(sum(l.estimated_value),0) total from pipeline_stages ps left join leads l on l.stage_id=ps.id and l.status='aberto' group by ps.id,ps.name,ps.color,ps.sort_order) x),'[]'::jsonb),
  'monthly_sales',coalesce((select jsonb_agg(x order by x.month) from (select date_trunc('month',created_at)::date month,sum(total) total,count(*) quantity from sales where created_at>=date_trunc('month',p_end::timestamp)-interval '5 months' and created_at<date_trunc('month',p_end::timestamp)+interval '1 month' group by 1) x),'[]'::jsonb)
)
$$;
grant execute on function public.reporting_summary(date,date) to authenticated;

-- 7. current_user_roles (migration 009 não aplicada)
create or replace function public.current_user_roles()
returns public.app_role[] language sql stable security definer set search_path=public as $$
  select coalesce(array_agg(role), array[]::public.app_role[]) from public.user_roles where profile_id=auth.uid()
$$;
grant execute on function public.current_user_roles() to authenticated;

-- 8. Corrigir v_financial_entries para incluir client_name e supplier_name
create or replace view public.v_financial_entries with (security_invoker=true) as
select
  fe.id, fe.company_id, fe.entry_type, fe.origin, fe.description,
  fe.total_amount, fe.paid_amount, fe.open_amount, fe.due_date,
  fe.status, fe.payment_method, fe.paid_at, fe.notes, fe.created_at,
  fe.client_id, fe.supplier_id, fe.sale_id, fe.purchase_order_id,
  c.name  as client_name,
  s.name  as supplier_name,
  case
    when fe.open_amount > 0 and fe.due_date < current_date and fe.status not in ('pago','cancelado')
    then 'vencido'
    else fe.status::text
  end as display_status
from public.financial_entries fe
left join public.clients  c on c.id = fe.client_id
left join public.suppliers s on s.id = fe.supplier_id;

-- 9. calcular_score_triagem (migration 013 — função ausente)
create or replace function public.calcular_score_triagem(session_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare sess public.triage_sessions; score int:=0; class text; prioridade text;
begin
  select * into sess from public.triage_sessions where id=session_id;
  if sess.id is null then return null; end if;
  if sess.nome       is not null then score:=score+10; end if;
  if sess.cidade     is not null then score:=score+5; end if;
  if sess.tipo_servico is not null then score:=score+10; end if;
  if sess.produto    is not null then score:=score+10; end if;
  if sess.possui_medidas then score:=score+15; end if;
  if sess.tipo_obra  is not null then score:=score+5; end if;
  if sess.linha      is not null then score:=score+5; end if;
  if sess.cor        is not null then score:=score+5; end if;
  if sess.prazo      is not null then score:=score+5; end if;
  if sess.possui_projeto then score:=score+10; end if;
  if sess.possui_fotos   then score:=score+5; end if;
  if sess.rua        is not null then score:=score+5; end if;
  if score>=80 then prioridade:='maxima'; class:='Cliente quente – conversão imediata';
  elsif score>=60 then prioridade:='alta'; class:='Boa oportunidade – agilizar proposta';
  elsif score>=40 then prioridade:='media'; class:='Oportunidade em desenvolvimento';
  else prioridade:='baixa'; class:='Coletar mais informações'; end if;
  update public.triage_sessions set score=score,prioridade=prioridade where id=session_id;
  return jsonb_build_object('score',score,'prioridade',prioridade,'classificacao',class);
end $$;
grant execute on function public.calcular_score_triagem(uuid) to authenticated;

-- 10. Seed lead_sources se faltando (espera-se 12, banco tem 3)
insert into public.lead_sources(company_id,name,channel,sort_order,active)
select c.id,ls.name,ls.channel,ls.sort_order,true
from public.companies c
cross join (values
  ('Google Ads','google',1),('Google Orgânico','google',2),('Instagram','instagram',3),
  ('Facebook','facebook',4),('Indicação de cliente','indicacao',5),('WhatsApp direto','whatsapp',6),
  ('Arquiteto','arquiteto',7),('Engenheiro','engenheiro',8),('Construtora','construtora',9),
  ('Site','site',10),('Fachada / Showroom','presencial',11),('Outros','outros',12)
) as ls(name,channel,sort_order)
where not exists(select 1 from public.lead_sources where company_id=c.id and name=ls.name);
