begin;
-- Relatorio por fornecedor: inclui vencido, credito e saldo (deve - credito).
CREATE OR REPLACE FUNCTION public.financial_report_data(p_kind text, p_start date, p_end date, p_sale_type uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  -- Contas do periodo + credito atual com o fornecedor; saldo = o que deve menos o credito.
  select coalesce(jsonb_agg(to_jsonb(q) order by q.fornecedor),'[]'::jsonb) into result from (
   with contas as (
    select e.supplier_id,sum(e.total_amount) total,sum(e.paid_amount) pago,sum(e.open_amount) aberto,
      sum(e.open_amount) filter (where e.due_date<(now() at time zone 'America/Sao_Paulo')::date) vencido,count(*) quantidade
    from public.financial_entries e left join public.sales s on s.id=e.sale_id and s.company_id=e.company_id
    where e.company_id=c and e.entry_type='pagar' and e.status::text<>'cancelado' and e.due_date between p_start and p_end and (p_sale_type is null or s.sale_type_id=p_sale_type)
    group by e.supplier_id),
   creditos as (select supplier_id,sum(amount) credito from public.supplier_credits where company_id=c group by supplier_id having sum(amount)<>0)
   select coalesce(sp.name,'Sem fornecedor') fornecedor,coalesce(k.quantidade,0) quantidade,coalesce(k.total,0) total,coalesce(k.pago,0) pago,
     coalesce(k.aberto,0) aberto,coalesce(k.vencido,0) vencido,coalesce(cr.credito,0) credito,coalesce(k.aberto,0)-coalesce(cr.credito,0) saldo
   from contas k full join creditos cr on cr.supplier_id=k.supplier_id
   left join public.suppliers sp on sp.id=coalesce(k.supplier_id,cr.supplier_id) and sp.company_id=c
   order by 1 limit 10001) q;
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
end $function$;
revoke all on function public.financial_report_data(text,date,date,uuid,integer) from public,anon;
grant execute on function public.financial_report_data(text,date,date,uuid,integer) to authenticated;
commit;
