begin;

create or replace function public.gutter_catalog_category(p_product text)
returns text language sql immutable as $$
  select case
    when coalesce(p_product,'') ilike '%pingadeira%' then 'Pingadeiras'
    when coalesce(p_product,'') ilike '%rufo%' then 'Rufos'
    when coalesce(p_product,'') ilike '%condutor%' or coalesce(p_product,'') ilike '%joelho%' or coalesce(p_product,'') ilike '%bocal%' then 'Condutores'
    when coalesce(p_product,'') ilike '%suporte%' or coalesce(p_product,'') ilike '%rebite%' or coalesce(p_product,'') ilike '%silicone%' or coalesce(p_product,'') ilike '%vedante%' or coalesce(p_product,'') ilike '%cabeceira%' or coalesce(p_product,'') ilike '%fixador%' then 'Acessórios'
    when coalesce(p_product,'') ilike '%mão de obra%' or coalesce(p_product,'') ilike '%mao de obra%' or coalesce(p_product,'') ilike '%frete%' or coalesce(p_product,'') ilike '%deslocamento%' then 'Serviços'
    when coalesce(p_product,'') ilike '%coifa%' or coalesce(p_product,'') ilike '%chamin%' or coalesce(p_product,'') ilike '%exaustor%' or coalesce(p_product,'') ilike '%duto%' or coalesce(p_product,'') ilike '%sob medida%' or coalesce(p_product,'') ilike '%corte e dobra%' then 'Itens Especiais'
    else 'Calhas'
  end
$$;

create or replace function public.gutter_catalog_item_type(p_category text)
returns text language sql immutable as $$
  select case
    when p_category = 'Serviços' then 'servico'
    when p_category in ('Acessórios','Itens Especiais') then 'item_especial'
    when p_category = 'Condutores' then 'condutor'
    else 'fabricacao'
  end
$$;

alter table public.gutter_prices
  add column if not exists item_type text not null default 'fabricacao',
  add column if not exists diameter text,
  add column if not exists height text,
  add column if not exists length text,
  add column if not exists sort_order integer not null default 0;

alter table public.gutter_prices alter column category set default 'Calhas';
alter table public.gutter_prices alter column unit set default 'Metro Linear (m)';
alter table public.gutter_prices alter column thickness drop not null;
alter table public.gutter_prices alter column cut_mm drop not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.gutter_prices'::regclass
      and conname = 'gutter_prices_cut_mm_check'
  ) then
    alter table public.gutter_prices drop constraint gutter_prices_cut_mm_check;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.gutter_prices'::regclass
      and conname = 'gutter_prices_cut_mm_positive'
  ) then
    alter table public.gutter_prices
      add constraint gutter_prices_cut_mm_positive check (cut_mm is null or cut_mm > 0);
  end if;
end;
$$;

alter table public.gutter_quote_items
  add column if not exists category text not null default 'Calhas',
  add column if not exists item_type text not null default 'fabricacao',
  add column if not exists unit text not null default 'Metro Linear (m)',
  add column if not exists install_price numeric(14,2) not null default 0 check (install_price >= 0),
  add column if not exists sort_order integer not null default 0;

update public.gutter_prices
set
  category = case
    when category in ('Calhas Padrão','Calhas Padrao') then 'Calhas'
    when category in ('Rufos e Pingadeiras') then public.gutter_catalog_category(product)
    when category in ('Condutores e Acessórios','Condutores e Acessorios') then public.gutter_catalog_category(product)
    when category in ('Mão de Obra','Mao de Obra','Pintura','Frete e Deslocamento','Manutenção','Manutencao') then 'Serviços'
    when category is null then public.gutter_catalog_category(product)
    else category
  end,
  thickness = case
    when lower(replace(coalesce(thickness,''),' ','')) in ('0.5mm','0.50mm','0.5') then '0.50 mm'
    when lower(replace(coalesce(thickness,''),' ','')) in ('0.6mm','0.60mm','0.6') then '0.60 mm'
    when lower(replace(coalesce(thickness,''),' ','')) in ('0.7mm','0.70mm','0.7') then '0.70 mm'
    when lower(replace(coalesce(thickness,''),' ','')) in ('1.0mm','1.00mm','1.0','1') then '1.00 mm'
    else nullif(thickness,'')
  end,
  color = case
    when color is null or color in ('Natural','Alumínio Natural','Aluminio Natural') then 'Aluminio Natural'
    when color = 'Branco' then 'Pintura Branco'
    when color = 'Preto' then 'Pintura Preto'
    when color = 'Marrom' then 'Pintura Marrom'
    when color = 'Cinza' then 'Pintura Cinza'
    when color in ('Personalizada','Personalizado','Outra') then 'Pintura Personalizado'
    else color
  end,
  unit = coalesce(nullif(unit,''),'Metro Linear (m)'),
  updated_at = now();

update public.gutter_prices
set
  item_type = public.gutter_catalog_item_type(category),
  cut_mm = case when category in ('Calhas','Rufos','Pingadeiras') then cut_mm else null end,
  thickness = case
    when category in ('Calhas','Rufos','Pingadeiras') then thickness
    when category = 'Condutores' and product ilike '%alumínio%' then thickness
    when category = 'Condutores' and product ilike '%aluminio%' then thickness
    else null
  end,
  color = case
    when category in ('Calhas','Rufos','Pingadeiras') then color
    when category = 'Condutores' and product ilike '%pvc%' then null
    when category in ('Acessórios','Serviços','Itens Especiais') then null
    else color
  end,
  unit = case
    when category in ('Calhas','Rufos','Pingadeiras') then 'Metro Linear (m)'
    when unit in ('metro','m') then 'Metro'
    when unit in ('un','unidade') then 'Unidade'
    when unit in ('peça','peca') then 'Peça'
    when unit in ('serviço','servico','serv') then 'Serviço'
    when unit in ('diária','diaria') then 'Diária'
    else unit
  end,
  updated_at = now();

update public.gutter_quote_items
set
  category = public.gutter_catalog_category(product),
  item_type = 'fabricacao',
  unit = 'Metro Linear (m)',
  install_price = coalesce(install_price,0);

update public.aluminum_price_matrix
set thickness = case
  when lower(replace(thickness,' ','')) in ('0.5mm','0.50mm','0.5') then '0.50 mm'
  when lower(replace(thickness,' ','')) in ('0.6mm','0.60mm','0.6') then '0.60 mm'
  when lower(replace(thickness,' ','')) in ('0.7mm','0.70mm','0.7') then '0.70 mm'
  when lower(replace(thickness,' ','')) in ('1.0mm','1.00mm','1.0','1') then '1.00 mm'
  else thickness
end;

with fabricated(category, product) as (values
  ('Calhas','Calha de Beiral'),
  ('Calhas','Calha Platibanda'),
  ('Calhas','Calha Coletora'),
  ('Calhas','Calha de Meio (Cocho)'),
  ('Calhas','Calha Água Furtada'),
  ('Calhas','Calha Moldura'),
  ('Calhas','Calha Quadrada'),
  ('Rufos','Rufo'),
  ('Rufos','Rufo Externo'),
  ('Rufos','Rufo Interno'),
  ('Rufos','Rufo de Marquise'),
  ('Rufos','Rufo com Pingadeira'),
  ('Rufos','Rufo Chapéu'),
  ('Rufos','Rufo de Acabamento'),
  ('Rufos','Rufo de Cumeeira'),
  ('Rufos','Rufo Sobre Calha'),
  ('Rufos','Rufo para Chaminé'),
  ('Pingadeiras','Pingadeira'),
  ('Pingadeiras','Pingadeira com Rufo'),
  ('Pingadeiras','Pingadeira Dupla'),
  ('Pingadeiras','Pingadeira para Muro'),
  ('Pingadeiras','Pingadeira de Marquise')
),
thicknesses(thickness) as (values ('0.50 mm'),('0.60 mm'),('0.70 mm'),('1.00 mm')),
cuts(cut_mm) as (values (150),(200),(250),(300),(330),(350),(400),(500),(600),(700),(800),(900),(1000),(1200)),
colors(color) as (values
  ('Aluminio Natural'),
  ('Pintura Branco'),
  ('Galvanizado Branco'),
  ('Pintura Preto'),
  ('Galvanizado Preto'),
  ('Pintura Marrom'),
  ('Pintura Cinza'),
  ('Pintura Personalizado')
)
insert into public.gutter_prices(company_id,category,item_type,product,thickness,cut_mm,unit,color,unit_price,install_price,notes,active)
select c.id, f.category, 'fabricacao', f.product, t.thickness, ct.cut_mm, 'Metro Linear (m)', co.color, 0, 0, null, true
from public.companies c
cross join fabricated f
cross join thicknesses t
cross join cuts ct
cross join colors co
where not exists (
  select 1 from public.gutter_prices gp
  where gp.company_id = c.id
    and lower(gp.category) = lower(f.category)
    and lower(gp.product) = lower(f.product)
    and coalesce(gp.thickness,'') = t.thickness
    and coalesce(gp.cut_mm,0) = ct.cut_mm
    and coalesce(gp.color,'') = co.color
);

with catalog(category,item_type,product,unit) as (values
  ('Condutores','condutor','Condutor de PVC Redondo 75 mm','Metro'),
  ('Condutores','condutor','Condutor de PVC Redondo 100 mm','Metro'),
  ('Condutores','condutor','Condutor Retangular em Alumínio','Metro'),
  ('Condutores','condutor','Condutor Quadrado em Alumínio','Metro'),
  ('Condutores','condutor','Curva para Condutor','Unidade'),
  ('Condutores','condutor','Joelho para Condutor','Unidade'),
  ('Condutores','condutor','Saída/Bocal para Condutor','Unidade'),
  ('Acessórios','item_especial','Par de Cabeceira','Peça'),
  ('Acessórios','item_especial','Suporte Interno U','Unidade'),
  ('Acessórios','item_especial','Suporte Externo (Gancho)','Unidade'),
  ('Acessórios','item_especial','Bocal de Saída','Unidade'),
  ('Acessórios','item_especial','Curva','Unidade'),
  ('Acessórios','item_especial','Cinto de Amarração de Condutor','Unidade'),
  ('Acessórios','item_especial','Fixadores','Caixa'),
  ('Acessórios','item_especial','Rebites','Caixa'),
  ('Acessórios','item_especial','Silicone Neutro','Tubo'),
  ('Acessórios','item_especial','Tubo Vedante PU MS40','Tubo'),
  ('Serviços','servico','Mão de Obra para Instalação de Calhas','Metro'),
  ('Serviços','servico','Mão de Obra para Instalação de Rufos','Metro'),
  ('Serviços','servico','Mão de Obra para Instalação de Pingadeiras','Metro'),
  ('Serviços','servico','Mão de Obra para Limpeza de Calhas','Serviço'),
  ('Serviços','servico','Mão de Obra para Manutenção de Calhas','Serviço'),
  ('Serviços','servico','Mão de Obra para Vedação com PU','Serviço'),
  ('Serviços','servico','Mão de Obra para Troca de Calhas','Metro'),
  ('Serviços','servico','Mão de Obra para Troca de Rufos','Metro'),
  ('Serviços','servico','Mão de Obra e Materiais para Pintura de Calhas','Serviço'),
  ('Serviços','servico','Deslocamento','Serviço'),
  ('Serviços','servico','Frete','Serviço'),
  ('Serviços','servico','Mão de Obra de Manutenção','Hora'),
  ('Serviços','servico','Mão de Obra de Abertura e Fechamento de Telhado','Diária'),
  ('Itens Especiais','item_especial','Coifa em Alumínio','Unidade'),
  ('Itens Especiais','item_especial','Chaminé em Alumínio Ø300 mm','Unidade'),
  ('Itens Especiais','item_especial','Chaminé em Alumínio Ø250 mm','Unidade'),
  ('Itens Especiais','item_especial','Chaminé em Alumínio Ø400 mm','Unidade'),
  ('Itens Especiais','item_especial','Chaminé em Alumínio Ø500 mm','Unidade'),
  ('Itens Especiais','item_especial','Exaustor Eólico','Unidade'),
  ('Itens Especiais','item_especial','Coifa Interna em Alumínio','Unidade'),
  ('Itens Especiais','item_especial','Duto Especial','Metro'),
  ('Itens Especiais','item_especial','Chaminé em Inox 304 Ø150 mm','Unidade'),
  ('Itens Especiais','item_especial','Peça Sob Medida','Unidade'),
  ('Itens Especiais','item_especial','Corte e Dobra Especial','Serviço')
)
insert into public.gutter_prices(company_id,category,item_type,product,thickness,cut_mm,unit,color,unit_price,install_price,notes,active,diameter)
select c.id, catalog.category, catalog.item_type, catalog.product, null, null, catalog.unit, null, 0, 0, null, true,
  case
    when catalog.product ilike '%Ø300%' then 'Ø300 mm'
    when catalog.product ilike '%Ø250%' then 'Ø250 mm'
    when catalog.product ilike '%Ø400%' then 'Ø400 mm'
    when catalog.product ilike '%Ø500%' then 'Ø500 mm'
    when catalog.product ilike '%Ø150%' then 'Ø150 mm'
    else null
  end
from public.companies c
cross join catalog
where not exists (
  select 1 from public.gutter_prices gp
  where gp.company_id = c.id
    and lower(gp.category) = lower(catalog.category)
    and lower(gp.product) = lower(catalog.product)
    and coalesce(lower(gp.unit),'') = lower(catalog.unit)
);

with thicknesses(thickness) as (values ('0.50 mm'),('0.60 mm'),('0.70 mm'),('1.00 mm')),
cuts(cut_mm) as (values (150),(200),(250),(300),(330),(350),(400),(500),(600),(700),(800),(900),(1000),(1200))
insert into public.aluminum_price_matrix(company_id, thickness, cut_mm, price_per_meter)
select c.id, t.thickness, ct.cut_mm, 0
from public.companies c
cross join thicknesses t
cross join cuts ct
where not exists (
  select 1 from public.aluminum_price_matrix apm
  where apm.company_id = c.id and apm.thickness = t.thickness and apm.cut_mm = ct.cut_mm
);

create index if not exists idx_gutter_prices_standard_catalog
  on public.gutter_prices(company_id, category, product, active);

create or replace function public.bulk_save_prices(p_rows jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  row_data jsonb;
  v_cid uuid;
  v_cut integer;
  v_category text;
begin
  select company_id into v_cid from public.profiles where id = auth.uid();
  if v_cid is null then raise exception 'Empresa não encontrada'; end if;

  for row_data in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_cut := nullif(row_data->>'cut_mm','')::integer;
    v_category := coalesce(nullif(row_data->>'category',''), public.gutter_catalog_category(row_data->>'product'));

    if (row_data->>'id') is not null and (row_data->>'id') <> '' then
      update public.gutter_prices set
        product          = coalesce(nullif(row_data->>'product',''), product),
        category         = v_category,
        item_type        = coalesce(nullif(row_data->>'item_type',''), public.gutter_catalog_item_type(v_category)),
        thickness        = nullif(row_data->>'thickness',''),
        cut_mm           = v_cut,
        unit             = coalesce(nullif(row_data->>'unit',''), unit),
        color            = nullif(row_data->>'color',''),
        unit_price       = coalesce(nullif(row_data->>'unit_price','')::numeric, unit_price),
        labor_price      = coalesce(nullif(row_data->>'labor_price','')::numeric, labor_price),
        paint_price      = coalesce(nullif(row_data->>'paint_price','')::numeric, paint_price),
        install_price    = coalesce(nullif(row_data->>'install_price','')::numeric, install_price),
        freight_price    = coalesce(nullif(row_data->>'freight_price','')::numeric, freight_price),
        min_price        = coalesce(nullif(row_data->>'min_price','')::numeric, min_price),
        margin_pct       = coalesce(nullif(row_data->>'margin_pct','')::numeric, margin_pct),
        max_discount_pct = coalesce(nullif(row_data->>'max_discount_pct','')::numeric, max_discount_pct),
        notes            = nullif(row_data->>'notes',''),
        active           = coalesce(nullif(row_data->>'active','')::boolean, active),
        updated_at       = now()
      where id = (row_data->>'id')::uuid and company_id = v_cid;
    else
      insert into public.gutter_prices(
        company_id, product, category, item_type, thickness, cut_mm, unit, color,
        unit_price, labor_price, paint_price, install_price, freight_price,
        min_price, margin_pct, max_discount_pct, notes, active
      ) values (
        v_cid,
        row_data->>'product',
        v_category,
        coalesce(nullif(row_data->>'item_type',''), public.gutter_catalog_item_type(v_category)),
        nullif(row_data->>'thickness',''),
        v_cut,
        coalesce(nullif(row_data->>'unit',''),'Metro Linear (m)'),
        nullif(row_data->>'color',''),
        coalesce(nullif(row_data->>'unit_price','')::numeric,0),
        coalesce(nullif(row_data->>'labor_price','')::numeric,0),
        coalesce(nullif(row_data->>'paint_price','')::numeric,0),
        coalesce(nullif(row_data->>'install_price','')::numeric,0),
        coalesce(nullif(row_data->>'freight_price','')::numeric,0),
        coalesce(nullif(row_data->>'min_price','')::numeric,0),
        coalesce(nullif(row_data->>'margin_pct','')::numeric,0),
        coalesce(nullif(row_data->>'max_discount_pct','')::numeric,0),
        nullif(row_data->>'notes',''),
        coalesce(nullif(row_data->>'active','')::boolean,true)
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.bulk_save_prices(jsonb) to authenticated;

create or replace function public.create_gutter_quote(p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  c uuid := public.current_company_id();
  st uuid;
  q uuid;
  g uuid;
  item jsonb;
  subtotal_value numeric := 0;
  qty numeric;
  meters_value numeric;
  price_value numeric;
  install_value numeric;
begin
  perform public.require_table_access('quotes','insert');
  if c is null then raise exception 'Usuário sem empresa'; end if;
  if not exists(select 1 from public.clients where id=(p_payload->>'client_id')::uuid and company_id=c) then raise exception 'Cliente inválido'; end if;
  select id into st from public.sale_types where (company_id=c or company_id is null) and name ilike 'Calhas%' and active order by company_id nulls last limit 1;
  if st is null then raise exception 'Cadastre o tipo de venda Calhas instaladas'; end if;
  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then raise exception 'Informe ao menos um item'; end if;

  for item in select * from jsonb_array_elements(p_payload->'items') loop
    qty := coalesce(nullif(item->>'quantity','')::numeric,0);
    meters_value := coalesce(nullif(item->>'meters','')::numeric,0);
    price_value := coalesce(nullif(item->>'unit_price','')::numeric,0);
    install_value := coalesce(nullif(item->>'install_price','')::numeric,0);
    if qty <= 0 or meters_value <= 0 or price_value < 0 or install_value < 0 then raise exception 'Item inválido'; end if;
    subtotal_value := subtotal_value + (qty * meters_value * (price_value + install_value));
  end loop;
  if subtotal_value <= 0 then raise exception 'Total do orçamento deve ser positivo'; end if;

  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,notes,valid_until,installation_deadline)
  values(
    c,
    public.next_number('ORC','public.quotes',c),
    (p_payload->>'client_id')::uuid,
    st,
    auth.uid(),
    subtotal_value,
    coalesce(nullif(p_payload->>'discount','')::numeric,0),
    coalesce(nullif(p_payload->>'freight','')::numeric,0),
    p_payload->>'notes',
    coalesce(nullif(p_payload->>'valid_until','')::date, current_date + coalesce((select default_validity_days from public.companies where id=c),15)),
    nullif(p_payload->>'installation_deadline','')
  ) returning id into q;

  insert into public.gutter_quotes(company_id,quote_id) values(c,q) returning id into g;

  for item in select * from jsonb_array_elements(p_payload->'items') loop
    qty := (item->>'quantity')::numeric;
    meters_value := (item->>'meters')::numeric;
    price_value := coalesce(nullif(item->>'unit_price','')::numeric,0);
    install_value := coalesce(nullif(item->>'install_price','')::numeric,0);

    insert into public.gutter_quote_items(company_id,gutter_quote_id,category,item_type,product,thickness,cut,color,unit,quantity,meters,unit_price,install_price)
    values(
      c,g,
      coalesce(nullif(item->>'category',''), public.gutter_catalog_category(item->>'product')),
      'fabricacao',
      item->>'product',
      item->>'thickness',
      item->>'cut',
      nullif(item->>'color',''),
      'Metro Linear (m)',
      qty,
      meters_value,
      price_value,
      install_value
    );

    insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production,item_type)
    values(
      c,q,item->>'product',
      concat_ws(' | ', nullif(item->>'category',''), nullif(item->>'thickness',''), nullif(item->>'cut',''), nullif(item->>'color','')),
      'm',
      qty * meters_value,
      price_value + install_value,
      true,true,'calha'
    );
  end loop;
  return q;
end;
$$;

revoke all on function public.create_gutter_quote(jsonb) from public;
grant execute on function public.create_gutter_quote(jsonb) to authenticated;

create or replace function public.update_gutter_quote(p_quote_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  c uuid := public.current_company_id();
  q public.quotes;
  gutter_id uuid;
  item jsonb;
  subtotal_value numeric := 0;
  qty numeric;
  meters_value numeric;
  price_value numeric;
  install_value numeric;
begin
  perform public.require_table_access('quotes','update');
  select * into q from public.quotes where id=p_quote_id and company_id=c for update;
  if q.id is null then raise exception 'Orçamento não encontrado'; end if;
  if q.status='aprovado' then raise exception 'Orçamento aprovado não pode ser editado'; end if;
  if not exists(select 1 from public.clients where id=(p_payload->>'client_id')::uuid and company_id=c) then raise exception 'Cliente inválido'; end if;
  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then raise exception 'Informe ao menos um item'; end if;

  for item in select * from jsonb_array_elements(p_payload->'items') loop
    qty := coalesce(nullif(item->>'quantity','')::numeric,0);
    meters_value := coalesce(nullif(item->>'meters','')::numeric,0);
    price_value := coalesce(nullif(item->>'unit_price','')::numeric,0);
    install_value := coalesce(nullif(item->>'install_price','')::numeric,0);
    if qty <= 0 or meters_value <= 0 or price_value < 0 or install_value < 0 then raise exception 'Item inválido'; end if;
    subtotal_value := subtotal_value + (qty * meters_value * (price_value + install_value));
  end loop;
  if subtotal_value <= 0 then raise exception 'Total do orçamento deve ser positivo'; end if;

  select id into gutter_id from public.gutter_quotes where quote_id=q.id;
  if gutter_id is null then raise exception 'Orçamento não é do tipo calhas'; end if;

  delete from public.gutter_quote_items where gutter_quote_id=gutter_id;
  delete from public.quote_items where quote_id=q.id;

  update public.quotes set
    client_id=(p_payload->>'client_id')::uuid,
    subtotal=subtotal_value,
    discount=coalesce(nullif(p_payload->>'discount','')::numeric,0),
    freight=coalesce(nullif(p_payload->>'freight','')::numeric,0),
    notes=p_payload->>'notes',
    valid_until=nullif(p_payload->>'valid_until','')::date,
    installation_deadline=nullif(p_payload->>'installation_deadline',''),
    updated_at=now()
  where id=q.id;

  for item in select * from jsonb_array_elements(p_payload->'items') loop
    qty := (item->>'quantity')::numeric;
    meters_value := (item->>'meters')::numeric;
    price_value := coalesce(nullif(item->>'unit_price','')::numeric,0);
    install_value := coalesce(nullif(item->>'install_price','')::numeric,0);

    insert into public.gutter_quote_items(company_id,gutter_quote_id,category,item_type,product,thickness,cut,color,unit,quantity,meters,unit_price,install_price)
    values(
      c,gutter_id,
      coalesce(nullif(item->>'category',''), public.gutter_catalog_category(item->>'product')),
      'fabricacao',
      item->>'product',
      item->>'thickness',
      item->>'cut',
      nullif(item->>'color',''),
      'Metro Linear (m)',
      qty,
      meters_value,
      price_value,
      install_value
    );

    insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production,item_type)
    values(
      c,q.id,item->>'product',
      concat_ws(' | ', nullif(item->>'category',''), nullif(item->>'thickness',''), nullif(item->>'cut',''), nullif(item->>'color','')),
      'm',
      qty * meters_value,
      price_value + install_value,
      true,true,'calha'
    );
  end loop;
  return q.id;
end;
$$;

revoke all on function public.update_gutter_quote(uuid,jsonb) from public;
grant execute on function public.update_gutter_quote(uuid,jsonb) to authenticated;

create or replace function public.duplicate_quote(p_quote_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  c uuid := public.current_company_id();
  source public.quotes;
  target uuid;
  old_gutter uuid;
  new_gutter uuid;
begin
  perform public.require_table_access('quotes','insert');
  select * into source from public.quotes where id=p_quote_id and company_id=c;
  if source.id is null then raise exception 'Orçamento não encontrado'; end if;

  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,status,valid_until,installation_deadline,notes,seller_name,payment_methods,client_notes)
  values(c,public.next_number('ORC','public.quotes',c),source.client_id,source.sale_type_id,auth.uid(),source.subtotal,source.discount,source.freight,'rascunho',current_date+15,source.installation_deadline,source.notes,source.seller_name,source.payment_methods,source.client_notes)
  returning id into target;

  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production,item_type)
  select c,target,product,description,unit,quantity,unit_price,requires_purchase,requires_production,item_type
  from public.quote_items
  where quote_id=source.id;

  select id into old_gutter from public.gutter_quotes where quote_id=source.id;
  if old_gutter is not null then
    insert into public.gutter_quotes(company_id,quote_id) values(c,target) returning id into new_gutter;
    insert into public.gutter_quote_items(company_id,gutter_quote_id,category,item_type,product,thickness,cut,color,unit,quantity,meters,unit_price,install_price,sort_order)
    select c,new_gutter,category,item_type,product,thickness,cut,color,unit,quantity,meters,unit_price,install_price,sort_order
    from public.gutter_quote_items
    where gutter_quote_id=old_gutter;
  end if;
  return target;
end;
$$;

revoke all on function public.duplicate_quote(uuid) from public;
grant execute on function public.duplicate_quote(uuid) to authenticated;

commit;
