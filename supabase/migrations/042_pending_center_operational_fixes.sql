-- Correct pending categories, schema references, permissions and completed states.
BEGIN;

CREATE OR REPLACE FUNCTION public.pending_center()
RETURNS TABLE (
  record_id   UUID,
  category    TEXT,
  priority    TEXT,
  title       TEXT,
  subtitle    TEXT,
  link        TEXT,
  due_date    DATE,
  days_late   INTEGER,
  amount      NUMERIC,
  client_name TEXT
) LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_cid UUID;
BEGIN
  SELECT p.company_id INTO v_cid FROM public.profiles p WHERE p.id = auth.uid() AND p.status = 'ativo';
  IF v_cid IS NULL THEN RETURN; END IF;

  -- Orçamentos pendentes > 2 dias
  RETURN QUERY
  SELECT q.id AS record_id, 'orcamento'::TEXT,
    CASE WHEN q.created_at < NOW() - INTERVAL '7 days' THEN 'high'
         WHEN q.created_at < NOW() - INTERVAL '3 days' THEN 'medium'
         ELSE 'low' END,
    ('Orçamento ' || q.quote_number)::TEXT,
    CASE WHEN q.status='rascunho' THEN 'Preparar e enviar ao cliente' ELSE 'Aguardando resposta do cliente' END::TEXT,
    ('/orcamentos/' || q.id)::TEXT,
    q.valid_until,
    CASE WHEN q.valid_until < CURRENT_DATE THEN (CURRENT_DATE - q.valid_until)::INT ELSE NULL END,
    q.total,
    c.name
  FROM public.quotes q JOIN public.clients c ON c.id = q.client_id AND c.company_id = q.company_id
  WHERE q.company_id = v_cid AND public.has_table_access('quotes','select') AND q.status IN ('rascunho','enviado','pendente')
    AND (q.status='rascunho' OR q.created_at < NOW() - INTERVAL '2 days')
  ORDER BY q.created_at ASC;

  -- Financeiro vencido
  RETURN QUERY
  SELECT fe.id AS record_id, ('financeiro_' || fe.entry_type)::TEXT,
    CASE WHEN (CURRENT_DATE - fe.due_date) > 15 THEN 'high'
         WHEN (CURRENT_DATE - fe.due_date) > 7  THEN 'medium'
         ELSE 'low' END,
    fe.description::TEXT,
    ('Vencida há ' || (CURRENT_DATE - fe.due_date)::TEXT || ' dias')::TEXT,
    '/financeiro'::TEXT,
    fe.due_date,
    (CURRENT_DATE - fe.due_date)::INT,
    fe.open_amount,
    COALESCE(cl.name, sup.name)
  FROM public.financial_entries fe
  LEFT JOIN public.clients   cl  ON cl.id  = fe.client_id AND cl.company_id = fe.company_id
  LEFT JOIN public.suppliers sup ON sup.id = fe.supplier_id AND sup.company_id = fe.company_id
  WHERE fe.company_id = v_cid AND public.has_table_access('financial_entries','select')
    AND fe.status IN ('aguardando_pagamento','parcialmente_pago','vencido')
    AND fe.open_amount > 0
    AND fe.due_date < CURRENT_DATE
  ORDER BY fe.due_date ASC;

  -- Produções atrasadas
  RETURN QUERY
  SELECT po.id AS record_id, 'producao'::TEXT, 'high'::TEXT,
    ('Produção ' || po.production_number)::TEXT,
    CASE WHEN po.planned_end IS NOT NULL AND po.planned_end < CURRENT_DATE
         THEN ('Atrasada ' || (CURRENT_DATE - po.planned_end)::TEXT || ' dias')
         ELSE 'Em produção há mais de 7 dias' END::TEXT,
    ('/producao/' || po.id)::TEXT,
    po.planned_end,
    CASE WHEN po.planned_end IS NOT NULL THEN (CURRENT_DATE - po.planned_end)::INT ELSE NULL END,
    NULL::NUMERIC, c.name
  FROM public.production_orders po
  JOIN public.orders  o ON o.id = po.order_id AND o.company_id = po.company_id
  JOIN public.clients c ON c.id = o.client_id AND c.company_id = o.company_id
  WHERE po.company_id = v_cid AND public.has_table_access('production_orders','select') AND po.status NOT IN ('concluido','concluida','finalizado','cancelado')
    AND ((po.planned_end IS NOT NULL AND po.planned_end < CURRENT_DATE)
         OR po.started_at < NOW() - INTERVAL '7 days')
  ORDER BY po.planned_end ASC NULLS LAST;

  -- Compras aguardando
  RETURN QUERY
  SELECT pu.id AS record_id, 'compra'::TEXT,
    CASE WHEN pu.expected_at IS NOT NULL AND pu.expected_at < CURRENT_DATE THEN 'medium' ELSE 'low' END,
    ('Compra ' || pu.order_number)::TEXT,
    'Aguardando recebimento'::TEXT,
    ('/compras/' || pu.id)::TEXT,
    pu.expected_at,
    CASE WHEN pu.expected_at IS NOT NULL THEN (CURRENT_DATE - pu.expected_at)::INT ELSE NULL END,
    pu.total, sup.name
  FROM public.purchase_orders pu JOIN public.suppliers sup ON sup.id = pu.supplier_id AND sup.company_id = pu.company_id
  WHERE pu.company_id = v_cid AND public.has_table_access('purchase_orders','select') AND pu.status NOT IN ('concluido','cancelado','recebido_completo','conferido','liberado_para_producao')
  ORDER BY pu.expected_at ASC NULLS LAST;

  -- Instalações próximas 48h
  RETURN QUERY
  SELECT i.id AS record_id, 'instalacao'::TEXT, CASE WHEN i.scheduled_at < NOW() THEN 'high' ELSE 'medium' END::TEXT,
    ('Instalação — ' || c.name)::TEXT,
    COALESCE('Agendada para ' || TO_CHAR(i.scheduled_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'), 'Sem data agendada')::TEXT,
    ('/instalacoes/' || i.id)::TEXT,
    (i.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::DATE, NULL::INT, NULL::NUMERIC, c.name
  FROM public.installations i
  JOIN public.orders  o ON o.id = i.order_id AND o.company_id = i.company_id
  JOIN public.clients c ON c.id = o.client_id AND c.company_id = o.company_id
  WHERE i.company_id = v_cid AND public.has_table_access('installations','select') AND i.status IN ('nao_agendada','agendada','em_andamento')
    AND (i.scheduled_at IS NULL OR i.scheduled_at < NOW() + INTERVAL '48 hours')
  ORDER BY i.scheduled_at ASC;

  -- Medições pendentes
  RETURN QUERY
  SELECT m.id AS record_id, 'medicao'::TEXT,
    CASE WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at < NOW() - INTERVAL '24 hours' THEN 'high'
         WHEN m.scheduled_at IS NULL THEN 'medium' ELSE 'low' END,
    ('Medição ' || COALESCE(m.measurement_number, '—'))::TEXT,
    CASE WHEN m.scheduled_at IS NULL THEN 'Sem data agendada'
         ELSE ('Agendada ' || TO_CHAR(m.scheduled_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'))
    END::TEXT,
    ('/medicoes/' || m.id)::TEXT,
    (m.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::DATE,
    CASE WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at < NOW()
         THEN EXTRACT(DAY FROM NOW() - m.scheduled_at)::INT ELSE NULL END,
    NULL::NUMERIC, c.name
  FROM public.measurements m LEFT JOIN public.clients c ON c.id = m.client_id AND c.company_id = m.company_id
  WHERE m.company_id = v_cid AND public.has_table_access('measurements','select') AND m.status IN ('agendado','confirmado','reagendado','em_deslocamento','em_medicao')
    AND (m.scheduled_at IS NULL OR m.scheduled_at < NOW() + INTERVAL '48 hours')
  ORDER BY m.scheduled_at ASC NULLS FIRST;

END;
$$;

REVOKE ALL ON FUNCTION public.pending_center() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pending_center() TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_executivo()
RETURNS JSON LANGUAGE plpgsql SECURITY INVOKER STABLE SET search_path = public AS $$
DECLARE
  v_cid UUID;
  v_result JSON;
  v_inicio  DATE := DATE_TRUNC('month', CURRENT_DATE)::DATE;
  v_fim     DATE := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE;
  v_ant_ini DATE := (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::DATE;
  v_ant_fim DATE := (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day')::DATE;
BEGIN
  SELECT company_id INTO v_cid FROM public.profiles WHERE id = auth.uid();
  IF v_cid IS NULL THEN RETURN '{}'::JSON; END IF;

  SELECT json_build_object(
    -- Leads
    'leads_mes',      (SELECT COUNT(*)              FROM public.leads WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim),
    'leads_mes_ant',  (SELECT COUNT(*)              FROM public.leads WHERE company_id = v_cid AND created_at::DATE BETWEEN v_ant_ini AND v_ant_fim),
    -- Vendas
    'vendas_mes',     (SELECT COALESCE(SUM(total),0) FROM public.sales WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim),
    'vendas_mes_ant', (SELECT COALESCE(SUM(total),0) FROM public.sales WHERE company_id = v_cid AND created_at::DATE BETWEEN v_ant_ini AND v_ant_fim),
    'qtd_vendas_mes', (SELECT COUNT(*)               FROM public.sales WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim),
    -- Ticket médio
    'ticket_medio',   (SELECT COALESCE(AVG(total),0) FROM public.sales WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim),
    -- Taxa de conversão
    'taxa_conversao', (
      SELECT CASE WHEN leads_tot > 0 THEN ROUND((vendas_tot::NUMERIC / leads_tot * 100)::NUMERIC, 1) ELSE 0 END
      FROM (
        SELECT
          (SELECT COUNT(*) FROM public.leads WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim) AS leads_tot,
          (SELECT COUNT(*) FROM public.sales WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim) AS vendas_tot
      ) sub
    ),
    -- Orçamentos
    'orcamentos_mes',       (SELECT COUNT(*) FROM public.quotes WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim),
    'orcamentos_pendentes', (SELECT COUNT(*) FROM public.quotes WHERE company_id = v_cid AND status IN ('enviado','pendente')),
    -- Operação
    'em_producao',        (SELECT COUNT(*) FROM public.production_orders WHERE company_id = v_cid AND status NOT IN ('concluido','finalizado','cancelado','recebido_completo','conferido','liberado_para_producao')),
    'instalacoes_hoje',   (SELECT COUNT(*) FROM public.installations WHERE company_id = v_cid AND status IN ('agendada','em_andamento') AND scheduled_at::DATE = CURRENT_DATE),
    'compras_pendentes',  (SELECT COUNT(*) FROM public.purchase_orders WHERE company_id = v_cid AND status NOT IN ('concluido','finalizado','cancelado','recebido_completo','conferido','liberado_para_producao')),
    -- Financeiro
    'receitas_abertas',   (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'receber' AND status NOT IN ('pago','cancelado')),
    'despesas_abertas',   (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'pagar'  AND status NOT IN ('pago','cancelado')),
    'receitas_mes',       (SELECT COALESCE(SUM(amount),0) FROM public.payments p JOIN public.financial_entries fe ON fe.id = p.financial_entry_id WHERE fe.company_id = v_cid AND fe.entry_type = 'receber' AND p.reversed_at IS NULL AND p.paid_at BETWEEN v_inicio AND v_fim),
    'despesas_mes',       (SELECT COALESCE(SUM(amount),0) FROM public.payments p JOIN public.financial_entries fe ON fe.id = p.financial_entry_id WHERE fe.company_id = v_cid AND fe.entry_type = 'pagar'  AND p.reversed_at IS NULL AND p.paid_at BETWEEN v_inicio AND v_fim),
    'overdue_receivable', (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'receber' AND status IN ('aguardando_pagamento','parcialmente_pago') AND due_date < CURRENT_DATE),
    'overdue_payable',    (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'pagar'  AND status IN ('aguardando_pagamento','parcialmente_pago') AND due_date < CURRENT_DATE),
    'due_today',          (SELECT COUNT(*) FROM public.financial_entries WHERE company_id = v_cid AND status IN ('aguardando_pagamento','parcialmente_pago') AND due_date = CURRENT_DATE),
    -- Top vendedores do mês
    'top_vendedores', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (row_to_json(t)->>'total_vendido')::NUMERIC DESC), '[]'::JSON)
      FROM (
        SELECT
          COALESCE(p.full_name, 'Sem vendedor')   AS nome,
          COUNT(*)::INT                              AS qtd_vendas,
          COALESCE(SUM(s.total), 0)                 AS total_vendido
        FROM public.sales s
        LEFT JOIN public.profiles p ON p.id=s.seller_id AND p.company_id=s.company_id
        WHERE s.company_id = v_cid
          AND s.created_at::DATE BETWEEN v_inicio AND v_fim
        GROUP BY COALESCE(p.full_name, 'Sem vendedor')
        ORDER BY total_vendido DESC
        LIMIT 5
      ) t
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;


CREATE OR REPLACE VIEW public.v_operational_agenda WITH (security_invoker = true) AS
  SELECT
    e.id, e.company_id, e.event_type,
    e.title, e.starts_at, e.ends_at, e.status, e.notes,
    COALESCE(c.name, e.client_name)          AS client_name,
    COALESCE(p.full_name, e.responsible_name) AS responsible_name,
    'operational_events'::text AS source
  FROM public.operational_events e
  LEFT JOIN public.clients  c ON c.id = e.client_id  AND c.company_id = e.company_id
  LEFT JOIN public.profiles p ON p.id = e.responsible_id AND p.company_id = e.company_id

  UNION ALL

  SELECT
    m.id, m.company_id, 'medicao'::TEXT AS event_type,
    COALESCE('Medição - ' || c.name, 'Medição técnica') AS title,
    m.scheduled_at AS starts_at, NULL AS ends_at,
    m.status, m.notes,
    c.name AS client_name,
    p.full_name AS responsible_name,
    'measurements'::text AS source
  FROM public.measurements m
  LEFT JOIN public.clients  c ON c.id = m.client_id  AND c.company_id = m.company_id
  LEFT JOIN public.profiles p ON p.id = m.responsible_id AND p.company_id = m.company_id
  WHERE m.scheduled_at IS NOT NULL

  UNION ALL

  SELECT
    i.id, i.company_id, 'instalacao'::TEXT AS event_type,
    COALESCE('Instalação - Pedido ' || o.order_number, 'Instalação') AS title,
    i.scheduled_at AS starts_at, i.completed_at AS ends_at,
    i.status, i.notes,
    c.name AS client_name,
    p.full_name AS responsible_name,
    'installations'::text AS source
  FROM public.installations i
  LEFT JOIN public.orders   o ON o.id = i.order_id    AND o.company_id = i.company_id
  LEFT JOIN public.clients  c ON c.id = o.client_id   AND c.company_id = i.company_id
  LEFT JOIN public.profiles p ON p.id = i.responsible_id AND p.company_id = i.company_id
  WHERE i.scheduled_at IS NOT NULL

  UNION ALL

  SELECT
    t.id, t.company_id, 'tarefa'::TEXT AS event_type,
    t.title, t.due_at AS starts_at, NULL AS ends_at,
    t.status, t.description AS notes,
    NULL AS client_name,
    p.full_name AS responsible_name,
    'tasks'::text AS source
  FROM public.tasks t
  LEFT JOIN public.profiles p ON p.id = t.assigned_to AND p.company_id = t.company_id
  WHERE t.due_at IS NOT NULL;

GRANT SELECT ON public.v_operational_agenda TO authenticated;



CREATE OR REPLACE FUNCTION public.reschedule_entry(p_entry_id UUID, p_new_due_date DATE, p_reason TEXT DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company_id UUID := public.current_company_id();
BEGIN
  PERFORM public.require_table_access('financial_entries','update');
  IF p_new_due_date IS NULL THEN RAISE EXCEPTION 'Data de vencimento obrigatória'; END IF;
  PERFORM 1 FROM public.financial_entries fe WHERE fe.id=p_entry_id AND fe.company_id=v_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;
  UPDATE public.financial_entries SET due_date=p_new_due_date,updated_at=NOW() WHERE id=p_entry_id AND company_id=v_company_id;
  INSERT INTO public.audit_logs(company_id,profile_id,table_name,record_id,action,new_data)
  VALUES(v_company_id,auth.uid(),'financial_entries',p_entry_id,'RESCHEDULE',jsonb_build_object('new_due_date',p_new_due_date,'reason',p_reason));
END; $$;
REVOKE ALL ON FUNCTION public.reschedule_entry(UUID,DATE,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_entry(UUID,DATE,TEXT) TO authenticated;
create or replace function public.global_search(p_query text)
returns table(entity_type text,entity_id uuid,title text,subtitle text,status text,href text,priority integer)
language sql stable security invoker set search_path=public as $$
  with term as (select '%'||trim(p_query)||'%' as value where length(trim(p_query))>=2), matches as (
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
  ) select * from matches order by 7,3 limit 60
$$;
grant execute on function public.global_search(text) to authenticated;

create or replace function public.reporting_summary(p_start date, p_end date) returns jsonb
language sql stable security invoker set search_path=public as $$
select jsonb_build_object(
  'sales_total',coalesce((select sum(total) from sales where created_at::date between p_start and p_end),0),
  'sales_count',(select count(*) from sales where created_at::date between p_start and p_end),
  'average_ticket',coalesce((select avg(total) from sales where created_at::date between p_start and p_end),0),
  'received',coalesce((select sum(p.amount) from payments p join financial_entries f on f.id=p.financial_entry_id where f.entry_type='receber' and p.reversed_at is null and p.paid_at between p_start and p_end),0),
  'paid',coalesce((select sum(p.amount) from payments p join financial_entries f on f.id=p.financial_entry_id where f.entry_type='pagar' and p.reversed_at is null and p.paid_at between p_start and p_end),0),
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
  'monthly_sales',coalesce((select jsonb_agg(x order by x.mes) from (select date_trunc('month',created_at)::date mes,sum(total) total,count(*) quantity from sales where created_at>=date_trunc('month',p_end::timestamp)-interval '5 months' and created_at<date_trunc('month',p_end::timestamp)+interval '1 month' group by 1) x),'[]'::jsonb)
)
$$;
grant execute on function public.reporting_summary(date,date) to authenticated;


-- Keep dashboard summaries subject to the same table permissions as lists.
ALTER FUNCTION public.dashboard_summary() SECURITY INVOKER;
ALTER TABLE public.gutter_prices ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.gutter_prices DROP CONSTRAINT IF EXISTS gutter_prices_company_id_product_thickness_cut_mm_key;
CREATE UNIQUE INDEX IF NOT EXISTS gutter_prices_variant_unique ON public.gutter_prices(company_id,product,thickness,cut_mm,color);

create or replace function public.advance_production_step(
  p_production_order_id uuid, p_responsible_id uuid default null, p_notes text default null
) returns integer language plpgsql security definer set search_path=public as $$
declare po public.production_orders; total_steps integer; step_name text; next_step integer;
begin
  perform public.require_table_access('production_orders','update');
  select * into po from public.production_orders
    where id=p_production_order_id and company_id=public.current_company_id() for update;
  if po.id is null then raise exception 'Ordem de producao nao encontrada'; end if;
  if po.status in ('aguardando_material','cancelado') or exists(select 1 from public.production_materials pm where pm.production_order_id=po.id and pm.required and pm.received_quantity<pm.required_quantity) then raise exception 'Produção bloqueada: material não liberado'; end if;
  total_steps:=case when po.flow_type='esquadrias' then 9 else 7 end;
  if po.current_step<1 or po.current_step>total_steps then raise exception 'Fluxo de producao ja finalizado'; end if;
  if p_responsible_id is not null and not exists(
    select 1 from public.profiles where id=p_responsible_id and company_id=po.company_id and status='ativo'
  ) then raise exception 'Responsavel invalido'; end if;
  step_name:=(case when po.flow_type='esquadrias' then
    array['Medicao','Projeto','Corte','Usinagem','Montagem','Solda','Acabamento','Pintura','Controle de Qualidade']
  else array['Medicao','Corte','Dobra','Pintura','Agendamento','Instalacao','Pos-venda'] end)[po.current_step];
  insert into public.production_step_logs(
    company_id,production_order_id,step_number,step_name,started_at,completed_at,responsible_id,notes
  ) values(po.company_id,po.id,po.current_step,step_name,now(),now(),p_responsible_id,p_notes)
  on conflict(production_order_id,step_number) do update set
    step_name=excluded.step_name,completed_at=excluded.completed_at,
    responsible_id=excluded.responsible_id,notes=excluded.notes;
  next_step:=po.current_step+1;
  update public.production_orders set current_step=next_step,
    status=case when next_step>total_steps then 'finalizado' else 'em_producao' end
  where id=po.id;
  return next_step;
end $$;
revoke all on function public.advance_production_step(uuid,uuid,text) from public;
grant execute on function public.advance_production_step(uuid,uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION public.create_order_checklist(p_order_id UUID, p_type TEXT DEFAULT 'calhas')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c UUID;
  checklist_id UUID;
  items TEXT[];
  item TEXT;
  i INT := 1;
BEGIN
  PERFORM public.require_table_access('orders','update');
  SELECT company_id INTO c FROM public.orders WHERE id = p_order_id AND company_id=public.current_company_id() FOR UPDATE;
  IF c IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;

  IF EXISTS(SELECT 1 FROM public.order_checklist_items WHERE order_id=p_order_id) THEN RETURN; END IF;
  INSERT INTO public.order_checklists(company_id,order_id) VALUES(c,p_order_id) ON CONFLICT(order_id) DO NOTHING;
  SELECT id INTO checklist_id FROM public.order_checklists WHERE order_id=p_order_id AND company_id=c;

  IF p_type = 'esquadrias' THEN
    items := ARRAY[
      'Medidas finais conferidas',
      'Linha e modelo definidos',
      'Cor escolhida e aprovada',
      'Vidro especificado',
      'Ferragens definidas',
      'Acessórios listados',
      'Contramarcos medidos',
      'Arremates definidos',
      'Conferência técnica realizada',
      'Lista de perfis emitida',
      'Lista de acessórios emitida',
      'Lista de vidros emitida',
      'Compra de perfis realizada',
      'Compra de acessórios realizada',
      'Compra de vidros realizada',
      'Recebimento conferido',
      'Produção concluída',
      'Instalação agendada',
      'Entrega realizada',
      'Pós-venda concluído'
    ];
  ELSIF p_type = 'calhas' THEN
    items := ARRAY[
      'Medidas conferidas',
      'Espessura definida',
      'Cor definida',
      'Largura confirmada',
      'Acessórios conferidos',
      'Programação de dobra realizada',
      'Materiais separados',
      'Produção concluída',
      'Instalação realizada',
      'Conferência final feita',
      'Cobrança emitida',
      'Pós-venda concluído'
    ];
  ELSE
    items := ARRAY[
      'Contrato gerado',
      'Contrato assinado',
      'Entrada recebida',
      'Medidas conferidas',
      'Aprovação técnica',
      'Compras realizadas',
      'Compras conferidas',
      'Produção concluída',
      'Conferência de produção',
      'Instalação realizada',
      'Conferência final',
      'Cobrança final emitida',
      'Pós-venda concluído'
    ];
  END IF;

  FOREACH item IN ARRAY items LOOP
    INSERT INTO public.order_checklist_items(company_id, checklist_id, order_id, title, sort_order, status)
    VALUES (c, checklist_id, p_order_id, item, i, 'pendente')
    ON CONFLICT DO NOTHING;
    i := i + 1;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.create_order_checklist(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.auto_order_checklist()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_type TEXT;
BEGIN
  IF NEW.production_status = 'em_producao' AND (OLD.production_status IS DISTINCT FROM NEW.production_status) THEN
    -- Detecta tipo pelo sale_type ou descrição
    SELECT LOWER(COALESCE(st.name,'')) INTO v_type
    FROM public.sale_types st WHERE st.id=NEW.sale_type_id;

    IF v_type LIKE '%esquadria%' THEN
      PERFORM public.create_order_checklist(NEW.id, 'esquadrias');
    ELSIF v_type LIKE '%calha%' THEN
      PERFORM public.create_order_checklist(NEW.id, 'calhas');
    ELSE
      PERFORM public.create_order_checklist(NEW.id, 'geral');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_order_checklist ON public.orders;
CREATE TRIGGER trg_auto_order_checklist
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.auto_order_checklist();


CREATE OR REPLACE FUNCTION public.set_default_document_template(p_template_id UUID,p_type TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c UUID:=public.current_company_id();
BEGIN
  IF NOT public.has_role(ARRAY['administrador','gerente']::public.app_role[]) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(c::text||':template:'||p_type,0));
  PERFORM 1 FROM public.document_templates WHERE id=p_template_id AND company_id=c AND type=p_type FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template não encontrado'; END IF;
  UPDATE public.document_templates SET is_default=false,status='rascunho' WHERE company_id=c AND type=p_type AND is_default;
  UPDATE public.document_templates SET is_default=true,status='em_uso' WHERE id=p_template_id AND company_id=c;
END; $$;
REVOKE ALL ON FUNCTION public.set_default_document_template(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_document_template(UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_installation_completion()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.status='concluida' AND OLD.status IS DISTINCT FROM NEW.status AND EXISTS(
    SELECT 1 FROM public.installation_checklists WHERE installation_id=NEW.id AND required AND NOT completed
  ) THEN RAISE EXCEPTION 'Conclua todos os itens obrigatórios da instalação'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS installation_completion_guard ON public.installations;
CREATE TRIGGER installation_completion_guard BEFORE UPDATE OF status ON public.installations FOR EACH ROW EXECUTE FUNCTION public.guard_installation_completion();

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE public.leads SET updated_at=created_at WHERE updated_at IS NULL;
ALTER TABLE public.leads ALTER COLUMN updated_at SET DEFAULT now();
DROP TRIGGER IF EXISTS leads_touch ON public.leads;
CREATE TRIGGER leads_touch BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE OR REPLACE FUNCTION public.generate_operational_alerts()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  total INT := 0;
  r RECORD;
BEGIN
  IF NOT public.has_role(ARRAY['administrador','gerente']::public.app_role[]) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  -- a) Leads sem resposta há mais de 24h
  FOR r IN
    SELECT l.id, l.company_id, l.name,
      EXTRACT(EPOCH FROM (now() - COALESCE(l.updated_at, l.created_at)))/3600 AS hrs
    FROM public.leads l
    WHERE l.company_id=public.current_company_id() AND l.status = 'aberto' AND l.deleted_at IS NULL
      AND COALESCE(l.updated_at, l.created_at) < now() - INTERVAL '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.operational_alerts oa
        WHERE oa.entity_id = l.id AND oa.type = 'lead_sem_resposta' AND oa.resolved = false
          AND oa.created_at > now() - INTERVAL '1 day'
      )
  LOOP
    INSERT INTO public.operational_alerts(company_id, type, severity, title, description, entity_type, entity_id)
    VALUES (r.company_id, 'lead_sem_resposta',
      CASE WHEN r.hrs > 168 THEN 'high' WHEN r.hrs > 72 THEN 'medium' ELSE 'low' END,
      'Lead sem interação: ' || r.name,
      ROUND(r.hrs)::text || 'h sem atividade',
      'lead', r.id);
    total := total + 1;
  END LOOP;

  -- b) Parcelas vencidas
  FOR r IN
    SELECT fe.id, fe.company_id, fe.description
    FROM public.financial_entries fe
    WHERE fe.company_id=public.current_company_id() AND fe.open_amount>0 AND fe.status NOT IN ('pago','cancelado')
      AND fe.due_date < CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM public.operational_alerts oa
        WHERE oa.entity_id = fe.id AND oa.type = 'parcela_vencida' AND oa.resolved = false
          AND oa.created_at > now() - INTERVAL '1 day'
      )
  LOOP
    INSERT INTO public.operational_alerts(company_id, type, severity, title, description, entity_type, entity_id)
    VALUES (r.company_id, 'parcela_vencida', 'high',
      'Parcela vencida: ' || r.description, 'Vencimento ultrapassado', 'financial_entry', r.id);
    total := total + 1;
  END LOOP;

  -- c) Pedidos parados (sem atualização há 7+ dias em produção)
  FOR r IN
    SELECT o.id, o.company_id, o.order_number
    FROM public.orders o
    WHERE o.company_id=public.current_company_id() AND o.production_status = 'em_producao'
      AND o.updated_at < now() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.operational_alerts oa
        WHERE oa.entity_id = o.id AND oa.type = 'producao_atrasada' AND oa.resolved = false
          AND oa.created_at > now() - INTERVAL '1 day'
      )
  LOOP
    INSERT INTO public.operational_alerts(company_id, type, severity, title, description, entity_type, entity_id)
    VALUES (r.company_id, 'producao_atrasada', 'medium',
      'Produção parada: ' || r.order_number, 'Sem atualização há 7+ dias', 'order', r.id);
    total := total + 1;
  END LOOP;

  RETURN total;
END $$;

GRANT EXECUTE ON FUNCTION public.generate_operational_alerts() TO authenticated;


COMMIT;
