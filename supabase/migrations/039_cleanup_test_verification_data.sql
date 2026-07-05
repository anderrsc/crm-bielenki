-- Migration 039 - Remove dados de teste gerados durante a verificacao do fix de orcamentos
--
-- Remove todos os registros ligados ao cliente "Cliente Teste Verificacao"
-- (13 orcamentos de teste, incluindo 1 aprovado que gerou venda/pedido/
-- financeiro/producao em cascata via approve_quote). Nada real do usuario
-- e afetado: o filtro e por nome+telefone exatos do cliente de teste.
--
-- Rode manualmente no SQL Editor do Supabase (mesmo lugar da migration 038).

begin;

do $$
declare v_client uuid;
begin
  select id into v_client
  from public.clients
  where name = 'Cliente Teste Verificação' and phone = '(47) 99999-0000';

  if v_client is null then
    raise notice 'Cliente de teste nao encontrado, nada a limpar.';
    return;
  end if;

  delete from public.production_orders
  where order_id in (select id from public.orders where client_id = v_client);

  delete from public.purchase_requests
  where order_id in (select id from public.orders where client_id = v_client);

  delete from public.orders where client_id = v_client;

  delete from public.financial_entries
  where sale_id in (select id from public.sales where client_id = v_client);

  delete from public.sales where client_id = v_client;

  delete from public.quotes where client_id = v_client;
end $$;

commit;
