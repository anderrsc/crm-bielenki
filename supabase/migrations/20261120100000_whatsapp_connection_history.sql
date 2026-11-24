-- Histórico de eventos de conexão do WhatsApp para diagnóstico e monitoramento.
-- Resolve B2 (eventos connection.update não eram gravados) e R05 (falta de testes/observabilidade real).
create table if not exists public.whatsapp_connection_history (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id),
  channel_id uuid references public.whatsapp_channels(id) on delete set null,
  provider text not null default 'evolution',
  event_type text not null, -- open, close, connecting, qr, timeout, error, etc.
  status text,              -- estado reportado pelo provedor
  error_message text,       -- detalhes de erro se houver
  metadata jsonb,           -- dados adicionais do evento (reason, uptime, etc.)
  created_at timestamptz not null default now()
);

-- Índices para consultas frequentes de diagnóstico
create index if not exists whatsapp_conn_hist_company_created_idx
  on public.whatsapp_connection_history(company_id, created_at desc);
create index if not exists whatsapp_conn_hist_channel_created_idx
  on public.whatsapp_connection_history(channel_id, created_at desc)
  where channel_id is not null;

-- RLS: isolamento por empresa
alter table public.whatsapp_connection_history enable row level security;
drop policy if exists whatsapp_conn_hist_select on public.whatsapp_connection_history;

drop policy if exists whatsapp_conn_hist_select on public.whatsapp_connection_history;
create policy whatsapp_conn_hist_select on public.whatsapp_connection_history
  for select using (company_id = public.current_company_id());
drop policy if exists whatsapp_conn_hist_insert on public.whatsapp_connection_history;

drop policy if exists whatsapp_conn_hist_insert on public.whatsapp_connection_history;
create policy whatsapp_conn_hist_insert on public.whatsapp_connection_history
  for insert with check (company_id = public.current_company_id());

-- Função para registrar eventos de conexão de forma segura
create or replace function public.record_whatsapp_connection_event(
  p_company_id uuid,
  p_channel_id uuid,
  p_provider text,
  p_event_type text,
  p_status text default null,
  p_error_message text default null,
  p_metadata jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into whatsapp_connection_history (
    company_id, channel_id, provider, event_type, status, error_message, metadata
  ) values (
    p_company_id, p_channel_id, coalesce(p_provider, 'evolution'),
    p_event_type, p_status, p_error_message, p_metadata
  );
end;
$$;

-- Grant para service_role (usado pela rotina de operações)
grant execute on function public.record_whatsapp_connection_event(uuid,uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.record_whatsapp_connection_event(uuid,uuid,text,text,text,text,jsonb) to authenticated;

-- View consolidada para dashboard de saúde do WhatsApp
create or replace view public.v_whatsapp_health_summary with (security_invoker=true) as
select
  wc.id as channel_id,
  wc.company_id,
  wc.name as channel_name,
  wc.status as current_status,
  wc.last_event_at,
  wc.last_message_event_at,
  wc.last_restart_at,
  wc.restart_count,
  -- Último evento de conexão registrado
  (select wch.event_type from whatsapp_connection_history wch
   where wch.channel_id = wc.id order by wch.created_at desc limit 1) as last_connection_event,
  (select wch.created_at from whatsapp_connection_history wch
   where wch.channel_id = wc.id order by wch.created_at desc limit 1) as last_connection_event_at,
  -- Contagem de eventos nas últimas 24h
  (select count(*) from whatsapp_connection_history wch
   where wch.channel_id = wc.id and wch.created_at > now() - interval '24 hours') as events_last_24h,
  -- Contagem de erros nas últimas 24h
  (select count(*) from whatsapp_connection_history wch
   where wch.channel_id = wc.id and wch.error_message is not null
   and wch.created_at > now() - interval '24 hours') as errors_last_24h
from whatsapp_channels wc
where wc.active = true and wc.deleted_at is null;