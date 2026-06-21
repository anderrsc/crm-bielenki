-- 011_quote_document_branding.sql
-- Campos adicionais de identidade visual e configuração comercial usados
-- pelo novo modelo oficial de orçamento (PDF premium - calhas e demais vendas).

-- ===== Identidade visual e documentos comerciais (companies) =====
alter table public.companies
add column if not exists secondary_color text not null default '#111111',
add column if not exists qr_code_url text,
add column if not exists qr_code_label text not null default 'Acesse nosso portfólio completo',
add column if not exists default_validity_days integer not null default 15,
add column if not exists quote_observations_default text not null default
'Instalação inclusa.
Garantia de 6 meses para calhas e acessórios.
Prazo estimado: 15 dias após aprovação do orçamento.
Materiais de alta qualidade conforme especificações acima.
Qualquer alteração no projeto poderá alterar valores e prazos.',
add column if not exists payment_methods_available jsonb not null default '["pix","cartao","cheque","dinheiro"]'::jsonb;

comment on column public.companies.secondary_color is 'Cor secundária da identidade visual (ex: preto), usada em textos e detalhes do PDF.';
comment on column public.companies.qr_code_url is 'URL de destino do QR Code do orçamento (portfólio, site, Instagram, WhatsApp ou catálogo). Nulo = espaço reservado sem quebrar layout.';
comment on column public.companies.payment_methods_available is 'Lista de formas de pagamento que a empresa aceita exibir nos orçamentos: pix, cartao, cheque, dinheiro.';

-- ===== Dados específicos do orçamento (quotes) =====
alter table public.quotes
add column if not exists seller_name text,
add column if not exists payment_methods jsonb not null default '[]'::jsonb,
add column if not exists client_notes text;

comment on column public.quotes.seller_name is 'Nome do vendedor exibido no PDF. Editável inline na tela do orçamento, independente do perfil logado.';
comment on column public.quotes.payment_methods is 'Formas de pagamento selecionadas para este orçamento específico (subconjunto de companies.payment_methods_available). Ex: ["pix","cartao"].';
comment on column public.quotes.client_notes is 'Observações específicas do cliente para este orçamento (ex: "Cliente solicitou instalação completa").';

-- Preenche seller_name retroativamente a partir do perfil vinculado, quando existir.
update public.quotes q
set seller_name = p.full_name
from public.profiles p
where q.seller_id = p.id and q.seller_name is null;
