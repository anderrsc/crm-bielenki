-- Orçamento impresso/PDF: valor do deslocamento oculto ("Incluso") e coluna
-- de valor unitário oculta por padrão nos orçamentos novos. Os dois podem ser
-- ligados de volta no formulário. Orçamentos já emitidos não mudam a coluna
-- de valor unitário. Pode ser rodada mais de uma vez.
alter table public.quotes
  add column if not exists hide_travel_price boolean not null default true;

alter table public.quotes
  alter column hide_unit_prices set default true;

comment on column public.quotes.hide_travel_price is 'Quando true, o item de deslocamento aparece como "Incluso", sem valor, no orçamento impresso/PDF.';
