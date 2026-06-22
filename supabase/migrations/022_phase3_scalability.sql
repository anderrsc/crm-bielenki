-- Migration 022 — Fase 3: soft-delete + audit triggers pricing_* + view atualizada

-- 1. Colunas soft-delete
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.leads     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_suppliers_not_deleted ON public.suppliers(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_workflows_not_deleted ON public.workflows(company_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_not_deleted     ON public.leads(company_id)      WHERE deleted_at IS NULL;

-- 2. Atualizar view v_supplier_summary para excluir soft-deleted
CREATE OR REPLACE VIEW public.v_supplier_summary WITH (security_invoker=true) AS
SELECT s.id, s.company_id, s.name, s.tax_id,
  sc.name category,
  COALESCE(SUM(po.total),      0) total_purchased,
  COALESCE(SUM(po.paid_amount),0) total_paid,
  COALESCE(SUM(po.open_amount),0) total_open,
  COUNT(*) FILTER (
    WHERE fe.status = 'vencido'
       OR (fe.open_amount > 0 AND fe.due_date < current_date)
  ) late_count
FROM public.suppliers s
LEFT JOIN public.supplier_categories sc ON sc.id = s.category_id
LEFT JOIN public.purchase_orders po     ON po.supplier_id = s.id
LEFT JOIN public.financial_entries fe   ON fe.purchase_order_id = po.id
WHERE s.deleted_at IS NULL
GROUP BY s.id, sc.name;

-- 3. Função de audit log para pricing_*
CREATE OR REPLACE FUNCTION public.log_pricing_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO audit_logs(company_id, table_name, record_id, action, old_data, new_data)
  VALUES (
    COALESCE(NEW.company_id, OLD.company_id),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN row_to_json(OLD)::jsonb ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN row_to_json(NEW)::jsonb ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END $$;

-- 4. Triggers pricing_*
DROP TRIGGER IF EXISTS gutter_prices_audit        ON public.gutter_prices;
DROP TRIGGER IF EXISTS pricing_paints_audit       ON public.pricing_paints;
DROP TRIGGER IF EXISTS pricing_special_parts_audit ON public.pricing_special_parts;
DROP TRIGGER IF EXISTS pricing_services_audit     ON public.pricing_services;
DROP TRIGGER IF EXISTS pricing_commercial_tables_audit ON public.pricing_commercial_tables;

CREATE TRIGGER gutter_prices_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.gutter_prices
  FOR EACH ROW EXECUTE FUNCTION public.log_pricing_audit();

CREATE TRIGGER pricing_paints_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.pricing_paints
  FOR EACH ROW EXECUTE FUNCTION public.log_pricing_audit();

CREATE TRIGGER pricing_special_parts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.pricing_special_parts
  FOR EACH ROW EXECUTE FUNCTION public.log_pricing_audit();

CREATE TRIGGER pricing_services_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.pricing_services
  FOR EACH ROW EXECUTE FUNCTION public.log_pricing_audit();

CREATE TRIGGER pricing_commercial_tables_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.pricing_commercial_tables
  FOR EACH ROW EXECUTE FUNCTION public.log_pricing_audit();
