-- Passo 4 de 10 — 043_seed_new_company_defaults.sql
-- Cole no SQL Editor do Supabase (New query, sem nada selecionado) e clique Run. Pode ser repetido.

-- Migration 043 - Empresa nova ja nasce com templates e tabela de calhas
--
-- As migrations 029 (seed_gutter_products) e 031 (seed_default_templates)
-- so populavam as empresas que ja existiam quando foram rodadas. Uma empresa
-- criada depois (bootstrap_company) ficava sem templates de documento
-- ("Nenhum modelo encontrado. Execute a migration 031") e sem tabela de
-- precos de calhas. Agora isso e feito automaticamente ao criar a empresa.
--
-- Pode ser rodada mais de uma vez.

begin;

-- A versao da 031 percorria o array 2D sem SLICE 1 e falhava com
-- "cannot assign non-composite value to a record variable".
CREATE OR REPLACE FUNCTION public.seed_default_templates(p_company_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tmpl TEXT[];
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
  FOREACH tmpl SLICE 1 IN ARRAY defaults LOOP
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


create or replace function public.seed_new_company_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.document_templates where company_id = new.id) then
    perform public.seed_default_templates(new.id);
  end if;
  if not exists (select 1 from public.gutter_prices where company_id = new.id) then
    perform public.seed_gutter_products(new.id);
  end if;
  return new;
end $$;

drop trigger if exists companies_seed_defaults on public.companies;
create trigger companies_seed_defaults after insert on public.companies
for each row execute function public.seed_new_company_defaults();

-- Empresas que ficaram sem templates (criadas depois da 031).
do $$
declare r record;
begin
  for r in select c.id from public.companies c
           where not exists (select 1 from public.document_templates t where t.company_id = c.id) loop
    perform public.seed_default_templates(r.id);
  end loop;
end $$;

commit;
