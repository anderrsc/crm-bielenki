begin;

create table if not exists public.aluminum_cost_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  price_per_kg numeric(14,4) not null check(price_per_kg > 0 and price_per_kg < 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
create index if not exists aluminum_cost_settings_updated_by_idx on public.aluminum_cost_settings(updated_by);
alter table public.aluminum_cost_settings enable row level security;
drop policy if exists aluminum_cost_settings_read on public.aluminum_cost_settings;
create policy aluminum_cost_settings_read on public.aluminum_cost_settings for select to authenticated
  using(company_id=(select public.current_company_id()) and ((select public.has_table_access('gutter_prices','select')) or (select public.has_table_access('financial_entries','select'))));
revoke all on public.aluminum_cost_settings from anon,authenticated;
grant select on public.aluminum_cost_settings to authenticated;
grant all on public.aluminum_cost_settings to service_role;

create table if not exists public.order_aluminum_costs (
  order_id uuid primary key references public.orders(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  quote_id uuid not null references public.quotes(id),
  aluminum_kg numeric(18,6) not null check(aluminum_kg>=0),
  price_per_kg numeric(14,4) not null check(price_per_kg>0),
  total_cost numeric(14,2) not null check(total_cost>=0),
  calculation jsonb not null,
  calculated_at timestamptz not null default now()
);
create index if not exists order_aluminum_costs_company_idx on public.order_aluminum_costs(company_id);
create index if not exists order_aluminum_costs_quote_idx on public.order_aluminum_costs(quote_id);
alter table public.order_aluminum_costs enable row level security;
drop policy if exists order_aluminum_costs_read on public.order_aluminum_costs;
create policy order_aluminum_costs_read on public.order_aluminum_costs for select to authenticated
  using(company_id=(select public.current_company_id()) and ((select public.has_table_access('gutter_prices','update')) or (select public.has_table_access('financial_entries','select'))));
revoke all on public.order_aluminum_costs from anon,authenticated;
grant select on public.order_aluminum_costs to authenticated;
grant all on public.order_aluminum_costs to service_role;

-- Valores kg/m informados pela empresa. Cortes não tabelados usam a proporção da bobina de 1.200 mm.
create or replace function crm_private.aluminum_kg_per_meter(p_thickness numeric,p_cut integer)
returns numeric language plpgsql immutable set search_path=pg_catalog as $$
declare weights jsonb; reference numeric;
begin
  if p_cut is null or p_cut<1 or p_cut>1200 then raise exception 'Corte de aluminio invalido: % mm',p_cut; end if;
  case p_thickness
    when 0.5 then weights='{"200":0.271,"250":0.339,"300":0.406,"330":0.448,"400":0.542,"500":0.678,"600":0.813,"700":0.949,"800":1.084,"1000":1.355,"1200":1.626}'; reference=1.626;
    when 0.6 then weights='{"300":0.488,"400":0.650,"500":0.813,"600":0.976,"1000":1.626,"1200":1.951}'; reference=1.951;
    when 0.7 then weights='{"300":0.569,"400":0.759,"500":0.948,"600":1.138,"800":1.518,"1000":1.897,"1200":2.276}'; reference=2.276;
    else raise exception 'Espessura de aluminio sem tabela de peso: % mm',p_thickness;
  end case;
  return coalesce((weights->>p_cut::text)::numeric,round(reference*p_cut/1200,3));
end $$;
revoke all on function crm_private.aluminum_kg_per_meter(numeric,integer) from public,anon,authenticated;

-- Programação linear de padrões de corte: igualdade de demanda, sem contar sobra como peça vendida.
-- A base inicial (um corte por bobina) é sempre viável. Regra de Bland evita ciclos nos pivôs.
create or replace function crm_private.aluminum_1mm_plan(p_demands jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare cuts integer[]; demand double precision[]; patterns jsonb[]; basis integer[];
  tableau double precision[]; n integer; cols integer; stride integer; i integer; j integer; k integer;
  entering integer; leaving integer; iterations integer=0; row_offset integer; pivot double precision;
  factor double precision; ratio double precision; best_ratio double precision; cost double precision;
  counts integer[]; ways integer[]; pattern_count integer=0; count_sum integer; chosen jsonb; plan jsonb='[]'; strips jsonb; used_width integer;
  length_m double precision; kg numeric=0; waste numeric=0; purchased_width numeric=0; needed_width numeric=0;
begin
  if jsonb_typeof(p_demands) is distinct from 'array' then raise exception 'Demanda de cortes invalida'; end if;
  if exists(select 1 from jsonb_to_recordset(p_demands) as d(cut_mm integer,meters numeric) where cut_mm is null or cut_mm<1 or cut_mm>1200 or meters is null or meters<=0 or meters>10000000) then raise exception 'Corte ou metragem de aluminio invalido'; end if;
  select array_agg(cut_mm order by cut_mm),array_agg(meters::double precision order by cut_mm)
    into cuts,demand from (select cut_mm,sum(meters) meters from jsonb_to_recordset(p_demands) as d(cut_mm integer,meters numeric) group by cut_mm) s;
  n=coalesce(array_length(cuts,1),0);
  if n=0 then return jsonb_build_object('kg',0,'waste_kg',0,'utilization_pct',100,'patterns','[]'::jsonb); end if;
  if n>32 then raise exception 'Divida os cortes de 1 mm em no maximo 32 medidas distintas por orcamento'; end if;
  -- Conta os padrões por programação dinâmica antes de enumerar, com memória limitada.
  ways=array_fill(0,array[1201]); ways[1]=1;
  for i in 1..n loop
    for j in cuts[i]..1200 loop ways[j+1]=least(5001,ways[j+1]+ways[j-cuts[i]+1]); end loop;
  end loop;
  for j in 1..1200 loop pattern_count=pattern_count+ways[j+1]*(case when j<=1000 then 2 else 1 end); exit when pattern_count>5000; end loop;
  if pattern_count>5000 then raise exception 'Muitos padroes de corte de 1 mm. Divida o orcamento para calcular o aproveitamento'; end if;
  with recursive candidates(width_mm,idx,remaining,counts) as (
    select w,1,w,array[]::integer[] from unnest(array[1000,1200]) w
    union all
    select c.width_mm,c.idx+1,c.remaining-cuts[c.idx]*s,c.counts||s
    from candidates c cross join lateral generate_series(0,c.remaining/cuts[c.idx]) s where c.idx<=n
  ), limited as (
    select c.width_mm,c.counts from candidates c where c.idx=n+1 and c.remaining<c.width_mm limit 5001
  ) select array_agg(jsonb_build_object('width_mm',l.width_mm,'counts',l.counts,'kg_per_meter',case l.width_mm when 1000 then 2.75 else 3.30 end) order by l.width_mm,l.counts::text)
    into patterns from limited l;
  cols=coalesce(array_length(patterns,1),0);
  if cols>5000 then raise exception 'Muitos padroes de corte de 1 mm. Divida o orcamento para calcular o aproveitamento'; end if;
  stride=cols+1;
  tableau=array_fill(0::double precision,array[(n+1)*stride]);
  basis=array_fill(0,array[n]);
  for j in 1..cols loop
    counts=array(select jsonb_array_elements_text(patterns[j]->'counts')::integer);
    count_sum=0; for i in 1..n loop count_sum=count_sum+counts[i]; end loop;
    cost=(patterns[j]->>'kg_per_meter')::double precision;
    for i in 1..n loop
      tableau[(i-1)*stride+j]=counts[i];
      cost=cost-(case when cuts[i]<=1000 then 2.75 else 3.30 end)*counts[i];
      if counts[i]=1 and count_sum=1 and (patterns[j]->>'width_mm')::integer=(case when cuts[i]<=1000 then 1000 else 1200 end) then basis[i]=j; end if;
    end loop;
    tableau[n*stride+j]=cost;
  end loop;
  for i in 1..n loop
    if basis[i]=0 then raise exception 'Nao foi possivel montar um plano de corte viavel'; end if;
    tableau[(i-1)*stride+stride]=demand[i];
    needed_width=needed_width+cuts[i]*demand[i];
  end loop;
  loop
    entering=0;
    for j in 1..cols loop if tableau[n*stride+j]<-0.000000001 then entering=j; exit; end if; end loop;
    exit when entering=0;
    iterations=iterations+1;
    if iterations>20000 then raise exception 'Limite de calculo do aproveitamento atingido'; end if;
    leaving=0; best_ratio=null;
    for i in 1..n loop
      if tableau[(i-1)*stride+entering]>0.000000001 then
        ratio=greatest(0,tableau[(i-1)*stride+stride])/tableau[(i-1)*stride+entering];
        if leaving=0 or ratio<best_ratio-0.000000001 or (abs(ratio-best_ratio)<=0.000000001 and basis[i]<basis[leaving]) then leaving=i; best_ratio=ratio; end if;
      end if;
    end loop;
    if leaving=0 then raise exception 'Plano de corte sem limite viavel'; end if;
    row_offset=(leaving-1)*stride;
    pivot=tableau[row_offset+entering];
    for j in 1..stride loop tableau[row_offset+j]=tableau[row_offset+j]/pivot; end loop;
    for i in 1..n+1 loop
      if i=leaving then continue; end if;
      factor=tableau[(i-1)*stride+entering];
      if abs(factor)>0.000000000001 then
        for j in 1..stride loop tableau[(i-1)*stride+j]=tableau[(i-1)*stride+j]-factor*tableau[row_offset+j]; end loop;
      end if;
    end loop;
    basis[leaving]=entering;
  end loop;
  for i in 1..n loop
    length_m=greatest(0,tableau[(i-1)*stride+stride]);
    if length_m<0.000000001 then continue; end if;
    chosen=patterns[basis[i]];
    counts=array(select jsonb_array_elements_text(chosen->'counts')::integer);
    strips='[]'; used_width=0;
    for k in 1..n loop if counts[k]>0 then strips=strips||jsonb_build_array(jsonb_build_object('cut_mm',cuts[k],'strips',counts[k])); used_width=used_width+cuts[k]*counts[k]; end if; end loop;
    cost=(chosen->>'kg_per_meter')::double precision*length_m;
    kg=kg+cost;
    waste=waste+cost*((chosen->>'width_mm')::numeric-used_width)/(chosen->>'width_mm')::numeric;
    purchased_width=purchased_width+(chosen->>'width_mm')::numeric*length_m;
    plan=plan||jsonb_build_array(jsonb_build_object('coil_width_mm',(chosen->>'width_mm')::integer,'coil_meters',round(length_m::numeric,6),'cuts',strips,'kg',round(cost::numeric,6),'waste_mm',(chosen->>'width_mm')::integer-used_width));
  end loop;
  return jsonb_build_object('kg',round(kg,6),'waste_kg',round(waste,6),'utilization_pct',round(100*needed_width/nullif(purchased_width,0),2),'patterns',plan);
end $$;
revoke all on function crm_private.aluminum_1mm_plan(jsonb) from public,anon,authenticated;

create or replace function crm_private.calculate_quote_aluminum(p_quote uuid,p_company uuid,p_price numeric)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare item record; thickness numeric; cut_mm integer; meters numeric; per_meter numeric; weight numeric;
  total_kg numeric=0; one_mm jsonb='[]'; lines jsonb='[]'; plan jsonb; excluded integer=0;
  segment jsonb; strip jsonb; line jsonb; allocated jsonb='{}'; completed_lines jsonb='[]'; used_width numeric; cut_meters numeric;
begin
  if p_price is null or p_price<=0 then raise exception 'Configure o preco do kg do aluminio na Central de Precos'; end if;
  if not exists(select 1 from public.gutter_quotes where quote_id=p_quote and company_id=p_company) then return null; end if;
  for item in select i.* from public.gutter_quote_items i join public.gutter_quotes g on g.id=i.gutter_quote_id and g.company_id=i.company_id where g.quote_id=p_quote and i.company_id=p_company order by i.id loop
    if coalesce(item.color,'')~*'(galvaniz|galvalume|inox)' then excluded=excluded+1; continue; end if;
    thickness=nullif(replace(regexp_replace(item.thickness,'[^0-9.,]','','g'),',','.'),'')::numeric;
    cut_mm=nullif(regexp_replace(item.cut,'[^0-9]','','g'),'')::integer;
    meters=item.quantity*item.meters;
    if thickness is null or cut_mm is null or cut_mm<1 or cut_mm>1200 or meters is null or meters<=0 then raise exception 'Revise espessura, corte e metragem de %',item.product; end if;
    if thickness=1 then
      one_mm=one_mm||jsonb_build_array(jsonb_build_object('cut_mm',cut_mm,'meters',meters));
      lines=lines||jsonb_build_array(jsonb_build_object('product',item.product,'thickness_mm',thickness,'cut_mm',cut_mm,'meters',meters,'method','aproveitamento'));
    else
      per_meter=crm_private.aluminum_kg_per_meter(thickness,cut_mm);
      weight=per_meter*meters; total_kg=total_kg+weight;
      lines=lines||jsonb_build_array(jsonb_build_object('product',item.product,'thickness_mm',thickness,'cut_mm',cut_mm,'meters',meters,'kg_per_meter',per_meter,'kg',round(weight,6),'cost',round(weight*p_price,2),'method','peso_por_metro'));
    end if;
  end loop;
  plan=crm_private.aluminum_1mm_plan(one_mm);
  total_kg=total_kg+(plan->>'kg')::numeric;
  -- Distribui a sobra de cada padrão somente entre os cortes realmente produzidos nele.
  for segment in select value from jsonb_array_elements(plan->'patterns') loop
    select sum((value->>'cut_mm')::numeric*(value->>'strips')::numeric) into used_width from jsonb_array_elements(segment->'cuts');
    for strip in select value from jsonb_array_elements(segment->'cuts') loop
      cut_mm=(strip->>'cut_mm')::integer;
      weight=(segment->>'kg')::numeric*cut_mm*(strip->>'strips')::numeric/used_width;
      allocated=jsonb_set(allocated,array[cut_mm::text],to_jsonb(coalesce((allocated->>cut_mm::text)::numeric,0)+weight));
    end loop;
  end loop;
  for line in select value from jsonb_array_elements(lines) loop
    if line->>'method'='aproveitamento' then
      cut_mm=(line->>'cut_mm')::integer;
      select sum((value->>'meters')::numeric) into cut_meters from jsonb_array_elements(one_mm) where (value->>'cut_mm')::integer=cut_mm;
      weight=(allocated->>cut_mm::text)::numeric*(line->>'meters')::numeric/cut_meters;
      line=line||jsonb_build_object('kg_per_meter',round(weight/(line->>'meters')::numeric,6),'kg',round(weight,6),'cost',round(weight*p_price,2));
    end if;
    completed_lines=completed_lines||jsonb_build_array(line);
  end loop;
  return jsonb_build_object('version',1,'kg',round(total_kg,6),'price_per_kg',p_price,'total_cost',round(total_kg*p_price,2),'lines',completed_lines,'one_mm',plan,'excluded_items',excluded);
end $$;
revoke all on function crm_private.calculate_quote_aluminum(uuid,uuid,numeric) from public,anon,authenticated;

create or replace function public.save_aluminum_cost_price(p_price numeric)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid=public.current_company_id(); previous numeric;
begin
  if auth.uid() is null or c is null or not public.has_table_access('gutter_prices','update') then raise exception 'Sem permissao para ajustar o custo do aluminio' using errcode='42501'; end if;
  if p_price is null or p_price<=0 or p_price>=100000 then raise exception 'Informe um valor por kg maior que zero'; end if;
  select price_per_kg into previous from public.aluminum_cost_settings where company_id=c for update;
  insert into public.aluminum_cost_settings(company_id,price_per_kg,updated_by) values(c,round(p_price,4),auth.uid())
    on conflict(company_id) do update set price_per_kg=excluded.price_per_kg,updated_at=now(),updated_by=auth.uid();
  if previous is distinct from round(p_price,4) then
    insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values(c,auth.uid(),'aluminum_cost_settings',c,'UPDATE',jsonb_build_object('price_per_kg',previous),jsonb_build_object('price_per_kg',round(p_price,4)));
  end if;
end $$;
revoke all on function public.save_aluminum_cost_price(numeric) from public,anon;
grant execute on function public.save_aluminum_cost_price(numeric) to authenticated;

create or replace function public.preview_quote_aluminum_cost(p_quote_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid=public.current_company_id(); price numeric;
begin
  if auth.uid() is null or c is null or not (public.has_table_access('financial_entries','select') or public.has_table_access('gutter_prices','update')) then raise exception 'Sem permissao para consultar custos' using errcode='42501'; end if;
  if not exists(select 1 from public.quotes where id=p_quote_id and company_id=c) then raise exception 'Orcamento nao encontrado'; end if;
  select price_per_kg into price from public.aluminum_cost_settings where company_id=c;
  if price is null then return jsonb_build_object('configured',false); end if;
  return crm_private.calculate_quote_aluminum(p_quote_id,c,price)||jsonb_build_object('configured',true);
end $$;
revoke all on function public.preview_quote_aluminum_cost(uuid) from public,anon;
grant execute on function public.preview_quote_aluminum_cost(uuid) to authenticated;

create or replace function crm_private.apply_order_aluminum_cost()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare q uuid; price numeric; result jsonb; inserted uuid;
begin
  if not exists(select 1 from public.orders where id=new.id and company_id=new.company_id) then return null; end if;
  select price_per_kg into price from public.aluminum_cost_settings where company_id=new.company_id;
  if price is null then return null; end if;
  select qt.id into q from public.quotes qt join public.gutter_quotes g on g.quote_id=qt.id and g.company_id=qt.company_id
    where qt.sale_id=new.sale_id and qt.company_id=new.company_id;
  if q is null then return null; end if;
  result=crm_private.calculate_quote_aluminum(q,new.company_id,price);
  insert into public.order_aluminum_costs(order_id,company_id,quote_id,aluminum_kg,price_per_kg,total_cost,calculation)
    values(new.id,new.company_id,q,(result->>'kg')::numeric,price,(result->>'total_cost')::numeric,result)
    on conflict(order_id) do nothing returning order_id into inserted;
  if inserted is not null then
    update public.orders set expected_cost=(result->>'total_cost')::numeric where id=new.id and company_id=new.company_id and expected_cost is null;
    insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,new_data)
      values(new.company_id,auth.uid(),'order_aluminum_costs',new.id,'INSERT',result);
  end if;
  return null;
end $$;
revoke all on function crm_private.apply_order_aluminum_cost() from public,anon,authenticated;
drop trigger if exists orders_apply_aluminum_cost on public.orders;
create constraint trigger orders_apply_aluminum_cost after insert on public.orders deferrable initially deferred for each row execute function crm_private.apply_order_aluminum_cost();

commit;
