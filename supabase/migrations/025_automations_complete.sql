-- Migration 023 — Automações completas: checklists por tipo, follow-up, alertas

-- ─── 1. Tabela de execuções de workflow ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_executions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workflow_id  UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  trigger_data JSONB DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','skipped')),
  result       JSONB DEFAULT '{}',
  error_msg    TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  created_by   UUID REFERENCES public.profiles(id)
);
ALTER TABLE public.workflow_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_executions_company ON public.workflow_executions;
CREATE POLICY workflow_executions_company ON public.workflow_executions
  USING (company_id = public.current_company_id());

-- ─── 2. Tabela de alertas operacionais ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operational_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  type         TEXT NOT NULL, -- 'lead_sem_resposta','parcela_vencida','pedido_parado','producao_atrasada','instalacao_atrasada','posVenda_pendente'
  severity     TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  title        TEXT NOT NULL,
  description  TEXT,
  entity_type  TEXT, -- 'lead','order','financial_entry','installation'
  entity_id    UUID,
  resolved     BOOLEAN NOT NULL DEFAULT false,
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.operational_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_alerts_company ON public.operational_alerts;
CREATE POLICY operational_alerts_company ON public.operational_alerts
  USING (company_id = public.current_company_id());

CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON public.operational_alerts(company_id, created_at DESC) WHERE resolved = false;

-- ─── 3. Follow-up automático em leads ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_followups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id      UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  stage        TEXT NOT NULL CHECK (stage IN ('24h','72h','7d','15d','30d')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at      TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviado','cancelado')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_followups_company ON public.lead_followups;
CREATE POLICY lead_followups_company ON public.lead_followups
  USING (company_id = public.current_company_id());

-- ─── 4. Função: criar checklists completos por tipo de pedido ──────────────────
CREATE OR REPLACE FUNCTION public.create_order_checklist(p_order_id UUID, p_type TEXT DEFAULT 'calhas')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c UUID;
  items TEXT[];
  item TEXT;
  i INT := 1;
BEGIN
  SELECT company_id INTO c FROM public.orders WHERE id = p_order_id;
  IF c IS NULL THEN RETURN; END IF;

  -- Deleta checklists genéricos anteriores e recria por tipo
  DELETE FROM public.order_checklist_items WHERE order_id = p_order_id AND category = 'operacional';

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
    INSERT INTO public.order_checklist_items(company_id, order_id, item_name, sort_order, status, category)
    VALUES (c, p_order_id, item, i, 'pendente', 'operacional')
    ON CONFLICT DO NOTHING;
    i := i + 1;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.create_order_checklist(UUID, TEXT) TO authenticated;

-- ─── 5. Trigger: ao criar/aprovar ordem, gerar checklist automático ────────────
CREATE OR REPLACE FUNCTION public.auto_order_checklist()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_type TEXT;
BEGIN
  IF NEW.status = 'em_producao' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    -- Detecta tipo pelo sale_type ou descrição
    SELECT LOWER(COALESCE(st.name,'')) INTO v_type
    FROM public.sale_types st
    JOIN public.sales s ON s.sale_type_id = st.id
    WHERE s.order_id = NEW.id LIMIT 1;

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

-- ─── 6. Função: gerar alertas automáticos ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_operational_alerts()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  total INT := 0;
  r RECORD;
BEGIN
  -- a) Leads sem resposta há mais de 24h
  FOR r IN
    SELECT l.id, l.company_id, l.name,
      EXTRACT(EPOCH FROM (now() - COALESCE(l.updated_at, l.created_at)))/3600 AS hrs
    FROM public.leads l
    WHERE l.status = 'aberto' AND l.deleted_at IS NULL
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
    WHERE fe.status NOT IN ('pago','cancelado')
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
    WHERE o.production_status = 'em_producao'
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

-- ─── 7. View de alertas ativos ────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_operational_alerts WITH (security_invoker=true) AS
SELECT oa.*,
  CASE oa.type
    WHEN 'lead_sem_resposta'   THEN '⚠️'
    WHEN 'parcela_vencida'     THEN '💰'
    WHEN 'producao_atrasada'   THEN '🏭'
    WHEN 'instalacao_atrasada' THEN '🔧'
    ELSE '📋'
  END as icon
FROM public.operational_alerts oa
WHERE oa.resolved = false
ORDER BY
  CASE oa.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  oa.created_at DESC;

-- ─── 8. Função: criar follow-ups para novo lead ───────────────────────────────
CREATE OR REPLACE FUNCTION public.schedule_lead_followups()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'aberto' THEN
    INSERT INTO public.lead_followups(company_id, lead_id, stage, scheduled_at) VALUES
      (NEW.company_id, NEW.id, '24h', NOW() + INTERVAL '24 hours'),
      (NEW.company_id, NEW.id, '72h', NOW() + INTERVAL '72 hours'),
      (NEW.company_id, NEW.id, '7d',  NOW() + INTERVAL '7 days'),
      (NEW.company_id, NEW.id, '15d', NOW() + INTERVAL '15 days'),
      (NEW.company_id, NEW.id, '30d', NOW() + INTERVAL '30 days');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lead_followups ON public.leads;
CREATE TRIGGER trg_lead_followups
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.schedule_lead_followups();

-- ─── 9. Cancelar follow-ups quando lead é ganho/perdido ─────────────────────
CREATE OR REPLACE FUNCTION public.cancel_lead_followups()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('ganho','perdido') AND OLD.status = 'aberto' THEN
    UPDATE public.lead_followups
    SET status = 'cancelado'
    WHERE lead_id = NEW.id AND status = 'pendente';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cancel_followups ON public.leads;
CREATE TRIGGER trg_cancel_followups
  AFTER UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.cancel_lead_followups();

-- ─── 10. Dashboard summary melhorado ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dashboard_summary()
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH cid AS (SELECT public.current_company_id() AS id)
  SELECT jsonb_build_object(
    'leads_novos',         (SELECT COUNT(*) FROM public.leads l, cid WHERE l.company_id=cid.id AND l.status='aberto' AND l.deleted_at IS NULL AND l.created_at > now()-INTERVAL '7 days'),
    'leads_total',         (SELECT COUNT(*) FROM public.leads l, cid WHERE l.company_id=cid.id AND l.status='aberto' AND l.deleted_at IS NULL),
    'orcamentos_pendentes',(SELECT COUNT(*) FROM public.quotes q, cid WHERE q.company_id=cid.id AND q.status='pendente'),
    'orcamentos_aprovados',(SELECT COUNT(*) FROM public.quotes q, cid WHERE q.company_id=cid.id AND q.status='aprovado'),
    'vendas_mes',          (SELECT COALESCE(SUM(s.total),0) FROM public.sales s, cid WHERE s.company_id=cid.id AND s.created_at > date_trunc('month',now())),
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
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_summary() TO authenticated;

-- ─── 11. Coluna category em order_checklist_items (se não existir) ───────────
ALTER TABLE public.order_checklist_items ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'geral';
ALTER TABLE public.order_checklist_items ADD COLUMN IF NOT EXISTS item_name TEXT;

-- item_name é nova coluna, sem dados anteriores para migrar
