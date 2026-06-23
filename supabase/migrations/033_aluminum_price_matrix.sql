-- Migration 033 — Matriz de preços de alumínio (espessura × corte)

CREATE TABLE IF NOT EXISTS public.aluminum_price_matrix (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  thickness    TEXT NOT NULL,           -- ex: "0.5mm"
  cut_mm       INTEGER NOT NULL,        -- ex: 200
  price_per_meter NUMERIC NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, thickness, cut_mm)
);

ALTER TABLE public.aluminum_price_matrix ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_aluminum_matrix" ON public.aluminum_price_matrix
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

GRANT ALL ON public.aluminum_price_matrix TO authenticated;

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_aluminum_matrix_updated ON public.aluminum_price_matrix;
CREATE TRIGGER trg_aluminum_matrix_updated
  BEFORE UPDATE ON public.aluminum_price_matrix
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Índice
CREATE INDEX IF NOT EXISTS idx_aluminum_matrix_company
  ON public.aluminum_price_matrix(company_id, thickness, cut_mm);

-- Seed: cortes padrão para empresas existentes (sem sobrescrever se já existir)
INSERT INTO public.aluminum_price_matrix(company_id, thickness, cut_mm, price_per_meter)
SELECT c.id, esp, corte, 0
FROM public.companies c
CROSS JOIN (VALUES ('0.5mm'),('0.6mm'),('0.7mm'),('1.0mm')) AS t(esp)
CROSS JOIN (VALUES (100),(150),(200),(250),(300),(333),(350),(400),(450),(500),(600),(700),(800),(1000)) AS r(corte)
ON CONFLICT (company_id, thickness, cut_mm) DO NOTHING;
