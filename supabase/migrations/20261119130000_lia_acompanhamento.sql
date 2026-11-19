-- Lia: acompanhamento comercial automático (24 h sem resposta, até 3 tentativas).
-- DESLIGADO por padrão em todas as empresas; o dono liga na Central de IA quando quiser.
-- Aditiva: nenhum dado existente é alterado.

alter table public.ai_agent_config
  add column if not exists lia_followups_enabled boolean not null default false,
  add column if not exists lia_followups_daily_limit integer not null default 15 check (lia_followups_daily_limit between 1 and 100);

-- Cliente pediu para não receber mensagens (ou desistiu): nenhuma automação escreve para ele.
alter table public.conversations add column if not exists ai_opt_out boolean not null default false;

-- Cada envio automático fica registrado uma única vez (event_key único): nada duplica, e uma
-- tentativa que falhou não é repetida em laço.
create table if not exists public.lia_automation_executions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  kind text not null check (kind in ('followup')),
  attempt integer not null default 1,
  event_key text not null,
  status text not null default 'enviando' check (status in ('enviando','enviada','falhou')),
  detail text,
  created_at timestamptz not null default now(),
  unique (company_id, event_key)
);
create index if not exists lia_automation_executions_conv on public.lia_automation_executions(conversation_id, created_at desc);
create index if not exists lia_automation_executions_day on public.lia_automation_executions(company_id, kind, created_at desc);
alter table public.lia_automation_executions enable row level security;
revoke all on public.lia_automation_executions from public, anon, authenticated;
grant select on public.lia_automation_executions to authenticated;
drop policy if exists lia_automation_executions_select on public.lia_automation_executions;
create policy lia_automation_executions_select on public.lia_automation_executions for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_role(array['administrador','gerente']::public.app_role[])));

-- Conversas candidatas: lead (ainda não é cliente) que já falou com a gente, atendido pela Lia
-- (ninguém da equipe assumiu), cuja última mensagem foi nossa. O horário, o espaçamento e o limite
-- diário são decididos no código (testado em lia-rules).
create or replace function public.lia_followup_candidates(p_company uuid, p_now timestamptz default now())
returns table(conversation_id uuid, channel_id uuid, phone text, contact_name text, last_inbound_at timestamptz,
              last_outbound_at timestamptz, opted_out boolean, attempts integer, last_attempt_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select c.id, c.channel_id, c.phone, c.contact_name, c.last_inbound_at, c.last_message_at, c.ai_opt_out,
    (select count(*)::int from public.lia_automation_executions e where e.conversation_id = c.id and e.kind = 'followup' and e.status = 'enviada' and e.created_at > c.last_inbound_at),
    (select max(e.created_at) from public.lia_automation_executions e where e.conversation_id = c.id and e.kind = 'followup' and e.status = 'enviada' and e.created_at > c.last_inbound_at)
  from public.conversations c
  where c.company_id = p_company and c.channel = 'whatsapp'
    and c.ai_paused = false and c.client_id is null and c.archived_at is null and c.status <> 'resolvida'
    and c.last_inbound_at is not null and c.last_inbound_at > p_now - interval '14 days'
    and c.last_message_at is not null and c.last_message_at > c.last_inbound_at + interval '2 seconds'
    and (c.channel_id is null or exists(select 1 from public.whatsapp_channels w where w.id = c.channel_id and w.is_default))
  order by c.last_message_at
  limit 50;
$$;
revoke all on function public.lia_followup_candidates(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.lia_followup_candidates(uuid, timestamptz) to service_role;
