-- Pipeline automático a partir de orçamentos e fichas de medição.
--
-- * Orçamento criado: o cliente entra no pipeline em "Contato realizado".
-- * Orçamento marcado como enviado: a oportunidade vai para "Orçamento enviado".
-- * Orçamento aprovado: a oportunidade vai para a etapa de ganho.
-- * Orçamento recusado: a oportunidade ligada a ele vai para a etapa de perda.
-- * Medição registrada ou ficha de visita emitida: o cliente entra no
--   pipeline em "Contato realizado".
--
-- Sem duplicar: cada cliente tem no máximo uma oportunidade aberta. Uma
-- oportunidade existente só avança de etapa (nunca volta), e o valor estimado
-- passa a ser o total do último orçamento. Uma falha aqui nunca impede salvar
-- o orçamento ou a medição. Pode ser rodada mais de uma vez.

alter table public.leads add column if not exists quote_id uuid references public.quotes(id) on delete set null;
create index if not exists leads_quote_id_idx on public.leads(quote_id);
create index if not exists leads_company_client_open_idx on public.leads(company_id, client_id) where deleted_at is null;

-- p_target: 'contato' | 'enviado' | 'ganho' | 'perdido'. Uso interno (triggers e RPCs).
create or replace function public.sync_client_opportunity(p_company_id uuid, p_client_id uuid, p_quote_id uuid, p_target text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client public.clients;
  v_stage public.pipeline_stages;
  v_lead public.leads;
  v_quote public.quotes;
  v_current_order integer;
  v_move boolean;
  v_owner uuid;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_company_id is null or p_client_id is null or p_target not in ('contato','enviado','ganho','perdido') then return null; end if;
  select * into v_client from public.clients where id = p_client_id and company_id = p_company_id;
  if v_client.id is null then return null; end if;
  if p_quote_id is not null then
    select * into v_quote from public.quotes where id = p_quote_id and company_id = p_company_id;
  end if;

  if p_target = 'ganho' then
    select * into v_stage from public.pipeline_stages where company_id = p_company_id and coalesce(is_won,false) order by sort_order limit 1;
  elsif p_target = 'perdido' then
    select * into v_stage from public.pipeline_stages where company_id = p_company_id and coalesce(is_lost,false) order by sort_order limit 1;
  else
    select * into v_stage from public.pipeline_stages
    where company_id = p_company_id and not coalesce(is_won,false) and not coalesce(is_lost,false)
      and lower(name) = case p_target when 'enviado' then 'orçamento enviado' else 'contato realizado' end
    order by sort_order limit 1;
    if v_stage.id is null and p_target = 'enviado' then
      select * into v_stage from public.pipeline_stages
      where company_id = p_company_id and not coalesce(is_won,false) and not coalesce(is_lost,false)
        and (name ilike '%orçamento%' or name ilike '%orcamento%' or name ilike '%proposta%')
      order by sort_order limit 1;
    end if;
    if v_stage.id is null then
      select * into v_stage from public.pipeline_stages
      where company_id = p_company_id and not coalesce(is_won,false) and not coalesce(is_lost,false)
      order by sort_order limit 1;
    end if;
  end if;
  if v_stage.id is null then return null; end if;

  -- 1) oportunidade já ligada a este orçamento; 2) oportunidade aberta do cliente.
  if v_quote.id is not null then
    select * into v_lead from public.leads
    where company_id = p_company_id and quote_id = v_quote.id and deleted_at is null
    order by created_at desc limit 1;
  end if;
  if v_lead.id is null then
    select * into v_lead from public.leads
    where company_id = p_company_id and client_id = p_client_id and status = 'aberto' and deleted_at is null
    order by created_at desc limit 1;
  end if;

  if v_lead.id is null then
    -- Perda só se aplica a uma oportunidade que já existe.
    if p_target = 'perdido' then return null; end if;
    select id into v_owner from public.profiles where id = coalesce(v_quote.seller_id, auth.uid()) and company_id = p_company_id;
    insert into public.leads(company_id, client_id, quote_id, name, phone, email, source, lead_source_id, stage_id, owner_id,
                             estimated_value, next_action, next_action_date, status, notes)
    values (p_company_id, v_client.id, v_quote.id, v_client.name, coalesce(nullif(v_client.whatsapp,''), v_client.phone), v_client.email,
            coalesce(nullif(v_client.lead_source,''), case when v_quote.id is null then 'Medição' else 'Orçamento' end),
            v_client.lead_source_id, v_stage.id, v_owner, coalesce(v_quote.total, 0),
            case when p_target = 'enviado' then 'Follow-up do orçamento ' || v_quote.quote_number end,
            case when p_target = 'enviado' then v_today + 2 end,
            case when coalesce(v_stage.is_won,false) then 'ganho' else 'aberto' end,
            'Criada automaticamente')
    returning * into v_lead;
    return v_lead.id;
  end if;

  if p_target = 'perdido' and v_lead.quote_id is distinct from v_quote.id then return v_lead.id; end if;

  select sort_order into v_current_order from public.pipeline_stages where id = v_lead.stage_id;
  v_move := v_lead.stage_id is distinct from v_stage.id and (
    p_target in ('ganho','perdido')
    or v_lead.status <> 'aberto'                       -- reaberta (ex.: aprovação revertida)
    or v_current_order is null
    or v_current_order < v_stage.sort_order);

  update public.leads set
    client_id = coalesce(client_id, v_client.id),
    quote_id = coalesce(v_quote.id, quote_id),
    estimated_value = coalesce(v_quote.total, estimated_value),
    stage_id = case when v_move then v_stage.id else stage_id end,
    status = case when v_move then case when coalesce(v_stage.is_won,false) then 'ganho' when coalesce(v_stage.is_lost,false) then 'perdido' else 'aberto' end else status end,
    next_action = case when v_move and p_target = 'enviado' then 'Follow-up do orçamento ' || v_quote.quote_number else next_action end,
    next_action_date = case when v_move and p_target = 'enviado' then v_today + 2 else next_action_date end
  where id = v_lead.id;
  return v_lead.id;
end $function$;

revoke all on function public.sync_client_opportunity(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sync_client_opportunity(uuid, uuid, uuid, text) to service_role;

-- Orçamentos: criação, mudança de status e de valor.
create or replace function public.quote_pipeline_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_target text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.client_id is not distinct from old.client_id
     and new.total is not distinct from old.total then
    return new;
  end if;
  v_target := case new.status
    when 'rascunho' then 'contato'
    when 'pendente' then 'contato'
    when 'enviado' then 'enviado'
    when 'aprovado' then 'ganho'
    when 'recusado' then 'perdido'
    else null end;
  if v_target is null then return new; end if;
  begin
    perform public.sync_client_opportunity(new.company_id, new.client_id, new.id, v_target);
  exception when others then
    raise warning 'Pipeline automático falhou para o orçamento %: %', new.id, sqlerrm;
  end;
  return new;
end $function$;

drop trigger if exists quotes_pipeline_sync on public.quotes;
create trigger quotes_pipeline_sync after insert or update of status, client_id, subtotal, discount, freight on public.quotes
  for each row execute function public.quote_pipeline_sync();

-- Medições: o cliente entra no pipeline e a medição fica ligada à oportunidade.
create or replace function public.measurement_pipeline_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_lead uuid;
begin
  if new.client_id is null then return new; end if;
  begin
    v_lead := public.sync_client_opportunity(new.company_id, new.client_id, null, 'contato');
    if v_lead is not null and new.lead_id is null then
      update public.measurements set lead_id = v_lead where id = new.id and lead_id is null;
    end if;
  exception when others then
    raise warning 'Pipeline automático falhou para a medição %: %', new.id, sqlerrm;
  end;
  return new;
end $function$;

drop trigger if exists measurements_pipeline_sync on public.measurements;
create trigger measurements_pipeline_sync after insert on public.measurements
  for each row execute function public.measurement_pipeline_sync();

-- Ficha de visita emitida para um cliente.
create or replace function public.ensure_client_opportunity(p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c uuid := public.current_company_id();
begin
  perform public.require_table_access('clients', 'select');
  if not exists (select 1 from public.clients where id = p_client_id and company_id = c) then
    raise exception 'Cliente não encontrado';
  end if;
  return public.sync_client_opportunity(c, p_client_id, null, 'contato');
end $function$;

revoke all on function public.ensure_client_opportunity(uuid) from public, anon;
grant execute on function public.ensure_client_opportunity(uuid) to authenticated, service_role;

-- Botão "Marcar como enviado".
create or replace function public.mark_quote_sent(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare q public.quotes;
begin
  perform public.require_table_access('quotes', 'update');
  select * into q from public.quotes where id = p_quote_id and company_id = public.current_company_id() for update;
  if q.id is null then raise exception 'Orçamento não encontrado'; end if;
  if q.status = 'enviado' then return; end if;
  if q.status not in ('rascunho','pendente') then
    raise exception 'Só orçamentos em rascunho podem ser marcados como enviados';
  end if;
  update public.quotes set status = 'enviado' where id = q.id;
end $function$;

revoke all on function public.mark_quote_sent(uuid) from public, anon;
grant execute on function public.mark_quote_sent(uuid) to authenticated, service_role;

-- Orçamentos em aberto que já existem entram no pipeline uma única vez.
do $$
declare q record;
begin
  for q in select id, company_id, client_id, status from public.quotes
           where status in ('rascunho','pendente','enviado') and client_id is not null
             and not exists (select 1 from public.leads l where l.quote_id = quotes.id)
           order by created_at
  loop
    perform public.sync_client_opportunity(q.company_id, q.client_id, q.id,
      case q.status when 'enviado' then 'enviado' else 'contato' end);
  end loop;
end $$;
