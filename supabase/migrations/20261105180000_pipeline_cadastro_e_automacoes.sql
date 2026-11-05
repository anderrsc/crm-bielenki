-- Pipeline: lançar ao cadastrar cliente, tempo na etapa, histórico e motivo de perda.
--
-- * launch_client_pipeline: o cadastro do cliente já cria a oportunidade
--   (Novo lead ou Contato realizado) ou agenda a medição (que entra em
--   Contato realizado e aparece na agenda).
-- * stage_changed_at: quando a oportunidade entrou na etapa atual (mostra
--   "parada há X dias" no pipeline).
-- * Toda mudança de etapa fica registrada nas atividades do cliente.
-- * lost_reason: motivo informado ao marcar como perdida.
-- Pode ser rodada mais de uma vez.

alter table public.leads add column if not exists stage_changed_at timestamptz;
update public.leads set stage_changed_at = coalesce(updated_at, created_at, now()) where stage_changed_at is null;
alter table public.leads alter column stage_changed_at set default now();
alter table public.leads alter column stage_changed_at set not null;
alter table public.leads add column if not exists lost_reason text;

-- p_target: 'novo' (primeira etapa) | 'contato' | 'enviado' | 'ganho' | 'perdido'.
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
  if p_company_id is null or p_client_id is null or p_target not in ('novo','contato','enviado','ganho','perdido') then return null; end if;
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
      and lower(name) = case p_target when 'enviado' then 'orçamento enviado' when 'contato' then 'contato realizado' else '' end
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
            coalesce(nullif(v_client.lead_source,''), case when v_quote.id is not null then 'Orçamento' when p_target = 'contato' then 'Medição' else 'Cadastro de cliente' end),
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

create or replace function public.leads_stage_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_from text; v_to text;
begin
  if tg_op = 'INSERT' then
    new.stage_changed_at := coalesce(new.stage_changed_at, now());
    return new;
  end if;
  if new.stage_id is distinct from old.stage_id then
    new.stage_changed_at := now();
    if not coalesce((select is_lost from public.pipeline_stages where id = new.stage_id), false) then
      new.lost_reason := null;
    end if;
    select name into v_from from public.pipeline_stages where id = old.stage_id;
    select name into v_to from public.pipeline_stages where id = new.stage_id;
    insert into public.activities(company_id, client_id, lead_id, activity_type, subject, description, created_by)
    values (new.company_id, new.client_id, new.id, 'pipeline',
            'Etapa: ' || coalesce(v_from, '—') || ' → ' || coalesce(v_to, '—'),
            nullif(new.lost_reason, ''),
            (select id from public.profiles where id = auth.uid()));
  end if;
  return new;
end $function$;

drop trigger if exists leads_stage_history on public.leads;
create trigger leads_stage_history before insert or update of stage_id on public.leads
  for each row execute function public.leads_stage_history();

-- Cadastro do cliente → pipeline. p_mode: 'novo' | 'contato' | 'medicao' | 'nao'.
create or replace function public.launch_client_pipeline(
  p_client_id uuid,
  p_mode text,
  p_scheduled_at timestamptz default null,
  p_estimated_value numeric default null,
  p_next_action text default null,
  p_next_action_date date default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c uuid := public.current_company_id(); v_lead uuid; v_measurement uuid;
begin
  perform public.require_table_access('clients', 'select');
  if not exists (select 1 from public.clients where id = p_client_id and company_id = c) then
    raise exception 'Cliente não encontrado';
  end if;
  if coalesce(p_mode, 'nao') = 'nao' then return null; end if;
  if p_mode not in ('novo','contato','medicao') then raise exception 'Opção de pipeline inválida'; end if;
  if p_estimated_value is not null and p_estimated_value < 0 then raise exception 'Valor estimado inválido'; end if;

  if p_mode = 'medicao' then
    v_measurement := public.create_measurement_from_client(p_client_id, p_scheduled_at);
    select lead_id into v_lead from public.measurements where id = v_measurement;
    if v_lead is null then
      v_lead := public.sync_client_opportunity(c, p_client_id, null, 'contato');
      update public.measurements set lead_id = v_lead where id = v_measurement and lead_id is null;
    end if;
  else
    v_lead := public.sync_client_opportunity(c, p_client_id, null, p_mode);
  end if;
  if v_lead is null then return null; end if;

  update public.leads set
    estimated_value = coalesce(p_estimated_value, estimated_value),
    next_action = coalesce(nullif(trim(p_next_action), ''),
      case when p_mode = 'medicao' then 'Medição agendada' end, next_action),
    next_action_date = coalesce(p_next_action_date,
      case when p_mode = 'medicao' then (p_scheduled_at at time zone 'America/Sao_Paulo')::date end, next_action_date)
  where id = v_lead;
  return v_lead;
end $function$;

revoke all on function public.launch_client_pipeline(uuid, text, timestamptz, numeric, text, date) from public, anon;
grant execute on function public.launch_client_pipeline(uuid, text, timestamptz, numeric, text, date) to authenticated, service_role;
