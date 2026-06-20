-- Permissões padrão. Administrador e gerente têm acesso total pela função has_table_access.
insert into public.permissions(role,resource,can_view,can_create,can_update,can_delete)
select role,resource,true,
  case when role in ('vendedor','compras','producao','estoque','instalador','financeiro','atendente') then true else false end,
  true,
  false
from unnest(array['vendedor','compras','producao','estoque','instalador','financeiro','atendente']::public.app_role[]) role
cross join unnest(array['clients','quotes','sales','orders','order_checklist_items','suppliers','purchase_requests','purchase_request_items','purchase_orders','purchase_order_items','materials','stock_locations','stock_movements','production_orders','production_order_items','production_materials','installations','installation_checklists','financial_entries','payments','leads','activities','tasks','followups','conversations','messages','notifications','files']::text[]) resource
on conflict do nothing;

-- Restrições específicas sobre a matriz ampla acima.
update public.permissions set can_view=false,can_create=false,can_update=false
where (role in ('producao','estoque','instalador') and resource in ('financial_entries','payments'))
   or (role in ('financeiro') and resource in ('stock_movements','production_orders','production_order_items'))
   or (role in ('vendedor','atendente') and resource in ('stock_movements','payments'));

create or replace function public.bootstrap_company(p_name text,p_tax_id text default null,p_user_id uuid default auth.uid()) returns uuid language plpgsql security definer set search_path=public as $$
declare c uuid; u uuid:=coalesce(p_user_id,auth.uid()); st uuid; tpl uuid; sale_name text; template_item text; n int;
begin
  if u is null then raise exception 'Autenticação obrigatória'; end if;
  if exists(select 1 from public.profiles where id=u) then raise exception 'Usuário já pertence a uma empresa'; end if;
  insert into public.companies(name,tax_id) values(p_name,p_tax_id) returning id into c;
  insert into public.profiles(id,company_id,full_name) select u,c,coalesce(raw_user_meta_data->>'full_name',split_part(email,'@',1)) from auth.users where id=u;
  insert into public.user_roles(company_id,profile_id,role) values(c,u,'administrador');
  insert into public.client_types(company_id,name) select c,x from unnest(array['Cliente final','Construtora','Arquiteto','Engenheiro','Lojista','Revenda','Cliente online','Cliente balcão','Cliente recorrente','Cliente avulso']) x;
  insert into public.supplier_categories(company_id,name) select c,x from unnest(array['Perfis de alumínio','Acessórios','Vidros','Chapas e bobinas','Ferragens','Pintura','Embalagens','Outros']) x;
  insert into public.material_categories(company_id,name) select c,x from unnest(array['Perfis de alumínio','Acessórios','Vidros','Borrachas','Fechaduras','Rodízios','Trilhos','Parafusos','Silicone','PU','Chapas de calha','Bobinas','Pintura','Embalagens','Motores','Ferragens','Outros']) x;
  insert into public.stock_locations(company_id,name) values(c,'Estoque principal');
  insert into public.pipeline_stages(company_id,name,color,sort_order,is_won,is_lost) values(c,'Novo lead','#94a3b8',1,false,false),(c,'Contato realizado','#60a5fa',2,false,false),(c,'Orçamento enviado','#f59e0b',3,false,false),(c,'Negociação','#8b5cf6',4,false,false),(c,'Ganho','#22c55e',5,true,false),(c,'Perdido','#ef4444',6,false,true);
  insert into public.sale_types(company_id,name,requires_purchase,requires_production,requires_installation) values
    (c,'Esquadrias sob medida',true,true,true),(c,'Calhas instaladas',true,true,true),(c,'Venda avulsa de acessórios',false,false,false),(c,'Venda avulsa de janelas online',false,false,false),(c,'Venda de calhas dobradas na hora',true,true,false),(c,'Manutenção',false,false,true),(c,'Serviço avulso',false,false,false),(c,'Estruturas metálicas',true,true,true),(c,'Fachadas',true,true,true),(c,'Portões',true,true,true);
  for st,sale_name in select id,name from public.sale_types where company_id=c loop
    insert into public.checklist_templates(company_id,sale_type_id,name,is_default) values(c,st,'Checklist - '||sale_name,true) returning id into tpl;
    n:=0;
    for template_item in select x from unnest(case
      when sale_name='Calhas instaladas' then array['Orçamento aprovado','Entrada recebida','Medidas conferidas','Chapa separada','Calhas dobradas','Instalação agendada','Instalação realizada','Cobrança final','Pós-venda realizado','Pedido finalizado']
      when sale_name='Venda avulsa de acessórios' then array['Pedido confirmado','Pagamento confirmado','Produto separado','Entrega/retirada','Finalizado']
      when sale_name='Venda avulsa de janelas online' then array['Pedido recebido','Pagamento confirmado','Produto conferido','Embalagem','Envio/retirada','Código de rastreio','Finalizado']
      when sale_name='Venda de calhas dobradas na hora' then array['Produto escolhido','Espessura definida','Corte definido','Metragem definida','Dobra realizada','Pagamento recebido','Produto entregue']
      else array['Contrato feito','Contrato assinado','Entrada recebida','Medidas conferidas','Projeto/desenho conferido','Acessórios conferidos','Compra solicitada','Compra aprovada','Compra realizada','Compra conferida','Material recebido','Material separado','Liberado para produção','Produção iniciada','Produção conferida','Instalação agendada','Instalação realizada','Instalação conferida','Cliente cobrado','Pagamento final recebido','Pós-venda realizado','Pedido finalizado'] end) x loop
      n:=n+1; insert into public.checklist_template_items(company_id,template_id,title,required,sort_order,due_days) values(c,tpl,template_item,true,n,n);
    end loop;
  end loop;
  return c;
end $$;
revoke all on function public.bootstrap_company(text,text,uuid) from public;
grant execute on function public.bootstrap_company(text,text,uuid) to authenticated,service_role;

-- Mantém vencimentos visíveis sem depender de processo agendado.
create or replace view public.v_financial_entries with (security_invoker=true) as
select f.*,case when f.status in ('aguardando_pagamento','parcialmente_pago') and f.due_date<current_date then 'vencido'::public.financial_status else f.status end display_status
from public.financial_entries f;
