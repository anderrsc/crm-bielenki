-- Dados de exemplo cobrindo cada modulo, para os testes. Usa a primeira
-- empresa/usuario existente (criados pelo bootstrap_company nos testes).
do $$
declare
  c uuid; u uuid; st uuid; cli uuid; sup uuid; q uuid; s uuid; o uuid; po uuid; pu uuid;
begin
  select company_id, id into c, u from public.profiles order by created_at limit 1;
  perform set_config('request.jwt.claim.sub', u::text, true);
  select id into st from public.sale_types where company_id=c and name='Calhas instaladas';

  insert into public.clients(company_id,name,phone,city,state,address) values(c,'Cliente Exemplo','(47) 99999-0000','Jaraguá do Sul','SC','Rua A, 1') returning id into cli;
  insert into public.suppliers(company_id,name,city) values(c,'Fornecedor Exemplo','Joinville') returning id into sup;

  -- orcamento antigo em aberto (pendencia de orcamento)
  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,subtotal,valid_until,created_at)
  values(c,'ORC-TESTE-00001',cli,st,1500,current_date-1,now()-interval '10 days') returning id into q;
  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,item_type)
  values(c,q,'Calha Coletora','Calha Coletora 0.7mm','m',10,150,'calha');

  -- venda -> pedido -> producao/instalacao
  insert into public.sales(company_id,sale_number,client_id,sale_type_id,total) values(c,'VEN-TESTE-00001',cli,st,3000) returning id into s;
  select id into o from public.orders where sale_id=s;
  if o is null then
    insert into public.orders(company_id,order_number,sale_id,client_id,sale_type_id) values(c,'PED-TESTE-00001',s,cli,st) returning id into o;
  end if;
  insert into public.production_orders(company_id,production_number,order_id,status,planned_end) values(c,'PROD-TESTE-00001',o,'em_producao',current_date-3);
  insert into public.installations(company_id,order_id,scheduled_at,status,address) values(c,o,now()+interval '5 hours','agendada','Rua A, 1');

  -- compra atrasada
  insert into public.purchase_orders(company_id,order_number,supplier_id,status,total,expected_at) values(c,'COMP-TESTE-00001',sup,'pedido_realizado',800,current_date-2);

  -- financeiro vencido (receber e pagar)
  insert into public.financial_entries(company_id,entry_type,origin,client_id,description,total_amount,due_date)
  values(c,'receber','manual',cli,'Parcela vencida cliente',1000,current_date-20);
  insert into public.financial_entries(company_id,entry_type,origin,supplier_id,description,total_amount,due_date)
  values(c,'pagar','manual',sup,'Boleto fornecedor vencido',500,current_date-5);

  -- medicao sem data
  insert into public.measurements(company_id,measurement_number,client_id,status) values(c,'MED-TESTE-00001',cli,'agendado');
end $$;
