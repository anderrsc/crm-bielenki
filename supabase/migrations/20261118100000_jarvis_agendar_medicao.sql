-- JARVIS: buscar cliente e agendar medição na agenda, pelo usuário do JARVIS (nunca service_role).
-- Idempotente pelo pedido do JARVIS (external_ref), com auditoria. As permissões são as do usuário logado.

alter table public.operational_events add column if not exists external_ref text;
create unique index if not exists operational_events_external_ref_uidx
  on public.operational_events(company_id, external_ref) where external_ref is not null;

create or replace function public.jarvis_find_clients(p_query text)
returns table(id uuid, name text, phone text, address text, neighborhood text, city text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  q text := btrim(coalesce(p_query, ''));
  d text := regexp_replace(q, '\D', '', 'g');
begin
  if v_company is null then raise exception 'Empresa não encontrada' using errcode = '42501'; end if;
  if not public.has_table_access('clients', 'select') then raise exception 'Sem permissão para consultar clientes' using errcode = '42501'; end if;
  if length(q) < 2 or length(q) > 120 then raise exception 'Informe de 2 a 120 caracteres para buscar' using errcode = 'P0001'; end if;
  return query
    select c.id, c.name, coalesce(c.whatsapp, c.phone), c.address, c.neighborhood, c.city
    from public.clients c
    where c.company_id = v_company and c.status = 'ativo'
      and (c.name ilike '%' || replace(replace(q, '%', ''), '_', '') || '%'
           or (length(d) >= 4 and regexp_replace(coalesce(c.whatsapp, '') || ' ' || coalesce(c.phone, ''), '\D', '', 'g') like '%' || d || '%'))
    order by (lower(c.name) = lower(q)) desc, (c.name ilike q || '%') desc, c.name
    limit 5;
end $$;
revoke all on function public.jarvis_find_clients(text) from public, anon;
grant execute on function public.jarvis_find_clients(text) to authenticated;

create or replace function public.jarvis_schedule_measurement(p_request_id text, p_client_id uuid, p_starts_at timestamptz, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_user uuid := auth.uid();
  c public.clients;
  ev public.operational_events;
  v_addr text;
begin
  if v_company is null or v_user is null then raise exception 'Empresa não encontrada' using errcode = '42501'; end if;
  if not public.has_table_access('operational_events', 'insert') then raise exception 'Sem permissão para agendar' using errcode = '42501'; end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'Pedido inválido' using errcode = 'P0001'; end if;

  select * into ev from public.operational_events where company_id = v_company and external_ref = p_request_id;
  if found then
    return jsonb_build_object('id', ev.id, 'client_id', ev.client_id, 'client_name', ev.client_name, 'starts_at', ev.starts_at, 'ja_existia', true);
  end if;

  select * into c from public.clients where id = p_client_id and company_id = v_company;
  if not found then raise exception 'Cliente não encontrado' using errcode = 'P0001'; end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 hour' or p_starts_at > now() + interval '1 year' then
    raise exception 'Data da medição inválida' using errcode = 'P0001';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then raise exception 'Observação longa demais' using errcode = 'P0001'; end if;

  v_addr := nullif(concat_ws(', ', nullif(btrim(c.address), ''), nullif(btrim(c.neighborhood), ''), nullif(btrim(c.city), '')), '');
  insert into public.operational_events(company_id, event_type, title, client_id, client_name, starts_at, address, phone, status, notes, created_by, external_ref)
  values (v_company, 'medicao', 'Medição - ' || c.name, c.id, c.name, p_starts_at, v_addr, coalesce(c.whatsapp, c.phone), 'agendado',
          concat_ws(' | ', 'Agendado pelo JARVIS', nullif(btrim(coalesce(p_notes, '')), '')), v_user, p_request_id)
  returning * into ev;

  insert into public.audit_logs(company_id, profile_id, table_name, record_id, action, new_data)
  values (v_company, v_user, 'operational_events', ev.id, 'jarvis_agendar_medicao',
          jsonb_build_object('cliente', c.name, 'quando', ev.starts_at, 'pedido', p_request_id));

  return jsonb_build_object('id', ev.id, 'client_id', c.id, 'client_name', c.name, 'starts_at', ev.starts_at, 'ja_existia', false);
end $$;
revoke all on function public.jarvis_schedule_measurement(text, uuid, timestamptz, text) from public, anon;
grant execute on function public.jarvis_schedule_measurement(text, uuid, timestamptz, text) to authenticated;
