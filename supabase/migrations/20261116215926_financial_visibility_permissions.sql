begin;
create or replace function public.has_table_access(resource text, action text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare allowed boolean;
begin
  if auth.uid() is null then return false; end if;
  if public.has_role(array['administrador','gerente']::public.app_role[]) then return true; end if;
  if $1 = any(array['payments','commissions','receiving_accounts','bank_reconciliation','financial_recurrences','financial_exports','financial_payroll']) then
    select bool_or(p.can_view) into allowed from public.permissions p join public.user_roles ur on ur.role=p.role where ur.profile_id=auth.uid() and p.resource='financial_entries';
    if not coalesce(allowed,false) then return false; end if;
  end if;
  select bool_or(case $2 when 'select' then p.can_view when 'insert' then p.can_create when 'update' then p.can_update when 'delete' then p.can_delete else false end)
    into allowed from public.permissions p join public.user_roles ur on ur.role=p.role where ur.profile_id=auth.uid() and p.resource=$1;
  return coalesce(allowed,false);
end $$;
revoke all on function public.has_table_access(text,text) from public,anon;
grant execute on function public.has_table_access(text,text) to authenticated;
drop policy if exists aluminum_cost_settings_read on public.aluminum_cost_settings;
create policy aluminum_cost_settings_read on public.aluminum_cost_settings for select to authenticated using(company_id=(select public.current_company_id()) and (select public.has_table_access('financial_entries','select')));
drop policy if exists order_aluminum_costs_read on public.order_aluminum_costs;
create policy order_aluminum_costs_read on public.order_aluminum_costs for select to authenticated using(company_id=(select public.current_company_id()) and (select public.has_table_access('financial_entries','select')));
-- Preserve the implementation and enforce financial authorization on cost RPCs.
do $$ declare definition text; begin
 select pg_get_functiondef('public.preview_quote_aluminum_cost(uuid)'::regprocedure) into definition;
 definition=replace(definition, 'not (public.has_table_access(''financial_entries'',''select'') or public.has_table_access(''gutter_prices'',''update''))', 'not public.has_table_access(''financial_entries'',''select'')');
 execute definition;
 select pg_get_functiondef('public.save_aluminum_cost_price(numeric)'::regprocedure) into definition;
 definition=replace(definition, 'not public.has_table_access(''gutter_prices'',''update'')', '(not public.has_table_access(''gutter_prices'',''update'') or not public.has_table_access(''financial_entries'',''select''))');
 execute definition;
end $$;
commit;