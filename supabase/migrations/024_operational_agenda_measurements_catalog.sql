-- Operational agenda, measurements and complete service catalog.

begin;

create table if not exists public.operational_events(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  event_type text not null check(event_type in ('medicao','instalacao','orcamento','pos_venda','manutencao','compra','outro')),
  title text not null,
  client_id uuid references public.clients(id),
  lead_id uuid references public.leads(id),
  quote_id uuid references public.quotes(id),
  order_id uuid references public.orders(id),
  installation_id uuid references public.installations(id),
  purchase_order_id uuid references public.purchase_orders(id),
  responsible_id uuid references public.profiles(id),
  starts_at timestamptz not null,
  ends_at timestamptz,
  address text,
  phone text,
  status text not null default 'agendado' check(status in ('agendado','confirmado','em_andamento','concluido','reagendado','cancelado')),
  color text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists operational_events_company_date_idx on public.operational_events(company_id,starts_at,status);

create table if not exists public.measurements(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  measurement_number text,
  client_id uuid references public.clients(id),
  lead_id uuid references public.leads(id),
  quote_id uuid references public.quotes(id),
  order_id uuid references public.orders(id),
  production_order_id uuid references public.production_orders(id),
  installation_id uuid references public.installations(id),
  responsible_id uuid references public.profiles(id),
  seller_id uuid references public.profiles(id),
  scheduled_at timestamptz,
  completed_at timestamptz,
  status text not null default 'agendado' check(status in ('agendado','confirmado','em_deslocamento','em_medicao','medicao_concluida','reagendado','cancelado')),
  address text,
  phone text,
  sketch_notes text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,measurement_number)
);
create index if not exists measurements_company_date_idx on public.measurements(company_id,scheduled_at,status);

create table if not exists public.measurement_items(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  measurement_id uuid not null references public.measurements(id) on delete cascade,
  environment text,
  product text not null,
  width numeric(12,3),
  height numeric(12,3),
  quantity numeric(12,3) not null default 1 check(quantity>0),
  color text,
  glass_type text,
  notes text,
  sort_order integer not null default 1
);
create index if not exists measurement_items_measurement_idx on public.measurement_items(measurement_id,sort_order);

create table if not exists public.measurement_checklists(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  measurement_id uuid not null references public.measurements(id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  notes text,
  sort_order integer not null,
  unique(measurement_id,sort_order)
);

create table if not exists public.discount_rules(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  customer_type text not null,
  percentage numeric(6,3) not null default 0 check(percentage between 0 and 100),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,customer_type)
);

alter table public.files add column if not exists client_id uuid references public.clients(id);
alter table public.files add column if not exists quote_id uuid references public.quotes(id);
alter table public.files add column if not exists order_id uuid references public.orders(id);
alter table public.files add column if not exists measurement_id uuid references public.measurements(id);
alter table public.files add column if not exists description text;

do $rls$
declare t text;
begin
  foreach t in array array['operational_events','measurements','measurement_items','measurement_checklists','discount_rules'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_select',t);
    execute format('drop policy if exists %I on public.%I',t||'_insert',t);
    execute format('drop policy if exists %I on public.%I',t||'_update',t);
    execute format('drop policy if exists %I on public.%I',t||'_delete',t);
    execute format('create policy %I on public.%I for select using(company_id=public.current_company_id() and public.has_table_access(%L,''select''))',t||'_select',t,t);
    execute format('create policy %I on public.%I for insert with check(company_id=public.current_company_id() and public.has_table_access(%L,''insert''))',t||'_insert',t,t);
    execute format('create policy %I on public.%I for update using(company_id=public.current_company_id() and public.has_table_access(%L,''update'')) with check(company_id=public.current_company_id())',t||'_update',t,t);
    execute format('create policy %I on public.%I for delete using(company_id=public.current_company_id() and public.has_table_access(%L,''delete''))',t||'_delete',t,t);
  end loop;
end $rls$;

create or replace function public.create_measurement_from_client(p_client_id uuid, p_scheduled_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_company_id(); client_row public.clients; measurement_id uuid; item text; n integer:=0;
begin
  perform public.require_table_access('measurements','insert');
  select * into client_row from public.clients where id=p_client_id and company_id=c;
  if client_row.id is null then raise exception 'Cliente invalido'; end if;
  insert into public.measurements(company_id,measurement_number,client_id,scheduled_at,address,phone,status,created_by)
  values(c,public.next_number('MED','public.measurements',c),client_row.id,p_scheduled_at,client_row.address,coalesce(client_row.whatsapp,client_row.phone),'agendado',auth.uid())
  returning id into measurement_id;
  for item in select x from unnest(array[
    'Medidas conferidas','Produto definido','Cor definida','Vidro definido','Acessorios definidos',
    'Forma de instalacao definida','Fotos realizadas','Cliente aprovou medidas','Producao liberada'
  ]) x loop
    n:=n+1;
    insert into public.measurement_checklists(company_id,measurement_id,title,sort_order) values(c,measurement_id,item,n);
  end loop;
  return measurement_id;
end $$;
revoke all on function public.create_measurement_from_client(uuid,timestamptz) from public;
grant execute on function public.create_measurement_from_client(uuid,timestamptz) to authenticated;

create or replace function public.create_quote_from_measurement(p_measurement_id uuid, p_sale_type_name text default 'Esquadrias sob medida')
returns uuid language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_company_id(); m public.measurements; sale_type_id uuid; new_quote_id uuid; subtotal_value numeric:=0;
begin
  perform public.require_table_access('measurements','select');
  perform public.require_table_access('quotes','insert');
  select * into m from public.measurements where id=p_measurement_id and company_id=c;
  if m.id is null or m.client_id is null then raise exception 'Medicao invalida'; end if;
  select id into sale_type_id from public.sale_types where company_id=c and name=p_sale_type_name and active limit 1;
  if sale_type_id is null then select id into sale_type_id from public.sale_types where company_id=c and active order by name limit 1; end if;
  if sale_type_id is null then raise exception 'Tipo de venda nao configurado'; end if;
  select coalesce(sum(quantity*0),0) into subtotal_value from public.measurement_items where measurement_id=m.id;
  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,notes,valid_until)
  values(c,public.next_number('ORC','public.quotes',c),m.client_id,sale_type_id,coalesce(m.seller_id,auth.uid()),subtotal_value,coalesce(m.notes,'')||E'\nGerado a partir da medicao '||coalesce(m.measurement_number,m.id::text),current_date+15)
  returning id into new_quote_id;
  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production)
  select c,new_quote_id,product,concat_ws(' | ',environment,width||' x '||height,color,glass_type,notes),'un',quantity,0,true,true
  from public.measurement_items where measurement_id=m.id;
  update public.measurements set quote_id=new_quote_id,status='medicao_concluida',completed_at=coalesce(completed_at,now()) where id=m.id;
  return new_quote_id;
end $$;
revoke all on function public.create_quote_from_measurement(uuid,text) from public;
grant execute on function public.create_quote_from_measurement(uuid,text) to authenticated;

drop view if exists public.v_operational_agenda;
create view public.v_operational_agenda with (security_invoker=true) as
select e.id,e.company_id,e.title,e.event_type,e.starts_at,e.ends_at,e.status,e.address,e.phone,e.notes,
  c.name as client_name,p.full_name as responsible_name
from public.operational_events e
left join public.clients c on c.id=e.client_id and c.company_id=e.company_id
left join public.profiles p on p.id=e.responsible_id and p.company_id=e.company_id
union all
select m.id,m.company_id,coalesce('Medicao - '||c.name,'Medicao tecnica') as title,'medicao' as event_type,m.scheduled_at,null,m.status,m.address,m.phone,m.notes,
  c.name,p.full_name
from public.measurements m
left join public.clients c on c.id=m.client_id and c.company_id=m.company_id
left join public.profiles p on p.id=m.responsible_id and p.company_id=m.company_id
where m.scheduled_at is not null
union all
select i.id,i.company_id,coalesce('Instalacao - pedido '||o.order_number,'Instalacao') as title,'instalacao' as event_type,i.scheduled_at,i.completed_at,i.status,i.address,null,i.notes,
  c.name,p.full_name
from public.installations i
left join public.orders o on o.id=i.order_id and o.company_id=i.company_id
left join public.clients c on c.id=o.client_id and c.company_id=i.company_id
left join public.profiles p on p.id=i.responsible_id and p.company_id=i.company_id
where i.scheduled_at is not null
union all
select t.id,t.company_id,t.title,'pos_venda' as event_type,t.due_at,null,t.status,null,null,t.description,
  null,p.full_name
from public.tasks t
left join public.profiles p on p.id=t.assigned_to and p.company_id=t.company_id
where t.due_at is not null;
grant select on public.v_operational_agenda to authenticated;

insert into public.permissions(role,resource,can_view,can_create,can_update,can_delete)
select role,resource,true,
  role in ('vendedor','atendente','instalador','compras','producao','estoque','financeiro'),
  role in ('vendedor','atendente','instalador','compras','producao','estoque','financeiro'),
  false
from unnest(array['vendedor','compras','producao','estoque','instalador','financeiro','atendente']::public.app_role[]) role
cross join unnest(array['operational_events','measurements','measurement_items','measurement_checklists','discount_rules']::text[]) resource
on conflict(role,resource) do update set
  can_view=excluded.can_view,can_create=excluded.can_create,can_update=excluded.can_update;

insert into public.discount_rules(company_id,customer_type,percentage)
select c.id,x.customer_type,x.percentage
from public.companies c
cross join (values
  ('Cliente Final',0),('Construtora',5),('Calheiro Parceiro',8),('Arquiteto',5),('Engenheiro',5),('Revendedor',10)
) as x(customer_type,percentage)
on conflict(company_id,customer_type) do nothing;

with categories(name) as (values
  ('Calhas'),('Rufos'),('Pingadeiras'),('Condutores'),('Acessorios'),('Servicos'),('Mao de Obra'),('Logistica')
)
insert into public.material_categories(company_id,name)
select c.id,categories.name from public.companies c cross join categories
on conflict(company_id,name) do nothing;

with catalog(category,name,unit) as (values
  ('Calhas','Calha Platibanda','m'),('Calhas','Calha de Beiral','m'),('Calhas','Calha Condutora','m'),('Calhas','Calha Coletora','m'),('Calhas','Calha de Meio','m'),('Calhas','Calha Moldura','m'),('Calhas','Calha Embutida','m'),
  ('Rufos','Rufo','m'),('Rufos','Rufo com Pingadeira','m'),('Rufos','Rufo de Acabamento','m'),('Rufos','Rufo Agua Furtada','m'),('Rufos','Rufo de Cumeeira','m'),('Rufos','Rufo Sobre Calha','m'),('Rufos','Rufo Chapeu','m'),('Rufos','Rufo Lateral','m'),('Rufos','Rufo Contra Parede','m'),('Rufos','Rufo Interno','m'),('Rufos','Rufo Externo','m'),
  ('Pingadeiras','Pingadeira','m'),('Pingadeiras','Pingadeira com Rufo','m'),('Pingadeiras','Pingadeira de Marquise','m'),('Pingadeiras','Pingadeira de Muro','m'),('Pingadeiras','Pingadeira de Janela','m'),
  ('Condutores','Condutor Redondo','m'),('Condutores','Condutor Retangular','m'),('Condutores','Condutor Especial','m'),('Condutores','Condutor Corrugado','m'),
  ('Acessorios','Cabeceira','un'),('Acessorios','Bocal','un'),('Acessorios','Emenda','un'),('Acessorios','Curva 45 graus','un'),('Acessorios','Curva 90 graus','un'),('Acessorios','Curva Especial','un'),('Acessorios','Joelho','un'),('Acessorios','Reducao','un'),('Acessorios','Ampliacao','un'),('Acessorios','Suporte','un'),('Acessorios','Abracadeira','un'),('Acessorios','Fixador','un'),('Acessorios','Rebite','un'),('Acessorios','Parafuso','un'),('Acessorios','Vedacao','un'),('Acessorios','PU MS40','un'),('Acessorios','Silicone','un'),('Acessorios','Fita Vedante','un'),
  ('Servicos','Instalacao de Calhas','serv'),('Servicos','Instalacao de Rufos','serv'),('Servicos','Instalacao de Pingadeiras','serv'),('Servicos','Limpeza de Calhas','serv'),('Servicos','Vedacao de Vazamentos','serv'),('Servicos','Troca de Calhas','serv'),('Servicos','Troca de Rufos','serv'),('Servicos','Troca de Condutores','serv'),('Servicos','Revisao Preventiva','serv'),('Servicos','Manutencao','serv'),
  ('Mao de Obra','Mao de Obra de Instalacao','serv'),('Mao de Obra','Mao de Obra de Producao','serv'),('Mao de Obra','Mao de Obra Especializada','serv'),('Mao de Obra','Mao de Obra de Manutencao','serv'),('Mao de Obra','Mao de Obra de Abertura de Telhado','serv'),('Mao de Obra','Mao de Obra de Fechamento de Telhado','serv'),
  ('Logistica','Deslocamento de Equipe','serv'),('Logistica','Frete','serv'),('Logistica','Taxa de Entrega','serv'),('Logistica','Taxa de Coleta','serv'),('Logistica','Caminhao Munck','serv'),('Logistica','Plataforma Elevatoria','serv'),('Logistica','Andaime','serv'),('Logistica','Locacao de Equipamentos','serv')
)
insert into public.materials(company_id,category_id,sku,name,unit,active)
select c.id,mc.id,upper(regexp_replace(catalog.name,'[^A-Za-z0-9]+','-','g')),catalog.name,catalog.unit,true
from public.companies c
join catalog on true
join public.material_categories mc on mc.company_id=c.id and mc.name=catalog.category
where not exists(select 1 from public.materials m where m.company_id=c.id and lower(m.name)=lower(catalog.name));

commit;
