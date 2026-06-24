-- Migration 035 - Templates profissionais Marquinhos para medicao e orcamento

begin;

with cfg(type, name, config) as (
  values
  (
    'ficha_medicao',
    'Ficha de Medicao - Modelo Marquinhos',
    jsonb_build_object(
      'template_family', 'marquinhos_referencia',
      'layout', 'medicao_modelo_referencia_2026',
      'paper', 'A4',
      'show_logo', true,
      'logo_width', 25,
      'logo_align', 'left',
      'header_style', 'logo_esquerda_empresa_centro_contatos_direita',
      'cards', jsonb_build_array('cliente','telefone_whatsapp','bairro','cidade','endereco','disponibilidade_horario','medidor'),
      'body_style', 'area_pautada_grande',
      'primary_color', '#d71920',
      'font_size', 10
    )
  ),
  (
    'orcamento_calhas',
    'Orcamento de Calhas - Modelo Marquinhos',
    jsonb_build_object(
      'template_family', 'marquinhos_referencia',
      'layout', 'orcamento_modelo_referencia_2026',
      'paper', 'A4',
      'show_logo', true,
      'logo_width', 68,
      'logo_align', 'left',
      'header_style', 'logo_grande_info_centro_qr_direita',
      'quote_bar', 'vermelha_com_numero_data_validade_vendedor',
      'client_box', 'dados_cliente_com_marca_dagua',
      'table_rows', 20,
      'footer_style', 'observacoes_totais_pagamento_assinatura',
      'primary_color', '#d71920',
      'secondary_color', '#111111',
      'font_size', 10
    )
  )
),
template_types as (
  select type from cfg
)
update public.document_templates dt
set
  is_default = false,
  status = case when status = 'em_uso' then 'rascunho' else status end
where dt.type in (select type from template_types);

with cfg(type, name, config) as (
  values
  (
    'ficha_medicao',
    'Ficha de Medicao - Modelo Marquinhos',
    jsonb_build_object(
      'template_family', 'marquinhos_referencia',
      'layout', 'medicao_modelo_referencia_2026',
      'paper', 'A4',
      'show_logo', true,
      'logo_width', 25,
      'logo_align', 'left',
      'header_style', 'logo_esquerda_empresa_centro_contatos_direita',
      'cards', jsonb_build_array('cliente','telefone_whatsapp','bairro','cidade','endereco','disponibilidade_horario','medidor'),
      'body_style', 'area_pautada_grande',
      'primary_color', '#d71920',
      'font_size', 10
    )
  ),
  (
    'orcamento_calhas',
    'Orcamento de Calhas - Modelo Marquinhos',
    jsonb_build_object(
      'template_family', 'marquinhos_referencia',
      'layout', 'orcamento_modelo_referencia_2026',
      'paper', 'A4',
      'show_logo', true,
      'logo_width', 68,
      'logo_align', 'left',
      'header_style', 'logo_grande_info_centro_qr_direita',
      'quote_bar', 'vermelha_com_numero_data_validade_vendedor',
      'client_box', 'dados_cliente_com_marca_dagua',
      'table_rows', 20,
      'footer_style', 'observacoes_totais_pagamento_assinatura',
      'primary_color', '#d71920',
      'secondary_color', '#111111',
      'font_size', 10
    )
  )
)
insert into public.document_templates(company_id, name, type, status, is_default, config)
select c.id, cfg.name, cfg.type, 'rascunho', false, cfg.config
from public.companies c
cross join cfg
where not exists (
  select 1
  from public.document_templates dt
  where dt.company_id = c.id
    and dt.type = cfg.type
    and dt.name = cfg.name
);

with cfg(type, name, config) as (
  values
  (
    'ficha_medicao',
    'Ficha de Medicao - Modelo Marquinhos',
    jsonb_build_object(
      'template_family', 'marquinhos_referencia',
      'layout', 'medicao_modelo_referencia_2026',
      'paper', 'A4',
      'show_logo', true,
      'logo_width', 25,
      'logo_align', 'left',
      'header_style', 'logo_esquerda_empresa_centro_contatos_direita',
      'cards', jsonb_build_array('cliente','telefone_whatsapp','bairro','cidade','endereco','disponibilidade_horario','medidor'),
      'body_style', 'area_pautada_grande',
      'primary_color', '#d71920',
      'font_size', 10
    )
  ),
  (
    'orcamento_calhas',
    'Orcamento de Calhas - Modelo Marquinhos',
    jsonb_build_object(
      'template_family', 'marquinhos_referencia',
      'layout', 'orcamento_modelo_referencia_2026',
      'paper', 'A4',
      'show_logo', true,
      'logo_width', 68,
      'logo_align', 'left',
      'header_style', 'logo_grande_info_centro_qr_direita',
      'quote_bar', 'vermelha_com_numero_data_validade_vendedor',
      'client_box', 'dados_cliente_com_marca_dagua',
      'table_rows', 20,
      'footer_style', 'observacoes_totais_pagamento_assinatura',
      'primary_color', '#d71920',
      'secondary_color', '#111111',
      'font_size', 10
    )
  )
),
chosen as (
  select distinct on (dt.company_id, dt.type)
    dt.id,
    cfg.config
  from public.document_templates dt
  join cfg on cfg.type = dt.type and cfg.name = dt.name
  order by dt.company_id, dt.type, dt.created_at desc
)
update public.document_templates dt
set
  status = 'em_uso',
  is_default = true,
  config = chosen.config,
  updated_at = now()
from chosen
where dt.id = chosen.id;

commit;
