-- Migration 044 - Mesma calha em cores diferentes na tabela de precos
--
-- A chave unica de gutter_prices era (empresa, produto, espessura, corte),
-- sem a cor. Mas o orcamento busca o preco por produto + espessura + corte
-- + cor, e a tela oferece 8 cores: cadastrar "Calha de Beiral 0.5mm 200mm"
-- em Pintura Branco depois da versao Aluminio Natural dava
-- "duplicate key value violates unique constraint". A cor agora faz parte
-- da chave (cor vazia conta como Aluminio Natural).
--
-- Pode ser rodada mais de uma vez.

begin;

alter table public.gutter_prices drop constraint if exists gutter_prices_company_id_product_thickness_cut_mm_key;

create unique index if not exists gutter_prices_unique_item_color on public.gutter_prices
  (company_id, product, coalesce(thickness, ''), coalesce(cut_mm, 0), coalesce(color, 'Aluminio Natural'));

-- seed_gutter_products (029) usava ON CONFLICT nas colunas da chave antiga.
CREATE OR REPLACE FUNCTION public.seed_gutter_products(p_company_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  ON CONFLICT DO NOTHING;
END;
$$;


commit;
