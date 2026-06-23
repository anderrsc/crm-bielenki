-- Migration 028 — Central de Pendências + Dashboard Executivo + Renegociação

-- ─── 1. Renegociação de vencimento ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reschedule_entry(
  p_entry_id  UUID,
  p_new_due_date DATE,
  p_reason    TEXT DEFAULT ''
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.financial_entries WHERE id = p_entry_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Lançamento não encontrado';
  END IF;
  UPDATE public.financial_entries
  SET due_date = p_new_due_date, updated_at = NOW()
  WHERE id = p_entry_id;
  INSERT INTO public.audit_logs(company_id, table_name, record_id, action, new_data)
  VALUES (v_company_id, 'financial_entries', p_entry_id, 'RESCHEDULE',
          jsonb_build_object('new_due_date', p_new_due_date, 'reason', p_reason));
END;
$$;

-- ─── 2. Central de Pendências ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pending_center()
RETURNS TABLE (
  id         UUID,
  category   TEXT,
  priority   TEXT,
  title      TEXT,
  subtitle   TEXT,
  link       TEXT,
  due_date   DATE,
  days_late  INTEGER,
  amount     NUMERIC,
  client_name TEXT
) LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  v_cid UUID;
BEGIN
  SELECT company_id INTO v_cid FROM public.profiles WHERE id = auth.uid();
  IF v_cid IS NULL THEN RETURN; END IF;

  -- Orçamentos sem resposta > 2 dias
  RETURN QUERY
  SELECT q.id, 'orcamento'::TEXT,
    CASE WHEN q.created_at < NOW() - INTERVAL '7 days' THEN 'high'
         WHEN q.created_at < NOW() - INTERVAL '3 days' THEN 'medium'
         ELSE 'low' END,
    ('Orçamento ' || q.quote_number)::TEXT,
    'Aguardando resposta do cliente'::TEXT,
    ('/orcamentos/' || q.id)::TEXT,
    q.valid_until,
    CASE WHEN q.valid_until < CURRENT_DATE THEN (CURRENT_DATE - q.valid_until)::INT ELSE NULL END,
    q.total,
    c.name
  FROM public.quotes q
  JOIN public.clients c ON c.id = q.client_id
  WHERE q.company_id = v_cid AND q.status = 'pendente'
    AND q.created_at < NOW() - INTERVAL '2 days'
  ORDER BY q.created_at ASC LIMIT 20;

  -- Financeiro vencido
  RETURN QUERY
  SELECT fe.id, ('financeiro_' || fe.entry_type)::TEXT,
    CASE WHEN CURRENT_DATE - fe.due_date > 15 THEN 'high'
         WHEN CURRENT_DATE - fe.due_date > 7 THEN 'medium'
         ELSE 'low' END,
    fe.description::TEXT,
    ('Vencida há ' || (CURRENT_DATE - fe.due_date)::TEXT || ' dias')::TEXT,
    '/financeiro'::TEXT,
    fe.due_date,
    (CURRENT_DATE - fe.due_date)::INT,
    fe.open_amount,
    COALESCE(cl.name, sup.name)
  FROM public.financial_entries fe
  LEFT JOIN public.clients cl ON cl.id = fe.client_id
  LEFT JOIN public.suppliers sup ON sup.id = fe.supplier_id
  WHERE fe.company_id = v_cid
    AND fe.status IN ('aguardando_pagamento','parcialmente_pago')
    AND fe.due_date < CURRENT_DATE
  ORDER BY fe.due_date ASC LIMIT 20;

  -- Produções atrasadas (planned_end vencido OU iniciadas há > 7 dias)
  RETURN QUERY
  SELECT po.id, 'producao'::TEXT, 'high'::TEXT,
    ('Produção ' || po.production_number)::TEXT,
    CASE WHEN po.planned_end < CURRENT_DATE
         THEN ('Atrasada ' || (CURRENT_DATE - po.planned_end)::TEXT || ' dias')
         ELSE 'Em produção há mais de 7 dias' END::TEXT,
    ('/producao/' || po.id)::TEXT,
    po.planned_end,
    CASE WHEN po.planned_end IS NOT NULL THEN (CURRENT_DATE - po.planned_end)::INT ELSE NULL END,
    NULL::NUMERIC,
    c.name
  FROM public.production_orders po
  JOIN public.orders o ON o.id = po.order_id
  JOIN public.clients c ON c.id = o.client_id
  WHERE po.company_id = v_cid
    AND po.status NOT IN ('concluido','cancelado')
    AND (
      (po.planned_end IS NOT NULL AND po.planned_end < CURRENT_DATE)
      OR po.started_at < NOW() - INTERVAL '7 days'
    )
  ORDER BY po.planned_end ASC NULLS LAST LIMIT 10;

  -- Compras aguardando recebimento
  RETURN QUERY
  SELECT pu.id, 'compra'::TEXT,
    CASE WHEN pu.expected_at < CURRENT_DATE THEN 'medium' ELSE 'low' END,
    ('Compra ' || pu.order_number)::TEXT,
    'Aguardando recebimento'::TEXT,
    ('/compras/' || pu.id)::TEXT,
    pu.expected_at,
    CASE WHEN pu.expected_at IS NOT NULL THEN (CURRENT_DATE - pu.expected_at)::INT ELSE NULL END,
    pu.total_amount,
    sup.name
  FROM public.purchase_orders pu
  JOIN public.suppliers sup ON sup.id = pu.supplier_id
  WHERE pu.company_id = v_cid
    AND pu.status NOT IN ('concluido','cancelado')
    AND pu.deleted_at IS NULL
  ORDER BY pu.expected_at ASC NULLS LAST LIMIT 10;

  -- Instalações agendadas nas próximas 48h
  RETURN QUERY
  SELECT i.id, 'instalacao'::TEXT, 'medium'::TEXT,
    ('Instalação — ' || c.name)::TEXT,
    ('Agendada para ' || TO_CHAR(i.scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'))::TEXT,
    ('/instalacoes/' || i.id)::TEXT,
    i.scheduled_at::DATE,
    NULL::INT,
    NULL::NUMERIC,
    c.name
  FROM public.installations i
  JOIN public.orders o ON o.id = i.order_id
  JOIN public.clients c ON c.id = o.client_id
  WHERE i.company_id = v_cid
    AND i.status IN ('agendada','em_andamento')
    AND i.scheduled_at BETWEEN NOW() - INTERVAL '2 hours' AND NOW() + INTERVAL '48 hours'
  ORDER BY i.scheduled_at ASC LIMIT 10;

END;
$$;

-- ─── 3. Dashboard Executivo com KPIs completos ────────────────────────────────
CREATE OR REPLACE FUNCTION public.dashboard_executivo()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
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
    'orcamentos_pendentes', (SELECT COUNT(*) FROM public.quotes WHERE company_id = v_cid AND status = 'pendente'),
    -- Operação
    'em_producao',        (SELECT COUNT(*) FROM public.production_orders WHERE company_id = v_cid AND status NOT IN ('concluido','cancelado')),
    'instalacoes_hoje',   (SELECT COUNT(*) FROM public.installations WHERE company_id = v_cid AND status IN ('agendada','em_andamento') AND scheduled_at::DATE = CURRENT_DATE),
    'compras_pendentes',  (SELECT COUNT(*) FROM public.purchase_orders WHERE company_id = v_cid AND status NOT IN ('concluido','cancelado') AND deleted_at IS NULL),
    -- Financeiro
    'receitas_abertas',   (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'receber' AND status NOT IN ('pago','cancelado')),
    'despesas_abertas',   (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'pagar'  AND status NOT IN ('pago','cancelado')),
    'receitas_mes',       (SELECT COALESCE(SUM(amount),0) FROM public.payments p JOIN public.financial_entries fe ON fe.id = p.financial_entry_id WHERE fe.company_id = v_cid AND fe.entry_type = 'receber' AND p.paid_at BETWEEN v_inicio AND v_fim),
    'despesas_mes',       (SELECT COALESCE(SUM(amount),0) FROM public.payments p JOIN public.financial_entries fe ON fe.id = p.financial_entry_id WHERE fe.company_id = v_cid AND fe.entry_type = 'pagar'  AND p.paid_at BETWEEN v_inicio AND v_fim),
    'overdue_receivable', (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'receber' AND status IN ('aguardando_pagamento','parcialmente_pago') AND due_date < CURRENT_DATE),
    'overdue_payable',    (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'pagar'  AND status IN ('aguardando_pagamento','parcialmente_pago') AND due_date < CURRENT_DATE),
    'due_today',          (SELECT COUNT(*) FROM public.financial_entries WHERE company_id = v_cid AND status IN ('aguardando_pagamento','parcialmente_pago') AND due_date = CURRENT_DATE),
    -- Top vendedores do mês
    'top_vendedores', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (row_to_json(t)->>'total_vendido')::NUMERIC DESC), '[]'::JSON)
      FROM (
        SELECT
          COALESCE(s.seller_name, 'Sem vendedor')   AS nome,
          COUNT(*)::INT                              AS qtd_vendas,
          COALESCE(SUM(s.total), 0)                 AS total_vendido
        FROM public.sales s
        WHERE s.company_id = v_cid
          AND s.created_at::DATE BETWEEN v_inicio AND v_fim
        GROUP BY COALESCE(s.seller_name, 'Sem vendedor')
        ORDER BY total_vendido DESC
        LIMIT 5
      ) t
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- Índice para pending_center
CREATE INDEX IF NOT EXISTS idx_financial_entries_overdue
  ON public.financial_entries(company_id, entry_type, status, due_date)
  WHERE status IN ('aguardando_pagamento','parcialmente_pago');

CREATE INDEX IF NOT EXISTS idx_quotes_pending
  ON public.quotes(company_id, status, created_at)
  WHERE status = 'pendente';
