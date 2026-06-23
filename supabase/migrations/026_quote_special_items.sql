-- Migration 026 — Itens especiais em orçamentos de calhas

-- Adiciona item_type em quote_items para distinguir calha / esquadria / especial / servico
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'esquadria';

-- Índice para filtrar por tipo
CREATE INDEX IF NOT EXISTS idx_quote_items_type ON public.quote_items(quote_id, item_type);

-- Permite item_type vazio (legado) funcionar como esquadria
UPDATE public.quote_items SET item_type = 'esquadria' WHERE item_type IS NULL;
