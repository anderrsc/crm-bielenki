begin;
-- Todo pedido fechado entra na aba Producao (antes so os que tinham item marcado
-- "requer producao"). Roda no fim da transacao para nao duplicar a ordem que a
-- aprovacao do orcamento ja cria.
create or replace function crm_private.ensure_production_order() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.orders where id=new.id) then return null; end if;
  if exists(select 1 from public.production_orders where order_id=new.id) then return null; end if;
  insert into public.production_orders(company_id,production_number,order_id,status,flow_type)
  values(new.company_id,public.next_number('OP','public.production_orders',new.company_id),new.id,'aguardando_material',
    case when exists(select 1 from public.sale_types st where st.id=new.sale_type_id and st.name ilike 'Esquadrias%') then 'esquadrias' else 'calhas' end);
  return null;
end $$;
revoke all on function crm_private.ensure_production_order() from public,anon,authenticated;
drop trigger if exists orders_ensure_production on public.orders;
create constraint trigger orders_ensure_production after insert on public.orders
  deferrable initially deferred for each row execute function crm_private.ensure_production_order();

-- Pedidos em aberto que ficaram de fora passam a aparecer.
insert into public.production_orders(company_id,production_number,order_id,status,flow_type)
select o.company_id,
  'OP-'||to_char(current_date,'YYYY')||'-P'||lpad((row_number() over (partition by o.company_id order by o.created_at))::text,4,'0'),
  o.id,'aguardando_material',
  case when st.name ilike 'Esquadrias%' then 'esquadrias' else 'calhas' end
from public.orders o
left join public.sale_types st on st.id=o.sale_type_id
where o.operational_status not in ('finalizado','cancelado')
  and not exists(select 1 from public.production_orders p where p.order_id=o.id)
  and not exists(select 1 from public.production_orders p where p.company_id=o.company_id and p.production_number like 'OP-'||to_char(current_date,'YYYY')||'-P%');

-- Aviso de "instalado" ao cliente: enviado uma unica vez por pedido.
alter table public.orders add column if not exists install_notified_at timestamptz;
commit;
