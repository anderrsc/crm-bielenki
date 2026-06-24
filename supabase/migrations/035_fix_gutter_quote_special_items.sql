-- Migration 035 — Centraliza itens especiais no orçamento de calhas
-- Corrige item_type, unidade, produção e compra por categoria.
-- Remove lógica duplicada do frontend: special_items agora são inseridos
-- diretamente pelos RPCs create_gutter_quote e update_gutter_quote.

-- ─── helper: unidade padrão por item_type ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gutter_quote_item_unit(p_item_type text, p_unit text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_unit IS NOT NULL AND p_unit <> '' THEN p_unit
    WHEN p_item_type IN ('condutor','acessorio','especial') THEN 'Unidade'
    WHEN p_item_type = 'servico'                           THEN 'Serviço'
    ELSE 'Metro Linear (m)'  -- fabricacao, calha, rufo, pingadeira
  END;
$$;

REVOKE ALL ON FUNCTION public.gutter_quote_item_unit(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.gutter_quote_item_unit(text, text) TO authenticated;

-- ─── create_gutter_quote ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_gutter_quote(p_payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c     UUID := public.current_company_id();
  st    UUID;
  q     UUID;
  g     UUID;
  x     JSONB;
  sub   NUMERIC := 0;
  itype TEXT;
  iunit TEXT;
BEGIN
  IF c IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa'; END IF;

  SELECT id INTO st
    FROM public.sale_types
   WHERE (company_id = c OR company_id IS NULL) AND name ILIKE 'Calhas%'
   ORDER BY company_id NULLS LAST LIMIT 1;
  IF st IS NULL THEN RAISE EXCEPTION 'Cadastre o tipo de venda Calhas instaladas'; END IF;

  -- subtotal: itens normais
  SELECT COALESCE(SUM(
    (i->>'quantity')::numeric * (i->>'meters')::numeric * (i->>'unit_price')::numeric
  ), 0)
    INTO sub
    FROM jsonb_array_elements(p_payload->'items') i;

  -- subtotal: itens especiais
  SELECT sub + COALESCE(SUM(
    (i->>'quantity')::numeric * (i->>'unit_price')::numeric
  ), 0)
    INTO sub
    FROM jsonb_array_elements(COALESCE(p_payload->'special_items', '[]'::jsonb)) i;

  INSERT INTO public.quotes(
    company_id, quote_number, client_id, sale_type_id, seller_id,
    subtotal, discount, freight, notes, valid_until, installation_deadline
  ) VALUES (
    c,
    public.next_number('ORC', 'public.quotes', c),
    (p_payload->>'client_id')::uuid,
    st,
    auth.uid(),
    sub,
    COALESCE((p_payload->>'discount')::numeric, 0),
    COALESCE((p_payload->>'freight')::numeric, 0),
    p_payload->>'notes',
    NULLIF(p_payload->>'valid_until', '')::date,
    NULLIF(p_payload->>'installation_deadline', '')
  ) RETURNING id INTO q;

  INSERT INTO public.gutter_quotes(company_id, quote_id) VALUES (c, q) RETURNING id INTO g;

  -- itens normais de fabricação (calhas, rufos, pingadeiras)
  FOR x IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    INSERT INTO public.gutter_quote_items(
      company_id, gutter_quote_id, product, thickness, cut, color, category, quantity, meters, unit_price
    ) VALUES (
      c, g,
      x->>'product', x->>'thickness', x->>'cut', x->>'color',
      COALESCE(x->>'category', 'Calhas'),
      (x->>'quantity')::numeric, (x->>'meters')::numeric, (x->>'unit_price')::numeric
    );

    INSERT INTO public.quote_items(
      company_id, quote_id, product, description, unit, quantity, unit_price,
      item_type, requires_purchase, requires_production
    ) VALUES (
      c, q,
      x->>'product',
      COALESCE(x->>'category', 'Calhas') || ' — ' || COALESCE(x->>'thickness', '') || ' c/' || COALESCE(x->>'cut', ''),
      'Metro Linear (m)',
      (x->>'quantity')::numeric * (x->>'meters')::numeric,
      (x->>'unit_price')::numeric,
      'fabricacao',
      TRUE,   -- requires_purchase
      TRUE    -- requires_production
    );
  END LOOP;

  -- itens especiais (condutores, acessórios, serviços, especiais)
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'special_items', '[]'::jsonb)) LOOP
    itype := COALESCE(LOWER(x->>'item_type'), 'especial');
    iunit := public.gutter_quote_item_unit(itype, x->>'unit');

    INSERT INTO public.quote_items(
      company_id, quote_id, product, description, unit, quantity, unit_price,
      item_type, requires_purchase, requires_production
    ) VALUES (
      c, q,
      x->>'product',
      NULLIF(x->>'description', ''),
      iunit,
      (x->>'quantity')::numeric,
      (x->>'unit_price')::numeric,
      'especial',
      itype <> 'servico',   -- condutores/acessórios/especiais podem exigir compra; serviços não
      FALSE                  -- nenhum item especial exige produção
    );
  END LOOP;

  RETURN q;
END $$;

REVOKE ALL ON FUNCTION public.create_gutter_quote(JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.create_gutter_quote(JSONB) TO authenticated;

-- ─── update_gutter_quote ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_gutter_quote(p_quote_id UUID, p_payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c          UUID := public.current_company_id();
  q          public.quotes;
  gutter_id  UUID;
  item       JSONB;
  sub        NUMERIC := 0;
  itype      TEXT;
  iunit      TEXT;
BEGIN
  PERFORM public.require_table_access('quotes', 'update');

  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id AND company_id = c FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  IF q.status = 'aprovado' THEN RAISE EXCEPTION 'Orçamento aprovado não pode ser editado'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = (p_payload->>'client_id')::uuid AND company_id = c
  ) THEN RAISE EXCEPTION 'Cliente inválido'; END IF;

  IF jsonb_array_length(COALESCE(p_payload->'items', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item de calha, rufo ou pingadeira';
  END IF;

  -- subtotal: itens normais
  SELECT COALESCE(SUM(
    (i->>'quantity')::numeric * (i->>'meters')::numeric * (i->>'unit_price')::numeric
  ), 0)
    INTO sub
    FROM jsonb_array_elements(p_payload->'items') i;

  -- subtotal: itens especiais
  SELECT sub + COALESCE(SUM(
    (i->>'quantity')::numeric * (i->>'unit_price')::numeric
  ), 0)
    INTO sub
    FROM jsonb_array_elements(COALESCE(p_payload->'special_items', '[]'::jsonb)) i;

  IF sub <= 0 THEN RAISE EXCEPTION 'Total do orçamento deve ser positivo'; END IF;

  SELECT id INTO gutter_id FROM public.gutter_quotes WHERE quote_id = q.id;
  IF gutter_id IS NULL THEN RAISE EXCEPTION 'Orçamento não é do tipo calhas'; END IF;

  -- limpa itens anteriores
  DELETE FROM public.gutter_quote_items WHERE gutter_quote_id = gutter_id;
  DELETE FROM public.quote_items WHERE quote_id = q.id;

  UPDATE public.quotes SET
    client_id             = (p_payload->>'client_id')::uuid,
    subtotal              = sub,
    discount              = COALESCE((p_payload->>'discount')::numeric, 0),
    freight               = COALESCE((p_payload->>'freight')::numeric, 0),
    notes                 = p_payload->>'notes',
    valid_until           = NULLIF(p_payload->>'valid_until', '')::date,
    installation_deadline = NULLIF(p_payload->>'installation_deadline', ''),
    updated_at            = NOW()
  WHERE id = q.id;

  -- itens normais de fabricação
  FOR item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    IF (item->>'quantity')::numeric <= 0
    OR (item->>'meters')::numeric   <= 0
    OR (item->>'unit_price')::numeric < 0
    THEN RAISE EXCEPTION 'Item inválido'; END IF;

    INSERT INTO public.gutter_quote_items(
      company_id, gutter_quote_id, product, thickness, cut, color, category, quantity, meters, unit_price
    ) VALUES (
      c, gutter_id,
      item->>'product', item->>'thickness', item->>'cut', item->>'color',
      COALESCE(item->>'category', 'Calhas'),
      (item->>'quantity')::numeric, (item->>'meters')::numeric, (item->>'unit_price')::numeric
    );

    INSERT INTO public.quote_items(
      company_id, quote_id, product, description, unit, quantity, unit_price,
      item_type, requires_purchase, requires_production
    ) VALUES (
      c, q.id,
      item->>'product',
      COALESCE(item->>'category', 'Calhas') || ' — ' || COALESCE(item->>'thickness', '') || ' c/' || COALESCE(item->>'cut', ''),
      'Metro Linear (m)',
      (item->>'quantity')::numeric * (item->>'meters')::numeric,
      (item->>'unit_price')::numeric,
      'fabricacao',
      TRUE,
      TRUE
    );
  END LOOP;

  -- itens especiais
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'special_items', '[]'::jsonb)) LOOP
    itype := COALESCE(LOWER(item->>'item_type'), 'especial');
    iunit := public.gutter_quote_item_unit(itype, item->>'unit');

    INSERT INTO public.quote_items(
      company_id, quote_id, product, description, unit, quantity, unit_price,
      item_type, requires_purchase, requires_production
    ) VALUES (
      c, q.id,
      item->>'product',
      NULLIF(item->>'description', ''),
      iunit,
      (item->>'quantity')::numeric,
      (item->>'unit_price')::numeric,
      'especial',
      itype <> 'servico',
      FALSE
    );
  END LOOP;

  RETURN q.id;
END $$;

REVOKE ALL ON FUNCTION public.update_gutter_quote(UUID, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.update_gutter_quote(UUID, JSONB) TO authenticated;
