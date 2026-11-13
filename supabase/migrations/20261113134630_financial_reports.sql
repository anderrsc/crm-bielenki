begin;
-- Reporting classifications are explicit; no historical category is guessed.
alter table public.financial_categories add column if not exists report_group text;
do $$begin if not exists(select 1 from pg_constraint where conrelid='public.financial_categories'::regclass and conname='financial_category_report_group') then
 alter table public.financial_categories add constraint financial_category_report_group check(report_group is null or report_group in ('fabricacao','instalacao','veiculos','extraordinarias'));
end if;end $$;
insert into public.permissions(role,resource,can_view,can_create,can_update,can_delete)
 select r,'financial_exports',r::text in ('administrador','gerente','financeiro'),r::text in ('administrador','gerente','financeiro'),false,false
 from unnest(enum_range(null::public.app_role)) r on conflict(role,resource) do nothing;

create or replace function crm_private.financial_export_context(p_action text default 'select') returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=public.current_company_id();begin
 if auth.uid() is null or c is null or not exists(select 1 from public.profiles where id=auth.uid() and company_id=c and status='ativo')
 or not public.has_table_access('financial_entries','select') or not public.has_table_access('financial_exports','select') or not public.has_table_access('financial_exports',p_action)
 then raise exception 'Sem permissao para relatorios financeiros' using errcode='42501';end if;return c;end $$;
revoke all on function crm_private.financial_export_context(text) from public,anon;
grant usage on schema crm_private to authenticated;
grant execute on function crm_private.financial_export_context(text) to authenticated;

-- JSON aggregation prevents the Data API row cap from silently truncating DRE.
create or replace function public.financial_dre_data(p_start date,p_end date,p_sale_type uuid default null) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$declare result jsonb;begin
 if p_start is null or p_end is null or p_end<p_start or date_trunc('month',p_end)>date_trunc('month',p_start)+interval '35 months' then raise exception 'Selecione um periodo de ate 36 meses';end if;
 if auth.uid() is null or not public.has_table_access('financial_entries','select') or not exists(select 1 from public.profiles where id=auth.uid() and status='ativo') then raise exception 'Sem acesso financeiro' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.month,d.grp,d.category),'[]'::jsonb) into result from (select * from public.financial_dre_lines(p_start,p_end,p_sale_type) order by month,grp,category limit 10001) d;
 if jsonb_array_length(result)>10000 then raise exception 'Mais de 10000 linhas. Reduza o periodo';end if;return result;
end $$;
revoke all on function public.financial_dre_data(date,date,uuid) from public,anon;
grant execute on function public.financial_dre_data(date,date,uuid) to authenticated;

create or replace function public.financial_report_data(p_kind text,p_start date,p_end date,p_sale_type uuid default null,p_days integer default 30) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare c uuid:=crm_private.financial_export_context('select');result jsonb;begin
 if p_start is null or p_end is null or p_end<p_start or date_trunc('month',p_end)>date_trunc('month',p_start)+interval '35 months' then raise exception 'Selecione um periodo de ate 36 meses';end if;
 if p_kind in ('dre','mensal') then return public.financial_dre_data(p_start,p_end,p_sale_type);end if;
 if p_kind='caixa' then return public.cash_overview(p_days);end if;
 if p_kind='vencidos' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.due_date,q.id),'[]'::jsonb) into result from (
   select e.id,e.description,e.entry_type::text tipo,e.due_date,e.total_amount total,e.paid_amount pago,e.open_amount aberto,coalesce(cl.name,sp.name,'Sem pessoa vinculada') pessoa
   from public.financial_entries e left join public.clients cl on cl.id=e.client_id and cl.company_id=e.company_id left join public.suppliers sp on sp.id=e.supplier_id and sp.company_id=e.company_id
   left join public.sales s on s.id=e.sale_id and s.company_id=e.company_id
   where e.company_id=c and e.status::text<>'cancelado' and e.open_amount>0 and e.due_date<(now() at time zone 'America/Sao_Paulo')::date and e.due_date between p_start and p_end and (p_sale_type is null or s.sale_type_id=p_sale_type)
   order by e.due_date,e.id limit 10001) q;
 elsif p_kind='fornecedores' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.fornecedor),'[]'::jsonb) into result from (
   select coalesce(sp.name,'Sem fornecedor') fornecedor,sum(e.total_amount) total,sum(e.paid_amount) pago,sum(e.open_amount) aberto,count(*) quantidade
   from public.financial_entries e left join public.suppliers sp on sp.id=e.supplier_id and sp.company_id=e.company_id left join public.sales s on s.id=e.sale_id and s.company_id=e.company_id
   where e.company_id=c and e.entry_type='pagar' and e.status::text<>'cancelado' and e.due_date between p_start and p_end and (p_sale_type is null or s.sale_type_id=p_sale_type)
   group by sp.id,sp.name order by sp.name limit 10001) q;
 elsif p_kind='clientes' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.cliente),'[]'::jsonb) into result from (
   select coalesce(cl.name,'Sem cliente') cliente,sum(p.amount) recebido,count(*) baixas
   from public.payments p join public.financial_entries e on e.id=p.financial_entry_id and e.company_id=p.company_id
   left join public.sales s on s.id=e.sale_id and s.company_id=e.company_id left join public.clients cl on cl.id=coalesce(e.client_id,s.client_id) and cl.company_id=e.company_id
   where p.company_id=c and p.reversed_at is null and e.entry_type='receber' and p.paid_at between p_start and p_end and (p_sale_type is null or s.sale_type_id=p_sale_type)
   group by cl.id,cl.name order by cl.name limit 10001) q;
 elsif p_kind in ('obras','setores','orcado_realizado') then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.order_number),'[]'::jsonb) into result from (
   select f.*,st.name setor,o.created_at::date data_obra
   from public.v_order_financial_report f join public.orders o on o.id=f.order_id and o.company_id=f.company_id left join public.sale_types st on st.id=o.sale_type_id and st.company_id=o.company_id
   where f.company_id=c and (o.created_at at time zone 'America/Sao_Paulo')::date between p_start and p_end and (p_sale_type is null or o.sale_type_id=p_sale_type)
   order by f.order_number limit 10001) q;
 elsif p_kind='materiais' then
  if not public.has_table_access('purchase_orders','select') then raise exception 'Sem acesso a compras' using errcode='42501';end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.mes,q.material),'[]'::jsonb) into result from (
   select date_trunc('month',coalesce(po.ordered_at,(po.created_at at time zone 'America/Sao_Paulo')::date))::date mes,coalesce(m.name,i.description) material,i.unit unidade,
   sum(i.purchased_quantity) quantidade,sum(i.total) custo,round(sum(i.total)/nullif(sum(i.purchased_quantity),0),4) custo_medio
   from public.purchase_order_items i join public.purchase_orders po on po.id=i.purchase_order_id and po.company_id=i.company_id left join public.materials m on m.id=i.material_id and m.company_id=i.company_id
   left join public.orders o on o.id=coalesce(i.order_id,po.order_id) and o.company_id=i.company_id
   where i.company_id=c and po.status not in ('cancelado','cancelada','solicitacao_criada') and i.purchased_quantity>0
   and coalesce(po.ordered_at,(po.created_at at time zone 'America/Sao_Paulo')::date) between p_start and p_end and (p_sale_type is null or o.sale_type_id=p_sale_type)
   group by 1,m.id,coalesce(m.name,i.description),i.unit order by 1,2 limit 10001) q;
 elsif p_kind in ('fabricacao','instalacao','veiculos','extraordinarias') then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.competencia,q.id),'[]'::jsonb) into result from (
   select e.id,e.description,fc.name categoria,cc.name centro,coalesce(e.competence_date,(e.created_at at time zone 'America/Sao_Paulo')::date) competencia,e.total_amount total,e.paid_amount pago,e.open_amount aberto
   from public.financial_entries e join public.financial_categories fc on fc.id=e.category_id and fc.company_id=e.company_id left join public.financial_cost_centers cc on cc.id=e.cost_center_id and cc.company_id=e.company_id
   left join public.sales s on s.id=e.sale_id and s.company_id=e.company_id
   where e.company_id=c and e.entry_type='pagar' and e.status::text<>'cancelado' and fc.report_group=p_kind
   and coalesce(e.competence_date,(e.created_at at time zone 'America/Sao_Paulo')::date) between p_start and p_end and (p_sale_type is null or s.sale_type_id=p_sale_type)
   order by 5,e.id limit 10001) q;
 elsif p_kind='executivo' then
  return public.financial_control_totals(p_from=>p_start,p_to=>p_end,p_sale_type=>p_sale_type);
 else raise exception 'Relatorio invalido';end if;
 if jsonb_array_length(result)>10000 then raise exception 'Mais de 10000 linhas. Reduza o periodo ou refine o tipo de venda';end if;
 return result;
end $$;
revoke all on function public.financial_report_data(text,date,date,uuid,integer) from public,anon;
grant execute on function public.financial_report_data(text,date,date,uuid,integer) to authenticated;

create or replace function crm_private.record_financial_export(p_kind text,p_format text,p_filters jsonb,p_rows integer) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=crm_private.financial_export_context('insert');begin
 if p_kind is null or p_format is null or p_rows is null or p_filters is null or jsonb_typeof(p_filters)<>'object' or p_kind not in ('dre','mensal','caixa','vencidos','fornecedores','clientes','obras','setores','orcado_realizado','materiais','fabricacao','instalacao','veiculos','extraordinarias','executivo') or p_format not in ('pdf','csv') or p_rows not between 0 and 10000 or octet_length(p_filters::text)>4096 then raise exception 'Exportacao invalida';end if;
 insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,new_data) values(c,auth.uid(),'financial_exports',auth.uid(),'EXPORT',jsonb_build_object('report',p_kind,'format',p_format,'filters',p_filters,'rows',p_rows));
end $$;
revoke all on function crm_private.record_financial_export(text,text,jsonb,integer) from public,anon;
grant execute on function crm_private.record_financial_export(text,text,jsonb,integer) to authenticated;
create or replace function public.record_financial_export(p_kind text,p_format text,p_filters jsonb,p_rows integer) returns void language sql security invoker set search_path=pg_catalog as $$select crm_private.record_financial_export(p_kind,p_format,p_filters,p_rows)$$;
revoke all on function public.record_financial_export(text,text,jsonb,integer) from public,anon;
grant execute on function public.record_financial_export(text,text,jsonb,integer) to authenticated;
create or replace view public.v_order_financial_report with (security_invoker=true) as
with alloc as (
  select a.order_id, a.company_id,
    sum(round(a.amount * e.total_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='pagar') as cost_total,
    sum(round(a.amount * e.paid_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='pagar') as cost_paid,
    sum(round(a.amount * e.total_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='receber' and e.sale_id is null) as extra_revenue,
    sum(round(a.amount * e.paid_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='receber' and e.sale_id is null) as extra_received,
    sum(round(a.amount * e.open_amount / nullif(t.total,0), 2)) filter (where e.entry_type::text='receber' and e.sale_id is null) as extra_receivable
  from public.financial_entry_allocations a
  join public.financial_entries e on e.id=a.entry_id and e.company_id=a.company_id and e.status::text<>'cancelado'
  join (select entry_id, sum(amount) total from public.financial_entry_allocations group by entry_id) t on t.entry_id=a.entry_id
  where a.order_id is not null
  group by a.order_id, a.company_id
), direct as (
  select o.id order_id, sum(e.total_amount) cost_total, sum(e.paid_amount) cost_paid
  from public.orders o
  join public.financial_entries e on e.sale_id=o.sale_id and e.company_id=o.company_id and e.entry_type::text='pagar' and e.status::text<>'cancelado'
  where not exists(select 1 from public.financial_entry_allocations a where a.entry_id=e.id)
  group by o.id
)
select o.id as order_id, o.company_id, o.order_number, o.sale_id, c.name as client_name,
  s.total as contracted, s.paid_amount as received, s.open_amount as receivable,
  coalesce(al.extra_revenue,0) as extra_revenue,
  coalesce(al.cost_total,0) + coalesce(d.cost_total,0) as cost_total,
  coalesce(al.cost_paid,0) + coalesce(d.cost_paid,0) as cost_paid,
  s.total + coalesce(al.extra_revenue,0) - coalesce(al.cost_total,0) - coalesce(d.cost_total,0) as margin, true as margin_partial,
  s.paid_amount + coalesce(al.extra_received,0) as received_total,
  s.open_amount + coalesce(al.extra_receivable,0) as receivable_total
from public.orders o
join public.sales s on s.id=o.sale_id and s.company_id=o.company_id
left join public.clients c on c.id=o.client_id and c.company_id=o.company_id
left join alloc al on al.order_id=o.id and al.company_id=o.company_id
left join direct d on d.order_id=o.id;
revoke all on public.v_order_financial_report from public,anon;
grant select on public.v_order_financial_report to authenticated;

commit;
