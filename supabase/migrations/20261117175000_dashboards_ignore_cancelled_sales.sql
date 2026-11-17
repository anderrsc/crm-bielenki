begin;
-- Painel: venda cancelada nao conta em vendas do mes, ticket e ranking.
CREATE OR REPLACE FUNCTION public.dashboard_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH cid AS (SELECT public.current_company_id() AS id)
  SELECT jsonb_build_object(
    'leads_novos',         (SELECT COUNT(*) FROM public.leads l, cid WHERE l.company_id=cid.id AND l.status='aberto' AND l.deleted_at IS NULL AND l.created_at > now()-INTERVAL '7 days'),
    'leads_total',         (SELECT COUNT(*) FROM public.leads l, cid WHERE l.company_id=cid.id AND l.status='aberto' AND l.deleted_at IS NULL),
    'orcamentos_pendentes',(SELECT COUNT(*) FROM public.quotes q, cid WHERE q.company_id=cid.id AND q.status='pendente'),
    'orcamentos_aprovados',(SELECT COUNT(*) FROM public.quotes q, cid WHERE q.company_id=cid.id AND q.status='aprovado'),
    'vendas_mes',          (SELECT COALESCE(SUM(s.total),0) FROM public.sales s, cid WHERE s.company_id=cid.id AND s.operational_status<>'cancelado' AND s.created_at > date_trunc('month',now())),
    'em_producao',         (SELECT COUNT(*) FROM public.orders o, cid WHERE o.company_id=cid.id AND o.production_status IN ('liberado','em_producao')),
    'instalacoes_pendentes',(SELECT COUNT(*) FROM public.installations i, cid WHERE i.company_id=cid.id AND i.status IN ('agendada','em_andamento')),
    'receitas_abertas',    (SELECT COALESCE(SUM(fe.open_amount),0) FROM public.financial_entries fe, cid WHERE fe.company_id=cid.id AND fe.entry_type='receber' AND fe.status NOT IN ('pago','cancelado')),
    'despesas_abertas',    (SELECT COALESCE(SUM(fe.open_amount),0) FROM public.financial_entries fe, cid WHERE fe.company_id=cid.id AND fe.entry_type='pagar' AND fe.status NOT IN ('pago','cancelado')),
    'overdue_receivable',  (SELECT COALESCE(SUM(fe.open_amount),0) FROM public.financial_entries fe, cid WHERE fe.company_id=cid.id AND fe.entry_type='receber' AND fe.status NOT IN ('pago','cancelado') AND fe.due_date < CURRENT_DATE),
    'overdue_payable',     (SELECT COALESCE(SUM(fe.open_amount),0) FROM public.financial_entries fe, cid WHERE fe.company_id=cid.id AND fe.entry_type='pagar' AND fe.status NOT IN ('pago','cancelado') AND fe.due_date < CURRENT_DATE),
    'due_today',           (SELECT COUNT(*) FROM public.financial_entries fe, cid WHERE fe.company_id=cid.id AND fe.status NOT IN ('pago','cancelado') AND fe.due_date = CURRENT_DATE),
    'alertas_ativos',      (SELECT COUNT(*) FROM public.operational_alerts oa, cid WHERE oa.company_id=cid.id AND oa.resolved=false),
    'followups_hoje',      (SELECT COUNT(*) FROM public.lead_followups lf JOIN public.leads l ON l.id=lf.lead_id, cid WHERE l.company_id=cid.id AND lf.status='pendente' AND lf.scheduled_at::date = CURRENT_DATE)
  );
$function$;
CREATE OR REPLACE FUNCTION public.dashboard_executivo()
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    'vendas_mes',     (SELECT COALESCE(SUM(total),0) FROM public.sales WHERE company_id = v_cid AND operational_status<>'cancelado' AND created_at::DATE BETWEEN v_inicio AND v_fim),
    'vendas_mes_ant', (SELECT COALESCE(SUM(total),0) FROM public.sales WHERE company_id = v_cid AND operational_status<>'cancelado' AND created_at::DATE BETWEEN v_ant_ini AND v_ant_fim),
    'qtd_vendas_mes', (SELECT COUNT(*)               FROM public.sales WHERE company_id = v_cid AND operational_status<>'cancelado' AND created_at::DATE BETWEEN v_inicio AND v_fim),
    -- Ticket médio
    'ticket_medio',   (SELECT COALESCE(AVG(total),0) FROM public.sales WHERE company_id = v_cid AND operational_status<>'cancelado' AND created_at::DATE BETWEEN v_inicio AND v_fim),
    -- Taxa de conversão
    'taxa_conversao', (
      SELECT CASE WHEN leads_tot > 0 THEN ROUND((vendas_tot::NUMERIC / leads_tot * 100)::NUMERIC, 1) ELSE 0 END
      FROM (
        SELECT
          (SELECT COUNT(*) FROM public.leads WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim) AS leads_tot,
          (SELECT COUNT(*) FROM public.sales WHERE company_id = v_cid AND operational_status<>'cancelado' AND created_at::DATE BETWEEN v_inicio AND v_fim) AS vendas_tot
      ) sub
    ),
    -- Orçamentos
    'orcamentos_mes',       (SELECT COUNT(*) FROM public.quotes WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim),
    'orcamentos_pendentes', (SELECT COUNT(*) FROM public.quotes WHERE company_id = v_cid AND status NOT IN ('aprovado','recusado','cancelado','perdido')),
    -- Operação
    'em_producao',        (SELECT COUNT(*) FROM public.production_orders WHERE company_id = v_cid AND status NOT IN ('concluido','finalizado','cancelado','recebido_completo','conferido','liberado_para_producao')),
    'instalacoes_hoje',   (SELECT COUNT(*) FROM public.installations WHERE company_id = v_cid AND status IN ('agendada','em_andamento') AND (scheduled_at AT TIME ZONE 'America/Sao_Paulo')::DATE = (now() AT TIME ZONE 'America/Sao_Paulo')::DATE),
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
        WHERE s.company_id = v_cid AND s.operational_status<>'cancelado'
          AND s.created_at::DATE BETWEEN v_inicio AND v_fim
        GROUP BY COALESCE(p.full_name, 'Sem vendedor')
        ORDER BY total_vendido DESC
        LIMIT 5
      ) t
    )
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
commit;
