-- Migration 037 - Ajustes finais de orcamento, impressao e itens complementares

begin;

alter table public.quotes
  add column if not exists hide_unit_prices boolean not null default false;

alter table public.quote_items
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.quotes.hide_unit_prices is 'Quando true, oculta a coluna de valor unitario no orcamento impresso/PDF.';
comment on column public.quote_items.metadata is 'Dados tecnicos opcionais do item complementar/especial para impressao e auditoria.';

create or replace function public.create_gutter_quote(p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  c uuid := public.current_company_id();
  st uuid;
  q uuid;
  g uuid;
  subtotal_value numeric := 0;
begin
  perform public.require_table_access('quotes','insert');
  if c is null then raise exception 'Usuario sem empresa'; end if;
  if not exists(select 1 from public.clients where id=(p_payload->>'client_id')::uuid and company_id=c) then raise exception 'Cliente invalido'; end if;

  select id into st
  from public.sale_types
  where (company_id=c or company_id is null) and name ilike 'Calhas%' and active
  order by company_id nulls last
  limit 1;
  if st is null then raise exception 'Cadastre o tipo de venda Calhas instaladas'; end if;

  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0
     and jsonb_array_length(coalesce(p_payload->'special_items','[]'::jsonb))=0 then
    raise exception 'Informe ao menos um item';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item
    where coalesce(nullif(item->>'quantity','')::numeric,0) <= 0
       or coalesce(nullif(item->>'meters','')::numeric,0) <= 0
       or coalesce(nullif(item->>'unit_price','')::numeric,0) < 0
       or coalesce(nullif(item->>'install_price','')::numeric,0) < 0
  ) then
    raise exception 'Item invalido';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'special_items','[]'::jsonb)) item
    where coalesce(nullif(item->>'quantity','')::numeric,0) <= 0
       or coalesce(nullif(item->>'unit_price','')::numeric,0) < 0
  ) then
    raise exception 'Item complementar invalido';
  end if;

  select
    coalesce((
      select sum(
        coalesce(nullif(item->>'quantity','')::numeric,0)
        * coalesce(nullif(item->>'meters','')::numeric,0)
        * (
          coalesce(nullif(item->>'unit_price','')::numeric,0)
          + coalesce(nullif(item->>'install_price','')::numeric,0)
        )
      )
      from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item
    ),0)
    +
    coalesce((
      select sum(
        coalesce(nullif(item->>'quantity','')::numeric,0)
        * coalesce(nullif(item->>'unit_price','')::numeric,0)
      )
      from jsonb_array_elements(coalesce(p_payload->'special_items','[]'::jsonb)) item
    ),0)
  into subtotal_value;

  if subtotal_value <= 0 then raise exception 'Total do orcamento deve ser positivo'; end if;

  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,notes,valid_until,installation_deadline,hide_unit_prices)
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
    nullif(p_payload->>'installation_deadline',''),
    coalesce(nullif(p_payload->>'hide_unit_prices','')::boolean,false)
  ) returning id into q;

  insert into public.gutter_quotes(company_id,quote_id) values(c,q) returning id into g;

  insert into public.gutter_quote_items(company_id,gutter_quote_id,category,item_type,product,thickness,cut,color,unit,quantity,meters,unit_price,install_price)
  select
    c,
    g,
    coalesce(nullif(item->>'category',''), public.gutter_catalog_category(item->>'product')),
    'fabricacao',
    item->>'product',
    item->>'thickness',
    item->>'cut',
    nullif(item->>'color',''),
    'Metro Linear (m)',
    (item->>'quantity')::numeric,
    (item->>'meters')::numeric,
    coalesce(nullif(item->>'unit_price','')::numeric,0),
    coalesce(nullif(item->>'install_price','')::numeric,0)
  from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item;

  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production,item_type)
  select
    c,
    q,
    item->>'product',
    concat_ws(' | ', nullif(item->>'category',''), nullif(item->>'thickness',''), nullif(item->>'cut',''), nullif(item->>'color','')),
    'm',
    (item->>'quantity')::numeric * (item->>'meters')::numeric,
    coalesce(nullif(item->>'unit_price','')::numeric,0) + coalesce(nullif(item->>'install_price','')::numeric,0),
    true,
    true,
    'calha'
  from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item;

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
  subtotal_value numeric := 0;
begin
  perform public.require_table_access('quotes','update');
  select * into q from public.quotes where id=p_quote_id and company_id=c for update;
  if q.id is null then raise exception 'Orcamento nao encontrado'; end if;
  if q.status='aprovado' then raise exception 'Orcamento aprovado nao pode ser editado'; end if;
  if not exists(select 1 from public.clients where id=(p_payload->>'client_id')::uuid and company_id=c) then raise exception 'Cliente invalido'; end if;

  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0
     and jsonb_array_length(coalesce(p_payload->'special_items','[]'::jsonb))=0 then
    raise exception 'Informe ao menos um item';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item
    where coalesce(nullif(item->>'quantity','')::numeric,0) <= 0
       or coalesce(nullif(item->>'meters','')::numeric,0) <= 0
       or coalesce(nullif(item->>'unit_price','')::numeric,0) < 0
       or coalesce(nullif(item->>'install_price','')::numeric,0) < 0
  ) then
    raise exception 'Item invalido';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'special_items','[]'::jsonb)) item
    where coalesce(nullif(item->>'quantity','')::numeric,0) <= 0
       or coalesce(nullif(item->>'unit_price','')::numeric,0) < 0
  ) then
    raise exception 'Item complementar invalido';
  end if;

  select
    coalesce((
      select sum(
        coalesce(nullif(item->>'quantity','')::numeric,0)
        * coalesce(nullif(item->>'meters','')::numeric,0)
        * (
          coalesce(nullif(item->>'unit_price','')::numeric,0)
          + coalesce(nullif(item->>'install_price','')::numeric,0)
        )
      )
      from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item
    ),0)
    +
    coalesce((
      select sum(
        coalesce(nullif(item->>'quantity','')::numeric,0)
        * coalesce(nullif(item->>'unit_price','')::numeric,0)
      )
      from jsonb_array_elements(coalesce(p_payload->'special_items','[]'::jsonb)) item
    ),0)
  into subtotal_value;

  if subtotal_value <= 0 then raise exception 'Total do orcamento deve ser positivo'; end if;

  select id into gutter_id from public.gutter_quotes where quote_id=q.id;
  if gutter_id is null then
    insert into public.gutter_quotes(company_id,quote_id) values(c,q.id) returning id into gutter_id;
  end if;

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
    hide_unit_prices=coalesce(nullif(p_payload->>'hide_unit_prices','')::boolean,false),
    updated_at=now()
  where id=q.id;

  insert into public.gutter_quote_items(company_id,gutter_quote_id,category,item_type,product,thickness,cut,color,unit,quantity,meters,unit_price,install_price)
  select
    c,
    gutter_id,
    coalesce(nullif(item->>'category',''), public.gutter_catalog_category(item->>'product')),
    'fabricacao',
    item->>'product',
    item->>'thickness',
    item->>'cut',
    nullif(item->>'color',''),
    'Metro Linear (m)',
    (item->>'quantity')::numeric,
    (item->>'meters')::numeric,
    coalesce(nullif(item->>'unit_price','')::numeric,0),
    coalesce(nullif(item->>'install_price','')::numeric,0)
  from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item;

  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production,item_type)
  select
    c,
    q.id,
    item->>'product',
    concat_ws(' | ', nullif(item->>'category',''), nullif(item->>'thickness',''), nullif(item->>'cut',''), nullif(item->>'color','')),
    'm',
    (item->>'quantity')::numeric * (item->>'meters')::numeric,
    coalesce(nullif(item->>'unit_price','')::numeric,0) + coalesce(nullif(item->>'install_price','')::numeric,0),
    true,
    true,
    'calha'
  from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item;

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
  if source.id is null then raise exception 'Orcamento nao encontrado'; end if;

  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,status,valid_until,installation_deadline,notes,seller_name,payment_methods,client_notes,hide_unit_prices)
  values(c,public.next_number('ORC','public.quotes',c),source.client_id,source.sale_type_id,auth.uid(),source.subtotal,source.discount,source.freight,'rascunho',current_date+15,source.installation_deadline,source.notes,source.seller_name,source.payment_methods,source.client_notes,source.hide_unit_prices)
  returning id into target;

  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production,item_type,metadata)
  select c,target,product,description,unit,quantity,unit_price,requires_purchase,requires_production,item_type,coalesce(metadata,'{}'::jsonb)
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
