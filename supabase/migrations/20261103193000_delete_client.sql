-- Apagar cliente cadastrado por engano (ex.: duplicado).
-- Bloqueia quando o cliente já tem orçamento, venda, pedido ou lançamento
-- financeiro (nesses casos, usar "Desativar"). Os demais registros que
-- apontam para o cliente (lead, atividades, conversas, medições...) ficam,
-- só sem o vínculo. Pode ser rodada mais de uma vez.

create or replace function public.delete_client_unchecked(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c public.clients;
begin
  select * into c from public.clients where id = p_client_id and company_id = public.current_company_id() for update;
  if c.id is null then raise exception 'Cliente não encontrado'; end if;
  if exists (select 1 from public.quotes where client_id = c.id) then
    raise exception 'Este cliente tem orçamentos. Exclua os orçamentos antes ou use "Desativar".';
  end if;
  if exists (select 1 from public.sales where client_id = c.id) or exists (select 1 from public.orders where client_id = c.id) then
    raise exception 'Este cliente tem vendas ou pedidos. Use "Desativar".';
  end if;
  if exists (select 1 from public.financial_entries where client_id = c.id) then
    raise exception 'Este cliente tem lançamentos no financeiro. Use "Desativar".';
  end if;
  update public.leads set client_id = null where client_id = c.id;
  update public.activities set client_id = null where client_id = c.id;
  update public.followups set client_id = null where client_id = c.id;
  update public.conversations set client_id = null where client_id = c.id;
  update public.files set client_id = null where client_id = c.id;
  update public.outbound_messages set client_id = null where client_id = c.id;
  update public.operational_events set client_id = null where client_id = c.id;
  update public.measurements set client_id = null where client_id = c.id;
  update public.purchase_order_items set client_id = null where client_id = c.id;
  delete from public.clients where id = c.id;
end $function$;

create or replace function public.delete_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.require_table_access('clients', 'delete');
  perform public.delete_client_unchecked(p_client_id);
end $function$;

revoke all on function public.delete_client_unchecked(uuid) from public, anon, authenticated;
grant execute on function public.delete_client_unchecked(uuid) to service_role;
revoke all on function public.delete_client(uuid) from public, anon;
grant execute on function public.delete_client(uuid) to authenticated, service_role;
