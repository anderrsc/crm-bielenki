-- Modos da Lia (assistente, semiautomática, automática supervisionada), horário,
-- limite diário, sugestões para a equipe aprovar e registro de cada decisão.
-- Padrões mantêm o comportamento atual: automática, sem horário, limite alto.
alter table public.ai_agent_config
  add column if not exists lia_mode text not null default 'automatica',
  add column if not exists lia_hours jsonb,
  add column if not exists lia_daily_limit integer not null default 200;

do $$ begin
  alter table public.ai_agent_config add constraint ai_agent_config_lia_mode_check
    check (lia_mode in ('assistente','semiautomatica','automatica'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ai_agent_config add constraint ai_agent_config_lia_daily_limit_check
    check (lia_daily_limit between 1 and 5000);
exception when duplicate_object then null; end $$;

alter table public.conversations
  add column if not exists ai_suggestion text,
  add column if not exists ai_suggestion_at timestamptz;

create table if not exists public.ai_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  phone text,
  decisao text not null check (decisao in ('respondeu','aprovada','sugeriu','encaminhou','ignorou','falhou')),
  motivo text not null,
  modo text,
  created_at timestamptz not null default now()
);
create index if not exists ai_decisions_company_created_idx on public.ai_decisions(company_id, created_at desc);
create index if not exists ai_decisions_conversation_idx on public.ai_decisions(conversation_id, created_at desc);

alter table public.ai_decisions enable row level security;
drop policy if exists ai_decisions_select on public.ai_decisions;
create policy ai_decisions_select on public.ai_decisions for select to authenticated
  using (company_id = (select public.current_company_id()));
-- Só o webhook (service_role) grava decisões.
revoke insert, update, delete on public.ai_decisions from authenticated, anon;
grant select on public.ai_decisions to authenticated;
grant all on public.ai_decisions to service_role;

-- Toda troca de modo, horário ou limite fica na auditoria, com quem fez.
create or replace function crm_private.lia_mode_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.lia_mode, new.lia_hours, new.lia_daily_limit) is distinct from (old.lia_mode, old.lia_hours, old.lia_daily_limit) then
    insert into public.audit_logs(company_id, profile_id, table_name, record_id, action, old_data, new_data)
    values (new.company_id, auth.uid(), 'ai_agent_config', new.id, 'lia_modo',
      jsonb_build_object('modo', old.lia_mode, 'horario', old.lia_hours, 'limite', old.lia_daily_limit),
      jsonb_build_object('modo', new.lia_mode, 'horario', new.lia_hours, 'limite', new.lia_daily_limit));
  end if;
  return new;
end $$;
revoke all on function crm_private.lia_mode_audit() from public, anon, authenticated;
drop trigger if exists ai_agent_config_lia_mode_audit on public.ai_agent_config;
create trigger ai_agent_config_lia_mode_audit after update on public.ai_agent_config
  for each row execute function crm_private.lia_mode_audit();
