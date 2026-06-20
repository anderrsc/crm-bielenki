-- Busca global e agregações dos relatórios. Ambas respeitam o RLS do usuário.
insert into public.permissions(role,resource,can_view,can_create,can_update,can_delete)
select role,'pipeline_stages',true,false,false,false from unnest(array['vendedor','compras','producao','estoque','instalador','financeiro','atendente']::public.app_role[]) role
on conflict(role,resource) do update set can_view=true;

create or replace function public.global_search(p_query text)
returns table(entity_type text,entity_id uuid,title text,subtitle text,status text,href text,priority integer)
language sql stable security invoker set search_path=public as $$
  with term as (select '%'||trim(p_query)||'%' value), matches as (
    select 'cliente'::text,c.id,c.name,concat_ws(' · ',nullif(c.whatsapp,''),nullif(c.phone,''),nullif(c.city,''))::text,c.status::text,('/clientes/'||c.id)::text,1
    from clients c,term where length(trim(p_query))>=2 and (c.name ilike term.value or c.phone ilike term.value or c.whatsapp ilike term.value or c.email ilike term.value or c.tax_id ilike term.value)
    union all
    select 'pedido',o.id,o.order_number,concat_ws(' · ',c.name,st.name),o.operational_status,('/pedidos/'||o.id),2
    from orders o join clients c on c.id=o.client_id join sale_types st on st.id=o.sale_type_id,term where o.order_number ilike term.value or c.name ilike term.value or c.phone ilike term.value
    union all
    select 'orçamento',q.id,q.quote_number,concat_ws(' · ',c.name,st.name),q.status,('/orcamentos/'||q.id),3
    from quotes q join clients c on c.id=q.client_id join sale_types st on st.id=q.sale_type_id,term where q.quote_number ilike term.value or c.name ilike term.value or c.phone ilike term.value
    union all
    select 'venda',s.id,s.sale_number,concat_ws(' · ',c.name,st.name),s.financial_status::text,('/vendas/'||s.id),4
    from sales s join clients c on c.id=s.client_id join sale_types st on st.id=s.sale_type_id,term where s.sale_number ilike term.value or c.name ilike term.value or c.phone ilike term.value
    union all
    select 'compra',po.id,po.order_number,sup.name,po.status,('/compras/'||po.id),5
    from purchase_orders po join suppliers sup on sup.id=po.supplier_id,term where po.order_number ilike term.value or sup.name ilike term.value
    union all
    select 'fornecedor',s.id,s.name,concat_ws(' · ',s.category_id::text,s.city,s.state),s.status::text,('/fornecedores/'||s.id),6
    from suppliers s,term where s.name ilike term.value or s.tax_id ilike term.value or s.phone ilike term.value
    union all
    select 'material',m.id,m.name,concat_ws(' · ',m.sku,m.unit),case when m.active then 'ativo' else 'inativo' end,('/estoque?material='||m.id),7
    from materials m,term where m.name ilike term.value or m.sku ilike term.value
  ) select * from matches order by priority,title limit 60
$$;
grant execute on function public.global_search(text) to authenticated;

create or replace function public.reporting_summary(p_start date,p_end date) returns jsonb
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
  'pipeline_by_stage',coalesce((select jsonb_agg(x order by x.sort_order) from (select ps.name,ps.color,ps.sort_order,count(l.id) quantity,coalesce(sum(l.estimated_value),0) total from pipeline_stages ps left join leads l on l.stage_id=ps.id and l.status='aberto' group by ps.id) x),'[]'::jsonb),
  'monthly_sales',coalesce((select jsonb_agg(x order by x.month) from (select date_trunc('month',created_at)::date month,sum(total) total,count(*) quantity from sales where created_at>=date_trunc('month',p_end::timestamp)-interval '5 months' and created_at<date_trunc('month',p_end::timestamp)+interval '1 month' group by 1) x),'[]'::jsonb)
)
$$;
grant execute on function public.reporting_summary(date,date) to authenticated;
