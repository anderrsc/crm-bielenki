-- Vendedor vê só as vendas (e pedidos/itens dessas vendas) em que ele é o vendedor.
-- Administrador, gerente e qualquer outro cargo com acesso a vendas (financeiro, produção,
-- instalação, compras, estoque) continuam vendo todas. Só afeta quem tem APENAS cargos de venda.
create or replace function public.sales_scope_restricted()
returns boolean language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select exists(select 1 from public.user_roles where profile_id = auth.uid() and role = 'vendedor')
     and not exists(select 1 from public.user_roles where profile_id = auth.uid()
                    and role in ('administrador','gerente','financeiro','producao','instalador','compras','estoque'));
$$;
revoke all on function public.sales_scope_restricted() from public, anon;
grant execute on function public.sales_scope_restricted() to authenticated, service_role;

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('sales','select'))
    and (not (select public.sales_scope_restricted()) or seller_id = (select auth.uid())));

drop policy if exists sales_update on public.sales;
create policy sales_update on public.sales for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('sales','update'))
    and (not (select public.sales_scope_restricted()) or seller_id = (select auth.uid())))
  with check (company_id = (select public.current_company_id()));

drop policy if exists sale_items_select on public.sale_items;
create policy sale_items_select on public.sale_items for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('sale_items','select'))
    and (not (select public.sales_scope_restricted())
         or exists(select 1 from public.sales s where s.id = sale_items.sale_id and s.seller_id = (select auth.uid()))));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('orders','select'))
    and (not (select public.sales_scope_restricted())
         or exists(select 1 from public.sales s where s.id = orders.sale_id and s.seller_id = (select auth.uid()))));

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('order_items','select'))
    and (not (select public.sales_scope_restricted())
         or exists(select 1 from public.orders o join public.sales s on s.id = o.sale_id
                   where o.id = order_items.order_id and s.seller_id = (select auth.uid()))));
