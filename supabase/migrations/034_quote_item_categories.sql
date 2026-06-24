-- Migration 034 — Categorias nos itens de orçamento de calhas

-- 1. Adicionar coluna category em gutter_quote_items
ALTER TABLE public.gutter_quote_items
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Calhas';

-- 2. Adicionar item_type em special_items que já eram "especial" → mantém compatibilidade

-- 3. Recriar create_gutter_quote para salvar category
CREATE OR REPLACE FUNCTION public.create_gutter_quote(p_payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  c UUID := public.current_company_id();
  st UUID; q UUID; g UUID; x JSONB; sub NUMERIC := 0;
BEGIN
  IF c IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa'; END IF;
  SELECT id INTO st FROM public.sale_types
    WHERE (company_id=c OR company_id IS NULL) AND name ILIKE 'Calhas%'
    ORDER BY company_id NULLS LAST LIMIT 1;
  IF st IS NULL THEN RAISE EXCEPTION 'Cadastre o tipo de venda Calhas instaladas'; END IF;

  SELECT COALESCE(SUM((i->>'quantity')::numeric*(i->>'meters')::numeric*(i->>'unit_price')::numeric),0)
    INTO sub FROM jsonb_array_elements(p_payload->'items') i;

  INSERT INTO public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,notes,valid_until)
    VALUES(c,public.next_number('ORC','public.quotes',c),(p_payload->>'client_id')::uuid,st,auth.uid(),
           sub,(p_payload->>'discount')::numeric,(p_payload->>'freight')::numeric,p_payload->>'notes',current_date+15)
    RETURNING id INTO q;

  INSERT INTO public.gutter_quotes(company_id,quote_id) VALUES(c,q) RETURNING id INTO g;

  FOR x IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    INSERT INTO public.gutter_quote_items(company_id,gutter_quote_id,product,thickness,cut,color,category,quantity,meters,unit_price)
    VALUES(c,g,x->>'product',x->>'thickness',x->>'cut',x->>'color',
           COALESCE(x->>'category','Calhas'),
           (x->>'quantity')::numeric,(x->>'meters')::numeric,(x->>'unit_price')::numeric);
    INSERT INTO public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production)
    VALUES(c,q,x->>'product',COALESCE(x->>'category','Calhas')||' — '||COALESCE(x->>'thickness','')||' c/'||COALESCE(x->>'cut',''),'m',
           (x->>'quantity')::numeric*(x->>'meters')::numeric,(x->>'unit_price')::numeric,TRUE,TRUE);
  END LOOP;
  RETURN q;
END $$;

REVOKE ALL ON FUNCTION public.create_gutter_quote(JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.create_gutter_quote(JSONB) TO authenticated;

-- 4. Recriar update_gutter_quote para salvar category
CREATE OR REPLACE FUNCTION public.update_gutter_quote(p_quote_id UUID, p_payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  c UUID := public.current_company_id();
  q public.quotes; gutter_id UUID; item JSONB; subtotal_value NUMERIC := 0;
BEGIN
  PERFORM public.require_table_access('quotes','update');
  SELECT * INTO q FROM public.quotes WHERE id=p_quote_id AND company_id=c FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  IF q.status='aprovado' THEN RAISE EXCEPTION 'Orçamento aprovado não pode ser editado'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=(p_payload->>'client_id')::uuid AND company_id=c)
    THEN RAISE EXCEPTION 'Cliente inválido'; END IF;
  IF jsonb_array_length(COALESCE(p_payload->'items','[]'::jsonb))=0
    THEN RAISE EXCEPTION 'Informe ao menos um item de calha, rufo ou pingadeira'; END IF;

  SELECT COALESCE(SUM((i->>'quantity')::numeric*(i->>'meters')::numeric*(i->>'unit_price')::numeric),0)
    INTO subtotal_value FROM jsonb_array_elements(p_payload->'items') i;
  IF subtotal_value <= 0 THEN RAISE EXCEPTION 'Total do orçamento deve ser positivo'; END IF;

  SELECT id INTO gutter_id FROM public.gutter_quotes WHERE quote_id=q.id;
  IF gutter_id IS NULL THEN RAISE EXCEPTION 'Orçamento não é do tipo calhas'; END IF;

  DELETE FROM public.gutter_quote_items WHERE gutter_quote_id=gutter_id;
  DELETE FROM public.quote_items WHERE quote_id=q.id;

  UPDATE public.quotes SET
    client_id=(p_payload->>'client_id')::uuid,
    subtotal=subtotal_value,
    discount=COALESCE((p_payload->>'discount')::numeric,0),
    freight=COALESCE((p_payload->>'freight')::numeric,0),
    notes=p_payload->>'notes',
    valid_until=NULLIF(p_payload->>'valid_until','')::date,
    installation_deadline=NULLIF(p_payload->>'installation_deadline',''),
    updated_at=NOW()
  WHERE id=q.id;

  FOR item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    IF (item->>'quantity')::numeric<=0 OR (item->>'meters')::numeric<=0 OR (item->>'unit_price')::numeric<0
      THEN RAISE EXCEPTION 'Item inválido'; END IF;
    INSERT INTO public.gutter_quote_items(company_id,gutter_quote_id,product,thickness,cut,color,category,quantity,meters,unit_price)
    VALUES(c,gutter_id,item->>'product',item->>'thickness',item->>'cut',item->>'color',
           COALESCE(item->>'category','Calhas'),
           (item->>'quantity')::numeric,(item->>'meters')::numeric,(item->>'unit_price')::numeric);
    INSERT INTO public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production)
    VALUES(c,q.id,item->>'product',COALESCE(item->>'category','Calhas')||' — '||COALESCE(item->>'thickness','')||' c/'||COALESCE(item->>'cut',''),'m',
           (item->>'quantity')::numeric*(item->>'meters')::numeric,(item->>'unit_price')::numeric,TRUE,TRUE);
  END LOOP;
  RETURN q.id;
END $$;

REVOKE ALL ON FUNCTION public.update_gutter_quote(UUID,JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.update_gutter_quote(UUID,JSONB) TO authenticated;
