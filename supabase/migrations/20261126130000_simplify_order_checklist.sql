-- Migration 20261126130000 — Simplifica o checklist de pedidos
-- Tipos com produção + instalação e Manutenção passam a ter 9 itens (ou 6 para Manutenção).
-- Os tipos de venda simples (acessórios, online, dobradas na hora) são mantidos.

do $$
declare
  tpl_row record;
  n integer;
  items text[];
begin
  for tpl_row in
    select ct.id as tpl_id, st.name as sale_name
      from public.checklist_templates ct
      join public.sale_types st on st.id = ct.sale_type_id
     where ct.is_default = true
  loop
    items := case
      when tpl_row.sale_name in ('Calhas instaladas','Esquadrias sob medida','Estruturas metálicas','Fachadas','Portões') then
        array['Confirmar medida','Produção iniciada','Cortado','Dobrado','Instalação agendada','Instalado','Cobrança','Valor pago','Pós-venda']
      when tpl_row.sale_name = 'Manutenção' then
        array['Confirmar medida','Instalação agendada','Instalado','Cobrança','Valor pago','Pós-venda']
      when tpl_row.sale_name = 'Venda de calhas dobradas na hora' then
        array['Espessura definida','Metragem definida','Cortado','Dobrado','Pagamento recebido','Produto entregue']
      else null
    end;

    if items is null then continue; end if;

    delete from public.checklist_template_items where template_id = tpl_row.tpl_id;

    n := 0;
    for i in 1..array_length(items, 1) loop
      n := n + 1;
      insert into public.checklist_template_items(company_id, template_id, title, required, sort_order, due_days)
      select ct.company_id, tpl_row.tpl_id, items[i], true, n, n
        from public.checklist_templates ct
       where ct.id = tpl_row.tpl_id;
    end loop;
  end loop;
end $$;
