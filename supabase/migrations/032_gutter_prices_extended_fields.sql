-- Migration 032 — Campos estendidos em gutter_prices + bulk save action

-- ─── 1. Novos campos em gutter_prices ────────────────────────────────────
ALTER TABLE public.gutter_prices
  ADD COLUMN IF NOT EXISTS category       TEXT    DEFAULT 'Calhas Padrão',
  ADD COLUMN IF NOT EXISTS unit           TEXT    DEFAULT 'metro',
  ADD COLUMN IF NOT EXISTS labor_price    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paint_price    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS install_price  NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_price  NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_price      NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margin_pct     NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_discount_pct NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NOW();

-- ─── 2. Categorizar os produtos existentes automaticamente ────────────────
UPDATE public.gutter_prices SET category = CASE
  WHEN product ILIKE '%platibanda%' OR product ILIKE '%beiral%' OR product ILIKE '%condutora%' OR product ILIKE '%coletora%' OR product ILIKE '%meio fio%'
    THEN 'Calhas Padrão'
  WHEN product ILIKE '%rufo%' OR product ILIKE '%pingadeira%'
    THEN 'Rufos e Pingadeiras'
  WHEN product ILIKE '%condutor%' OR product ILIKE '%caixa%' OR product ILIKE '%curva%' OR product ILIKE '%joelho%' OR product ILIKE '%saída%' OR product ILIKE '%emenda%' OR product ILIKE '%tampa%' OR product ILIKE '%suporte%' OR product ILIKE '%corrente%' OR product ILIKE '%tela%'
    THEN 'Condutores e Acessórios'
  WHEN product ILIKE '%chaminé%' OR product ILIKE 'pu ms%' OR product ILIKE '%calafeto%' OR product ILIKE '%silicone%'
    THEN 'Itens Especiais'
  WHEN product ILIKE '%mão de obra%' OR product ILIKE '%mao de obra%'
    THEN 'Mão de Obra'
  WHEN product ILIKE '%pintura%'
    THEN 'Pintura'
  WHEN product ILIKE '%frete%' OR product ILIKE '%deslocamento%'
    THEN 'Frete e Deslocamento'
  WHEN product ILIKE '%manutenção%' OR product ILIKE '%manutencao%'
    THEN 'Manutenção'
  ELSE 'Calhas Padrão'
END
WHERE category IS NULL OR category = 'Calhas Padrão';

-- ─── 3. Trigger updated_at em gutter_prices ───────────────────────────────
DROP TRIGGER IF EXISTS trg_gutter_prices_updated ON public.gutter_prices;
CREATE TRIGGER trg_gutter_prices_updated
  BEFORE UPDATE ON public.gutter_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 4. Função bulk_save_prices: salva N linhas de uma vez ────────────────
CREATE OR REPLACE FUNCTION public.bulk_save_prices(p_rows JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  row_data JSONB;
  v_cid    UUID;
BEGIN
  SELECT company_id INTO v_cid FROM public.profiles WHERE id = auth.uid();
  IF v_cid IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;

  FOR row_data IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF (row_data->>'id') IS NOT NULL AND (row_data->>'id') != '' THEN
      UPDATE public.gutter_prices SET
        product          = COALESCE(row_data->>'product',       product),
        category         = COALESCE(row_data->>'category',      category),
        thickness        = COALESCE(row_data->>'thickness',     thickness),
        cut_mm           = COALESCE((row_data->>'cut_mm')::INT, cut_mm),
        unit             = COALESCE(row_data->>'unit',          unit),
        color            = row_data->>'color',
        unit_price       = COALESCE((row_data->>'unit_price')::NUMERIC,      unit_price),
        labor_price      = COALESCE((row_data->>'labor_price')::NUMERIC,     labor_price),
        paint_price      = COALESCE((row_data->>'paint_price')::NUMERIC,     paint_price),
        install_price    = COALESCE((row_data->>'install_price')::NUMERIC,   install_price),
        freight_price    = COALESCE((row_data->>'freight_price')::NUMERIC,   freight_price),
        min_price        = COALESCE((row_data->>'min_price')::NUMERIC,       min_price),
        margin_pct       = COALESCE((row_data->>'margin_pct')::NUMERIC,      margin_pct),
        max_discount_pct = COALESCE((row_data->>'max_discount_pct')::NUMERIC,max_discount_pct),
        notes            = row_data->>'notes',
        active           = COALESCE((row_data->>'active')::BOOLEAN, active),
        updated_at       = NOW()
      WHERE id = (row_data->>'id')::UUID AND company_id = v_cid;
    ELSE
      INSERT INTO public.gutter_prices(
        company_id, product, category, thickness, cut_mm, unit, color,
        unit_price, labor_price, paint_price, install_price, freight_price,
        min_price, margin_pct, max_discount_pct, notes, active
      ) VALUES (
        v_cid,
        row_data->>'product', COALESCE(row_data->>'category','Calhas Padrão'),
        COALESCE(row_data->>'thickness','0.50'), COALESCE((row_data->>'cut_mm')::INT,200),
        COALESCE(row_data->>'unit','metro'), row_data->>'color',
        COALESCE((row_data->>'unit_price')::NUMERIC,0),
        COALESCE((row_data->>'labor_price')::NUMERIC,0),
        COALESCE((row_data->>'paint_price')::NUMERIC,0),
        COALESCE((row_data->>'install_price')::NUMERIC,0),
        COALESCE((row_data->>'freight_price')::NUMERIC,0),
        COALESCE((row_data->>'min_price')::NUMERIC,0),
        COALESCE((row_data->>'margin_pct')::NUMERIC,0),
        COALESCE((row_data->>'max_discount_pct')::NUMERIC,0),
        row_data->>'notes', COALESCE((row_data->>'active')::BOOLEAN,TRUE)
      );
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_save_prices(JSONB) TO authenticated;

-- ─── 5. Índice por categoria para filtros rápidos ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_gutter_prices_category
  ON public.gutter_prices(company_id, category, active);
