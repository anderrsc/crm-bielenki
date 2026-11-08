-- Itens herdam a permissao do documento: quem ve/edita orcamento ve/edita os
-- itens dele. Sem estas linhas, vendedor e atendente criavam o orcamento
-- (pela funcao do banco) mas abriam a folha/PDF SEM os itens.
begin;

insert into public.permissions(role, resource, can_view, can_create, can_update, can_delete)
select p.role, child.resource, p.can_view, p.can_create, p.can_update, p.can_delete
from public.permissions p
join (values
  ('quotes', 'quote_items'),
  ('quotes', 'gutter_quotes'),
  ('quotes', 'gutter_quote_items'),
  ('sales', 'sale_items'),
  ('orders', 'order_items'),
  ('orders', 'order_checklists')
) as child(parent, resource) on child.parent = p.resource
on conflict (role, resource) do nothing;

commit;
