-- Migration 029 — Fix pending_center (id ambíguo) + createUser admin + produtos padrão

-- ─── 1. pending_center corrigido (record_id evita ambiguidade) ───────────────
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
) LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  v_cid UUID;
BEGIN
  SELECT company_id INTO v_cid FROM public.profiles WHERE id = auth.uid();
  IF v_cid IS NULL THEN RETURN; END IF;

  -- Orçamentos sem resposta > 2 dias
  RETURN QUERY
  SELECT
    q.id AS record_id,
    'orcamento'::TEXT AS category,
    CASE
      WHEN q.created_at < NOW() - INTERVAL '7 days' THEN 'high'
      WHEN q.created_at < NOW() - INTERVAL '3 days' THEN 'medium'
      ELSE 'low'
    END AS priority,
    ('Orçamento ' || q.quote_number)::TEXT AS title,
    'Aguardando resposta do cliente'::TEXT AS subtitle,
    ('/orcamentos/' || q.id)::TEXT AS link,
    q.valid_until AS due_date,
    CASE WHEN q.valid_until IS NOT NULL AND q.valid_until < CURRENT_DATE
         THEN (CURRENT_DATE - q.valid_until)::INT ELSE NULL END AS days_late,
    q.total AS amount,
    c.name AS client_name
  FROM public.quotes q
  JOIN public.clients c ON c.id = q.client_id
  WHERE q.company_id = v_cid
    AND q.status = 'pendente'
    AND q.created_at < NOW() - INTERVAL '2 days'
  ORDER BY q.created_at ASC
  LIMIT 20;

  -- Financeiro vencido (receber e pagar)
  RETURN QUERY
  SELECT
    fe.id AS record_id,
    ('financeiro_' || fe.entry_type)::TEXT AS category,
    CASE
      WHEN (CURRENT_DATE - fe.due_date) > 15 THEN 'high'
      WHEN (CURRENT_DATE - fe.due_date) > 7  THEN 'medium'
      ELSE 'low'
    END AS priority,
    fe.description::TEXT AS title,
    ('Vencida há ' || (CURRENT_DATE - fe.due_date)::TEXT || ' dias')::TEXT AS subtitle,
    ('/financeiro')::TEXT AS link,
    fe.due_date AS due_date,
    (CURRENT_DATE - fe.due_date)::INT AS days_late,
    fe.open_amount AS amount,
    COALESCE(cl.name, sup.name) AS client_name
  FROM public.financial_entries fe
  LEFT JOIN public.clients   cl  ON cl.id  = fe.client_id
  LEFT JOIN public.suppliers sup ON sup.id = fe.supplier_id
  WHERE fe.company_id = v_cid
    AND fe.status IN ('aguardando_pagamento','parcialmente_pago')
    AND fe.due_date < CURRENT_DATE
  ORDER BY fe.due_date ASC
  LIMIT 20;

  -- Produções atrasadas
  RETURN QUERY
  SELECT
    po.id AS record_id,
    'producao'::TEXT AS category,
    'high'::TEXT AS priority,
    ('Produção ' || po.production_number)::TEXT AS title,
    CASE
      WHEN po.planned_end IS NOT NULL AND po.planned_end < CURRENT_DATE
        THEN ('Atrasada ' || (CURRENT_DATE - po.planned_end)::TEXT || ' dias')
      ELSE 'Em produção há mais de 7 dias'
    END::TEXT AS subtitle,
    ('/producao/' || po.id)::TEXT AS link,
    po.planned_end AS due_date,
    CASE WHEN po.planned_end IS NOT NULL THEN (CURRENT_DATE - po.planned_end)::INT ELSE NULL END AS days_late,
    NULL::NUMERIC AS amount,
    c.name AS client_name
  FROM public.production_orders po
  JOIN public.orders  o ON o.id = po.order_id
  JOIN public.clients c ON c.id = o.client_id
  WHERE po.company_id = v_cid
    AND po.status NOT IN ('concluido','cancelado')
    AND (
      (po.planned_end IS NOT NULL AND po.planned_end < CURRENT_DATE)
      OR po.started_at < NOW() - INTERVAL '7 days'
    )
  ORDER BY po.planned_end ASC NULLS LAST
  LIMIT 10;

  -- Compras aguardando recebimento
  RETURN QUERY
  SELECT
    pu.id AS record_id,
    'compra'::TEXT AS category,
    CASE WHEN pu.expected_at IS NOT NULL AND pu.expected_at < CURRENT_DATE THEN 'medium' ELSE 'low' END AS priority,
    ('Compra ' || pu.order_number)::TEXT AS title,
    'Aguardando recebimento'::TEXT AS subtitle,
    ('/compras/' || pu.id)::TEXT AS link,
    pu.expected_at AS due_date,
    CASE WHEN pu.expected_at IS NOT NULL THEN (CURRENT_DATE - pu.expected_at)::INT ELSE NULL END AS days_late,
    pu.total_amount AS amount,
    sup.name AS client_name
  FROM public.purchase_orders pu
  JOIN public.suppliers sup ON sup.id = pu.supplier_id
  WHERE pu.company_id = v_cid
    AND pu.status NOT IN ('concluido','cancelado')
    AND pu.deleted_at IS NULL
  ORDER BY pu.expected_at ASC NULLS LAST
  LIMIT 10;

  -- Instalações nas próximas 48h
  RETURN QUERY
  SELECT
    i.id AS record_id,
    'instalacao'::TEXT AS category,
    'medium'::TEXT AS priority,
    ('Instalação — ' || c.name)::TEXT AS title,
    ('Agendada para ' || TO_CHAR(i.scheduled_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'))::TEXT AS subtitle,
    ('/instalacoes/' || i.id)::TEXT AS link,
    i.scheduled_at::DATE AS due_date,
    NULL::INT AS days_late,
    NULL::NUMERIC AS amount,
    c.name AS client_name
  FROM public.installations i
  JOIN public.orders  o ON o.id = i.order_id
  JOIN public.clients c ON c.id = o.client_id
  WHERE i.company_id = v_cid
    AND i.status IN ('agendada','em_andamento')
    AND i.scheduled_at BETWEEN NOW() - INTERVAL '2 hours' AND NOW() + INTERVAL '48 hours'
  ORDER BY i.scheduled_at ASC
  LIMIT 10;

  -- Medições pendentes (scheduled_at vencido ou ainda não agendadas)
  RETURN QUERY
  SELECT
    m.id AS record_id,
    'medicao'::TEXT AS category,
    CASE
      WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at < NOW() - INTERVAL '24 hours' THEN 'high'
      WHEN m.scheduled_at IS NULL THEN 'medium'
      ELSE 'low'
    END AS priority,
    ('Medição ' || COALESCE(m.measurement_number, '—'))::TEXT AS title,
    CASE
      WHEN m.scheduled_at IS NULL THEN 'Sem data agendada'
      ELSE ('Agendada ' || TO_CHAR(m.scheduled_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'))
    END::TEXT AS subtitle,
    ('/medicoes/' || m.id)::TEXT AS link,
    m.scheduled_at::DATE AS due_date,
    CASE WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at < NOW()
         THEN EXTRACT(DAY FROM NOW() - m.scheduled_at)::INT ELSE NULL END AS days_late,
    NULL::NUMERIC AS amount,
    c.name AS client_name
  FROM public.measurements m
  JOIN public.clients c ON c.id = m.client_id
  WHERE m.company_id = v_cid
    AND m.status IN ('agendada','pendente')
    AND (m.scheduled_at IS NULL OR m.scheduled_at < NOW() + INTERVAL '48 hours')
  ORDER BY m.scheduled_at ASC NULLS FIRST
  LIMIT 10;

END;
$$;

GRANT EXECUTE ON FUNCTION public.pending_center() TO authenticated;

-- ─── 2. Função admin_create_user para criar usuário com senha ─────────────────
-- Chamada via service_role do Next.js (não exposta ao client diretamente)
-- A criação real é feita pelo Admin SDK no server action; esta função apenas
-- garante permissões no perfil.

-- ─── 3. Seed de produtos padrão de calhas (por empresa, INSERT…ON CONFLICT) ──
-- Esta função é chamada uma vez por empresa para garantir os produtos base.
CREATE OR REPLACE FUNCTION public.seed_gutter_products(p_company_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.gutter_prices(company_id, product, thickness, cut_mm, unit_price, active)
  VALUES
    -- Calhas
    (p_company_id,'Calha Platibanda','0.43',200,0,true),
    (p_company_id,'Calha Platibanda','0.50',200,0,true),
    (p_company_id,'Calha Platibanda','0.65',200,0,true),
    (p_company_id,'Calha de Beiral','0.43',150,0,true),
    (p_company_id,'Calha de Beiral','0.50',150,0,true),
    (p_company_id,'Calha de Beiral','0.65',150,0,true),
    (p_company_id,'Calha Condutora','0.43',125,0,true),
    (p_company_id,'Calha Coletora','0.50',200,0,true),
    (p_company_id,'Calha de Meio Fio','0.43',150,0,true),
    -- Rufos
    (p_company_id,'Rufo Simples','0.43',200,0,true),
    (p_company_id,'Rufo com Pingadeira','0.43',200,0,true),
    (p_company_id,'Rufo de Acabamento','0.43',150,0,true),
    (p_company_id,'Rufo Água Furtada','0.43',200,0,true),
    (p_company_id,'Rufo de Cumeeira','0.43',250,0,true),
    (p_company_id,'Rufo Sobre Calha','0.43',200,0,true),
    -- Pingadeiras
    (p_company_id,'Pingadeira','0.43',150,0,true),
    (p_company_id,'Pingadeira com Rufo','0.43',200,0,true),
    (p_company_id,'Pingadeira de Marquise','0.50',200,0,true),
    -- Chaminé
    (p_company_id,'Chaminé Quadrada','0.50',200,0,true),
    (p_company_id,'Chaminé Redonda','0.50',200,0,true),
    -- Condutores e acessórios
    (p_company_id,'Condutor Redondo','0.43',100,0,true),
    (p_company_id,'Condutor Quadrado','0.43',100,0,true),
    (p_company_id,'Caixa Coletora','0.50',200,0,true),
    (p_company_id,'Curva 90°','0.43',100,0,true),
    (p_company_id,'Joelho 45°','0.43',100,0,true),
    (p_company_id,'Saída de Água','0.43',100,0,true),
    (p_company_id,'Emenda','0.43',200,0,true),
    (p_company_id,'Tampa Lateral','0.43',200,0,true),
    (p_company_id,'Suporte Universal','0.43',100,0,true),
    (p_company_id,'Corrente para Condutor','0.43',1,0,true),
    (p_company_id,'Tela Anti Folhas','0.43',200,0,true),
    -- Serviços e outros
    (p_company_id,'PU MS40','0.43',1,0,true),
    (p_company_id,'Pintura','0.43',1,0,true),
    (p_company_id,'Mão de Obra','0.43',1,0,true),
    (p_company_id,'Frete','0.43',1,0,true),
    (p_company_id,'Deslocamento','0.43',1,0,true),
    (p_company_id,'Manutenção','0.43',1,0,true)
  ON CONFLICT (company_id, product, thickness, cut_mm) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_gutter_products(UUID) TO authenticated;

-- Roda seed para todas as empresas que ainda não têm produtos
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT company_id FROM public.profiles WHERE company_id IS NOT NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM public.gutter_prices WHERE company_id = r.company_id LIMIT 1) THEN
      PERFORM public.seed_gutter_products(r.company_id);
    END IF;
  END LOOP;
END;
$$;

-- ─── 4. Índices para pending_center performance ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_measurements_pending
  ON public.measurements(company_id, status, scheduled_at)
  WHERE status IN ('agendada','pendente');
