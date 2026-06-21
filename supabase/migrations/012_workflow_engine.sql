-- ============================================================
-- 012_workflow_engine.sql — Central de Automações Inteligentes
-- ============================================================

-- 1. Expandir message_templates para suportar workflows
alter table public.message_templates drop constraint if exists message_templates_company_id_event_name_key;
alter table public.message_templates drop constraint if exists message_templates_event_check;
alter table public.message_templates alter column event set default 'workflow';
alter table public.message_templates add column if not exists category text not null default 'geral';
alter table public.message_templates add column if not exists channel text not null default 'whatsapp';
alter table public.message_templates add column if not exists subject text;
alter table public.message_templates add column if not exists usage_count integer not null default 0;
create unique index if not exists message_templates_company_name_channel_idx on public.message_templates(company_id, name, channel);

-- 2. Tabela central de workflows
create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'rascunho' check(status in ('rascunho','ativo','inativo','arquivado')),
  trigger_type text not null default 'manual',
  trigger_config jsonb not null default '{}',
  conditions jsonb not null default '[]',
  steps jsonb not null default '[]',
  version integer not null default 1,
  runs_count integer not null default 0,
  success_count integer not null default 0,
  last_run_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Log de execuções por workflow
create table if not exists public.workflow_executions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  trigger_type text not null,
  trigger_data jsonb not null default '{}',
  status text not null default 'pendente' check(status in ('pendente','executando','concluido','falhou','cancelado')),
  current_step integer not null default 0,
  steps_total integer not null default 0,
  error_message text,
  output_log jsonb not null default '[]',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer
);

-- 4. Webhooks de entrada
create table if not exists public.workflow_webhooks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  workflow_id uuid references public.workflows(id) on delete set null,
  name text not null,
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  active boolean not null default true,
  last_received_at timestamptz,
  total_received integer not null default 0,
  created_at timestamptz not null default now()
);

-- 5. Integrações externas configuráveis
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null, -- whatsapp_meta, whatsapp_evolution, openai, sendgrid, mercadopago, asaas, google_calendar, clicksign
  name text not null,
  config jsonb not null default '{}', -- api_key, base_url, etc (encrypted at app level)
  active boolean not null default false,
  last_tested_at timestamptz,
  last_test_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, provider)
);

-- 6. Índices
create index if not exists workflows_company_status_idx on public.workflows(company_id, status);
create index if not exists workflow_executions_workflow_idx on public.workflow_executions(workflow_id, started_at desc);
create index if not exists workflow_executions_pending_idx on public.workflow_executions(company_id, status) where status in ('pendente','executando');

-- 7. RLS
alter table public.workflows enable row level security;
alter table public.workflow_executions enable row level security;
alter table public.workflow_webhooks enable row level security;
alter table public.integrations enable row level security;

create policy workflows_rls on public.workflows for all to authenticated
  using (company_id = public.current_company_id() and public.has_role(array['administrador','gerente']::public.app_role[]))
  with check (company_id = public.current_company_id());

create policy workflow_exec_rls on public.workflow_executions for all to authenticated
  using (company_id = public.current_company_id() and public.has_role(array['administrador','gerente']::public.app_role[]));

create policy workflow_webhooks_rls on public.workflow_webhooks for all to authenticated
  using (company_id = public.current_company_id() and public.has_role(array['administrador','gerente']::public.app_role[]))
  with check (company_id = public.current_company_id());

create policy integrations_rls on public.integrations for all to authenticated
  using (company_id = public.current_company_id() and public.has_role(array['administrador','gerente']::public.app_role[]))
  with check (company_id = public.current_company_id());

-- 8. Função central de disparo de workflow por evento
create or replace function public.trigger_workflow_event(
  p_company_id uuid,
  p_trigger_type text,
  p_trigger_data jsonb
) returns integer language plpgsql security definer set search_path=public as $$
declare matched integer := 0; w record;
begin
  for w in
    select id, jsonb_array_length(steps) as step_count
    from public.workflows
    where company_id = p_company_id
      and status = 'ativo'
      and trigger_type = p_trigger_type
  loop
    insert into public.workflow_executions(
      company_id, workflow_id, trigger_type, trigger_data, steps_total
    ) values (
      p_company_id, w.id, p_trigger_type, p_trigger_data, w.step_count
    );
    update public.workflows
      set runs_count = runs_count + 1, last_run_at = now(), updated_at = now()
      where id = w.id;
    matched := matched + 1;
  end loop;
  return matched;
end $$;

-- 9. Trigger: novo lead → dispara workflows
create or replace function public.on_lead_created_workflow() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform public.trigger_workflow_event(
    new.company_id, 'lead_criado',
    jsonb_build_object('lead_id',new.id,'nome',new.name,'telefone',new.phone,'email',new.email,'origem',new.source,'stage_id',new.stage_id)
  );
  return new;
end $$;
drop trigger if exists wf_lead_created on public.leads;
create trigger wf_lead_created after insert on public.leads
  for each row execute function public.on_lead_created_workflow();

-- 10. Trigger: mudança de status de orçamento
create or replace function public.on_quote_changed_workflow() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.status is distinct from new.status then
    perform public.trigger_workflow_event(
      new.company_id, 'orcamento_' || new.status,
      jsonb_build_object('quote_id',new.id,'numero',new.quote_number,'status',new.status,'total',new.total,'client_id',new.client_id)
    );
  end if;
  return new;
end $$;
drop trigger if exists wf_quote_status on public.quotes;
create trigger wf_quote_status after update on public.quotes
  for each row execute function public.on_quote_changed_workflow();

-- 11. Trigger: instalação concluída
create or replace function public.on_installation_done_workflow() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.status is distinct from new.status and new.status = 'concluida' then
    perform public.trigger_workflow_event(
      new.company_id, 'instalacao_concluida',
      jsonb_build_object('installation_id',new.id,'order_id',new.order_id,'responsible_id',new.responsible_id)
    );
  end if;
  return new;
end $$;
drop trigger if exists wf_installation_done on public.installations;
create trigger wf_installation_done after update on public.installations
  for each row execute function public.on_installation_done_workflow();

-- 12. Seed: templates de mensagem para workflows
create or replace function public.seed_company_workflow_templates(p_company_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  insert into public.message_templates(company_id, name, event, category, channel, body) values
    (p_company_id,'Boas-vindas ao lead','workflow','primeiro_contato','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! 👋 Aqui é [VENDEDOR_NOME] da [EMPRESA_NOME]. Acabamos de receber seu contato e já estamos preparando as melhores opções para o seu projeto! Em breve te retorno. 😊'),
    (p_company_id,'Follow-up 24h — orçamento','workflow','pos_orcamento','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! Tudo bem? Enviei o orçamento nº [ORCAMENTO_NUMERO] (R$ [ORCAMENTO_VALOR_TOTAL]). Ficou com alguma dúvida ou quer conversar sobre o projeto? Estou à disposição! 😊'),
    (p_company_id,'Follow-up 72h — orçamento','workflow','pos_orcamento','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! [VENDEDOR_NOME] aqui da [EMPRESA_NOME]. Passaram alguns dias e queria saber se ainda está pensando no projeto. Nosso orçamento ainda está válido e posso ajustar se precisar. 🏠'),
    (p_company_id,'Orçamento aprovado — parabéns','workflow','pos_orcamento','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! 🎉 Ótima notícia! Seu orçamento foi aprovado. Nossa equipe já está preparando tudo. Em breve você receberá os próximos passos. Obrigado pela confiança na [EMPRESA_NOME]!'),
    (p_company_id,'Confirmação de visita','workflow','pos_visita','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! 📅 Confirmamos sua visita para [VISITA_DATA] às [VISITA_HORA]. Nossa equipe estará no local. Qualquer dúvida é só falar!'),
    (p_company_id,'Pós-instalação — satisfação','workflow','pos_venda','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! 🌟 Sua instalação foi concluída com sucesso! Como foi a experiência com nossa equipe? Sua opinião é muito importante para nós. Obrigado pela confiança na [EMPRESA_NOME]!'),
    (p_company_id,'Reativação — lead frio','workflow','reativacao','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! Tudo bem? Aqui é [VENDEDOR_NOME] da [EMPRESA_NOME]. Faz um tempinho que não conversamos e queria saber se ainda está interessado no projeto. Temos novidades e condições especiais! 🏠'),
    (p_company_id,'Cobrança amigável','workflow','cobranca','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! Aqui é da [EMPRESA_NOME]. Passando para lembrar sobre o pagamento pendente. Qualquer dúvida estou à disposição para resolver da melhor forma. 😊')
  on conflict do nothing;

  -- Seed de workflows prontos
  insert into public.workflows(company_id, name, description, status, trigger_type, steps) values
    (p_company_id,
     '🎯 Novo lead — boas-vindas automática',
     'Envia mensagem de boas-vindas imediatamente quando um lead entra no CRM.',
     'inativo', 'lead_criado',
     '[{"id":"s1","type":"send_whatsapp","name":"Enviar boas-vindas","config":{"template":"Boas-vindas ao lead","delay_minutes":5}}]'::jsonb),
    (p_company_id,
     '📋 Orçamento enviado — follow-up automático',
     'Faz follow-up 24h e 72h após o orçamento ser enviado sem aprovação.',
     'inativo', 'orcamento_enviado',
     '[{"id":"s1","type":"wait","name":"Aguardar 24h","config":{"hours":24}},{"id":"s2","type":"send_whatsapp","name":"Follow-up 24h","config":{"template":"Follow-up 24h — orçamento","delay_minutes":0}},{"id":"s3","type":"wait","name":"Aguardar mais 72h","config":{"hours":72}},{"id":"s4","type":"send_whatsapp","name":"Follow-up 72h","config":{"template":"Follow-up 72h — orçamento","delay_minutes":0}}]'::jsonb),
    (p_company_id,
     '🎉 Orçamento aprovado — notificar operação',
     'Quando um orçamento é aprovado, notifica gerente e operação para criar o pedido.',
     'inativo', 'orcamento_aprovado',
     '[{"id":"s1","type":"notify_user","name":"Notificar gerente","config":{"message":"Orçamento aprovado! Criar pedido para o cliente.","role":"gerente"}},{"id":"s2","type":"send_whatsapp","name":"Parabéns ao cliente","config":{"template":"Orçamento aprovado — parabéns","delay_minutes":0}}]'::jsonb),
    (p_company_id,
     '✅ Instalação concluída — pós-venda',
     'Envia pesquisa de satisfação 1h após a instalação ser marcada como concluída.',
     'inativo', 'instalacao_concluida',
     '[{"id":"s1","type":"wait","name":"Aguardar 1h","config":{"hours":1}},{"id":"s2","type":"send_whatsapp","name":"Pesquisa de satisfação","config":{"template":"Pós-instalação — satisfação","delay_minutes":0}}]'::jsonb),
    (p_company_id,
     '💤 Lead frio — reativação 30 dias',
     'Reativa leads sem interação há mais de 30 dias com mensagem personalizada.',
     'inativo', 'scheduled',
     '[{"id":"s1","type":"send_whatsapp","name":"Mensagem de reativação","config":{"template":"Reativação — lead frio","delay_minutes":0}}]'::jsonb),
    (p_company_id,
     '📅 Visita agendada — confirmação',
     'Envia confirmação de visita 1 dia antes da data agendada.',
     'inativo', 'instalacao_agendada',
     '[{"id":"s1","type":"wait","name":"24h antes da visita","config":{"hours":24}},{"id":"s2","type":"send_whatsapp","name":"Confirmar visita","config":{"template":"Confirmação de visita","delay_minutes":0}}]'::jsonb)
  on conflict do nothing;
end $$;

-- Executar seed para empresas existentes
do $$ declare c uuid; begin
  for c in select id from public.companies loop
    perform public.seed_company_workflow_templates(c);
  end loop;
end $$;

-- Trigger para novas empresas
create or replace function public.on_new_company_workflows() returns trigger
language plpgsql security definer set search_path=public as $$
begin perform public.seed_company_workflow_templates(new.id); return new; end $$;
drop trigger if exists company_workflow_seed on public.companies;
create trigger company_workflow_seed after insert on public.companies
  for each row execute function public.on_new_company_workflows();

-- 13. View de analytics de automações
create or replace view public.v_workflow_analytics as
select
  w.id,
  w.company_id,
  w.name,
  w.status,
  w.trigger_type,
  w.runs_count,
  w.success_count,
  w.last_run_at,
  count(e.id) filter (where e.started_at >= now() - interval '30 days') as runs_30d,
  count(e.id) filter (where e.status = 'concluido' and e.started_at >= now() - interval '30 days') as success_30d,
  count(e.id) filter (where e.status = 'falhou' and e.started_at >= now() - interval '30 days') as failed_30d,
  round(avg(e.duration_ms) filter (where e.duration_ms is not null)::numeric / 1000, 1) as avg_duration_s
from public.workflows w
left join public.workflow_executions e on e.workflow_id = w.id
group by w.id;

grant select on public.v_workflow_analytics to authenticated;
