-- One transaction: a failed complementary item rolls back the whole quote.
-- Keep the existing permission, company and approved-quote checks in the base RPCs.
create or replace function public.save_gutter_quote_complete(p_payload jsonb, p_quote_id uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  c uuid := public.current_company_id();
  quote_id uuid;
  payload jsonb := p_payload;
begin
  if auth.uid() is null or c is null then raise exception 'Sessão expirada'; end if;
  if p_quote_id is null then
    quote_id := public.create_gutter_quote(payload);
  else
    if nullif(payload->>'valid_until','') is null then
      payload := payload || jsonb_build_object('valid_until', (
        select q.valid_until from public.quotes q where q.id=p_quote_id and q.company_id=c
      ));
    end if;
    quote_id := public.update_gutter_quote(p_quote_id, payload);
  end if;

  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,item_type)
  select c, quote_id, item->>'product',
    nullif(concat_ws(' | ', nullif(item->>'item_type',''), nullif(item->>'description','')), ''),
    coalesce(nullif(item->>'unit',''),'unidade'),
    (item->>'quantity')::numeric, (item->>'unit_price')::numeric,
    case when item->>'item_type'='Serviços' then 'servico'
      when item->>'item_type' in ('Acessórios','Itens Especiais') then 'item_especial'
      when item->>'item_type'='Condutores' then 'condutor' else 'fabricacao' end
  from jsonb_array_elements(coalesce(payload->'special_items','[]'::jsonb)) item;

  update public.quotes q set
    hide_travel_price=coalesce((payload->>'hide_travel_price')::boolean,true),
    seller_name=case when p_quote_id is null then coalesce((
      select nullif(split_part(trim(p.full_name),' ',1),'') from public.profiles p where p.id=auth.uid()
    ),q.seller_name) else q.seller_name end
  where q.id=quote_id and q.company_id=c;
  return quote_id;
end;
$$;
revoke all on function public.save_gutter_quote_complete(jsonb,uuid) from public,anon;
grant execute on function public.save_gutter_quote_complete(jsonb,uuid) to authenticated;

-- Return only the two non-user entries needed to identify the last AI failure.
-- Large conversation histories stay in Postgres and never travel to this page.
create or replace function public.central_triage_activity(p_company_id uuid, p_since timestamptz)
returns table(id uuid,nome text,phone text,status text,produto text,tipo_servico text,prioridade text,updated_at timestamptz,messages jsonb)
language sql stable security invoker set search_path = '' as $$
  select s.id,s.nome,s.phone,s.status::text,s.produto,s.tipo_servico,s.prioridade::text,s.updated_at,
    coalesce((select jsonb_agg(recent.entry order by recent.position) from (
      select distinct on (entry->>'role'='assistant') entry,position from jsonb_array_elements(case when jsonb_typeof(s.messages)='array' then s.messages else '[]'::jsonb end)
        with ordinality as entries(entry,position)
      where entry->>'role' is distinct from 'user'
      order by (entry->>'role'='assistant'),position desc
    ) recent),'[]'::jsonb)
  from public.triage_sessions s
  where auth.uid() is not null and s.company_id=p_company_id
    and p_company_id=public.current_company_id() and s.updated_at>=p_since
  order by s.updated_at desc,s.id limit 200;
$$;
revoke all on function public.central_triage_activity(uuid,timestamptz) from public,anon;
grant execute on function public.central_triage_activity(uuid,timestamptz) to authenticated;
