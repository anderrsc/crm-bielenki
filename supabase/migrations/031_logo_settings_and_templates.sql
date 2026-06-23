-- Migration 031 — Logo settings per-company + document templates table

-- ─── 1. Colunas de configuração de logo na tabela companies ──────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS logo_width        INTEGER DEFAULT 80,    -- px no doc real (mm*3.78)
  ADD COLUMN IF NOT EXISTS logo_max_height   INTEGER DEFAULT 60,
  ADD COLUMN IF NOT EXISTS logo_align        TEXT    DEFAULT 'left' CHECK (logo_align IN ('left','center','right')),
  ADD COLUMN IF NOT EXISTS logo_margin_top   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS logo_margin_bottom INTEGER DEFAULT 0;

-- ─── 2. Tabela de templates de documentos ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN (
    'orcamento_calhas','orcamento_esquadrias','ficha_medicao',
    'ficha_medicao_branco','pedido','ordem_producao','ordem_instalacao','contrato'
  )),
  status       TEXT NOT NULL DEFAULT 'em_uso' CHECK (status IN ('em_uso','rascunho','desativado')),
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  config       JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_company_type_default
  ON public.document_templates(company_id, type)
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_templates_company
  ON public.document_templates(company_id, type, status);

-- RLS
ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='document_templates' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON public.document_templates
      USING (company_id = public.current_company_id());
  END IF;
END $$;

GRANT ALL ON public.document_templates TO authenticated;

-- ─── 3. Seed templates padrão para empresas existentes ───────────────────
CREATE OR REPLACE FUNCTION public.seed_default_templates(p_company_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  tmpl RECORD;
  defaults TEXT[][] := ARRAY[
    ARRAY['Orçamento de Calhas — Padrão',    'orcamento_calhas'],
    ARRAY['Orçamento de Esquadrias — Padrão','orcamento_esquadrias'],
    ARRAY['Ficha de Medição — Padrão',        'ficha_medicao'],
    ARRAY['Ficha de Medição em Branco',       'ficha_medicao_branco'],
    ARRAY['Pedido de Venda — Padrão',         'pedido'],
    ARRAY['Ordem de Produção — Padrão',       'ordem_producao'],
    ARRAY['Ordem de Instalação — Padrão',     'ordem_instalacao'],
    ARRAY['Contrato — Padrão',                'contrato']
  ];
BEGIN
  FOREACH tmpl IN ARRAY defaults LOOP
    INSERT INTO public.document_templates(company_id, name, type, status, is_default, config)
    VALUES (
      p_company_id,
      tmpl[1], tmpl[2],
      'em_uso', TRUE,
      jsonb_build_object(
        'logo_width', 80, 'logo_align', 'left',
        'logo_margin_top', 0, 'logo_margin_bottom', 0,
        'show_logo', true, 'show_header', true, 'show_footer', true,
        'font_size', 10, 'primary_color', null
      )
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_default_templates(UUID) TO authenticated;

-- Seed para todas as empresas existentes
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.companies LOOP
    IF NOT EXISTS (SELECT 1 FROM public.document_templates WHERE company_id = r.id LIMIT 1) THEN
      PERFORM public.seed_default_templates(r.id);
    END IF;
  END LOOP;
END $$;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_document_templates_updated ON public.document_templates;
CREATE TRIGGER trg_document_templates_updated
  BEFORE UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
