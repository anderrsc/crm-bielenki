-- Migration 030 — Expande tipos da agenda + corrige pending_center definitivamente

-- ─── 1. Expandir tipos permitidos em operational_events ──────────────────
ALTER TABLE public.operational_events
  DROP CONSTRAINT IF EXISTS operational_events_event_type_check;

ALTER TABLE public.operational_events
  ADD CONSTRAINT operational_events_event_type_check
  CHECK (event_type IN (
    'medicao','instalacao','orcamento','pos_venda','manutencao','compra',
    'producao','reuniao','venda','tarefa','lembrete','outro'
  ));

-- Adicionar colunas extras se não existirem
ALTER TABLE public.operational_events
  ADD COLUMN IF NOT EXISTS client_name  TEXT,
  ADD COLUMN IF NOT EXISTS responsible_name TEXT;

-- ─── 2. Atualizar view v_operational_agenda para incluir campos extras ────
DROP VIEW IF EXISTS public.v_operational_agenda;

CREATE VIEW public.v_operational_agenda WITH (security_invoker = true) AS
  SELECT
    e.id, e.company_id, e.event_type,
    e.title, e.starts_at, e.ends_at, e.status, e.notes,
    COALESCE(c.name, e.client_name)          AS client_name,
    COALESCE(p.full_name, e.responsible_name) AS responsible_name
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
    p.full_name AS responsible_name
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
    p.full_name AS responsible_name
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
    p.full_name AS responsible_name
  FROM public.tasks t
  LEFT JOIN public.profiles p ON p.id = t.assigned_to AND p.company_id = t.company_id
  WHERE t.due_at IS NOT NULL;

GRANT SELECT ON public.v_operational_agenda TO authenticated;

-- ─── 3. DROP + CREATE pending_center (elimina erro de ambiguidade) ────────
DROP FUNCTION IF EXISTS public.pending_center();

CREATE FUNCTION public.pending_center()
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
) LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE v_cid UUID;
BEGIN
  SELECT company_id INTO v_cid FROM public.profiles WHERE id = auth.uid();
  IF v_cid IS NULL THEN RETURN; END IF;

  -- Orçamentos pendentes > 2 dias
  RETURN QUERY
  SELECT q.id AS record_id, 'orcamento'::TEXT,
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
  FROM public.quotes q JOIN public.clients c ON c.id = q.client_id
  WHERE q.company_id = v_cid AND q.status = 'pendente'
    AND q.created_at < NOW() - INTERVAL '2 days'
  ORDER BY q.created_at ASC LIMIT 20;

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
  LEFT JOIN public.clients   cl  ON cl.id  = fe.client_id
  LEFT JOIN public.suppliers sup ON sup.id = fe.supplier_id
  WHERE fe.company_id = v_cid
    AND fe.status IN ('aguardando_pagamento','parcialmente_pago')
    AND fe.due_date < CURRENT_DATE
  ORDER BY fe.due_date ASC LIMIT 20;

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
  JOIN public.orders  o ON o.id = po.order_id
  JOIN public.clients c ON c.id = o.client_id
  WHERE po.company_id = v_cid AND po.status NOT IN ('concluido','cancelado')
    AND ((po.planned_end IS NOT NULL AND po.planned_end < CURRENT_DATE)
         OR po.started_at < NOW() - INTERVAL '7 days')
  ORDER BY po.planned_end ASC NULLS LAST LIMIT 10;

  -- Compras aguardando
  RETURN QUERY
  SELECT pu.id AS record_id, 'compra'::TEXT,
    CASE WHEN pu.expected_at IS NOT NULL AND pu.expected_at < CURRENT_DATE THEN 'medium' ELSE 'low' END,
    ('Compra ' || pu.order_number)::TEXT,
    'Aguardando recebimento'::TEXT,
    ('/compras/' || pu.id)::TEXT,
    pu.expected_at,
    CASE WHEN pu.expected_at IS NOT NULL THEN (CURRENT_DATE - pu.expected_at)::INT ELSE NULL END,
    pu.total_amount, sup.name
  FROM public.purchase_orders pu JOIN public.suppliers sup ON sup.id = pu.supplier_id
  WHERE pu.company_id = v_cid AND pu.status NOT IN ('concluido','cancelado')
    AND pu.deleted_at IS NULL
  ORDER BY pu.expected_at ASC NULLS LAST LIMIT 10;

  -- Instalações próximas 48h
  RETURN QUERY
  SELECT i.id AS record_id, 'instalacao'::TEXT, 'medium'::TEXT,
    ('Instalação — ' || c.name)::TEXT,
    ('Agendada para ' || TO_CHAR(i.scheduled_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'))::TEXT,
    ('/instalacoes/' || i.id)::TEXT,
    i.scheduled_at::DATE, NULL::INT, NULL::NUMERIC, c.name
  FROM public.installations i
  JOIN public.orders  o ON o.id = i.order_id
  JOIN public.clients c ON c.id = o.client_id
  WHERE i.company_id = v_cid AND i.status IN ('agendada','em_andamento')
    AND i.scheduled_at BETWEEN NOW() - INTERVAL '2 hours' AND NOW() + INTERVAL '48 hours'
  ORDER BY i.scheduled_at ASC LIMIT 10;

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
    m.scheduled_at::DATE,
    CASE WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at < NOW()
         THEN EXTRACT(DAY FROM NOW() - m.scheduled_at)::INT ELSE NULL END,
    NULL::NUMERIC, c.name
  FROM public.measurements m JOIN public.clients c ON c.id = m.client_id
  WHERE m.company_id = v_cid AND m.status IN ('agendada','pendente')
    AND (m.scheduled_at IS NULL OR m.scheduled_at < NOW() + INTERVAL '48 hours')
  ORDER BY m.scheduled_at ASC NULLS FIRST LIMIT 10;

END;
$$;

GRANT EXECUTE ON FUNCTION public.pending_center() TO authenticated;

-- ─── 4. Índices de performance ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_operational_events_company_starts
  ON public.operational_events(company_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_measurements_company_scheduled
  ON public.measurements(company_id, scheduled_at, status);
