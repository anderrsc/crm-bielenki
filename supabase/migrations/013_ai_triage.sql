-- ============================================================
-- 013_ai_triage.sql — Agente de IA: Triagem Comercial
-- ============================================================

-- 1. Enriquecer leads com campos de qualificação
alter table public.leads add column if not exists score integer not null default 0;
alter table public.leads add column if not exists priority text not null default 'media' check(priority in ('baixa','media','alta','maxima'));
alter table public.leads add column if not exists probability integer not null default 0 check(probability between 0 and 100);
alter table public.leads add column if not exists potencial_financeiro text check(potencial_financeiro in ('baixo','medio','alto','premium'));
alter table public.leads add column if not exists triage_completed boolean not null default false;
alter table public.leads add column if not exists triage_session_id uuid;

-- 2. Tabela de sessões de triagem
create table if not exists public.triage_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  phone text not null,
  status text not null default 'em_andamento' check(status in ('em_andamento','concluida','encaminhada','pos_venda','cancelada')),

  -- Dados coletados na triagem
  nome text,
  telefone text,
  cidade text,
  bairro text,
  rua text,
  numero_end text,
  cep text,
  tipo_servico text,    -- calhas, rufos, esquadrias, fachadas, portoes, guarda_corpos, etc
  produto text,
  medidas text,
  tipo_obra text,       -- obra_nova, reforma, ampliacao, comercial, industrial
  linha text,           -- Suprema, Gold, Perfilatto, Atlanta, Linha 25, Minimalista
  cor text,
  prazo text,           -- ate_30_dias, 30_a_90_dias, acima_90_dias
  referencia_valor text,
  necessita_visita boolean,
  possui_projeto boolean,
  possui_fotos boolean,
  possui_medidas boolean,
  eh_manutencao boolean not null default false,

  -- Classificação automática
  score integer not null default 0,
  prioridade text check(prioridade in ('baixa','media','alta','maxima')),
  probabilidade integer check(probabilidade between 0 and 100),
  potencial_financeiro text check(potencial_financeiro in ('baixo','medio','alto','premium')),
  proxima_acao text,
  resumo_executivo text,

  -- Histórico da conversa com a IA (array de {role, content})
  messages jsonb not null default '[]',
  current_step text not null default 'identificacao',
  dados_coletados jsonb not null default '{}',

  -- Metadados
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  notified_seller boolean not null default false
);

-- 3. Configuração do agente de IA por empresa
create table if not exists public.ai_agent_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  active boolean not null default false,
  agent_name text not null default 'Ana',
  openai_api_key text,          -- encriptado no app
  openai_model text not null default 'gpt-4o',
  temperature numeric not null default 0.3,
  whatsapp_number_id text,
  whatsapp_token text,          -- encriptado no app
  system_prompt text,
  max_turns integer not null default 30,
  auto_create_lead boolean not null default true,
  notify_on_premium boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. Índices
create index if not exists triage_sessions_company_status_idx on public.triage_sessions(company_id, status);
create index if not exists triage_sessions_phone_idx on public.triage_sessions(phone);
create index if not exists triage_sessions_lead_idx on public.triage_sessions(lead_id);

-- 5. RLS
alter table public.triage_sessions enable row level security;
alter table public.ai_agent_config enable row level security;

create policy triage_sessions_rls on public.triage_sessions for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy ai_agent_config_rls on public.ai_agent_config for all to authenticated
  using (company_id = public.current_company_id() and public.has_role(array['administrador','gerente']::public.app_role[]))
  with check (company_id = public.current_company_id());

-- 6. Permissões para service_role (webhook usa service_role key)
grant all on public.triage_sessions to service_role;
grant all on public.ai_agent_config to service_role;
grant select, update on public.leads to service_role;
grant select on public.companies to service_role;
grant select on public.pipeline_stages to service_role;
grant insert on public.leads to service_role;

-- 7. Função auxiliar: calcular score e classificação da triagem
create or replace function public.calcular_score_triagem(p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  s public.triage_sessions;
  score_calc integer := 0;
  potencial text := 'medio';
  prioridade_calc text := 'media';
  prob integer := 20;
begin
  select * into s from public.triage_sessions where id = p_session_id;
  if s.id is null then return; end if;

  -- Pontuação por dados coletados
  if s.nome is not null then score_calc := score_calc + 5; end if;
  if s.cidade is not null then score_calc := score_calc + 5; end if;
  if s.produto is not null then score_calc := score_calc + 10; end if;
  if s.possui_medidas then score_calc := score_calc + 15; end if;
  if s.possui_projeto then score_calc := score_calc + 20; end if;
  if s.possui_fotos then score_calc := score_calc + 10; end if;
  if s.tipo_obra is not null then score_calc := score_calc + 5; end if;
  if s.cor is not null then score_calc := score_calc + 5; end if;
  if s.prazo = 'ate_30_dias' then score_calc := score_calc + 20; prob := prob + 30;
  elsif s.prazo = '30_a_90_dias' then score_calc := score_calc + 10; prob := prob + 15;
  else score_calc := score_calc + 5; end if;
  if s.referencia_valor is not null then score_calc := score_calc + 5; prob := prob + 10; end if;

  -- Potencial financeiro baseado no produto
  if s.produto ilike any(array['%fachada%','%esquadria%','%porta%','%janela%']) then
    potencial := 'alto';
    score_calc := score_calc + 10;
  elsif s.produto ilike any(array['%portao%','%guarda-corpo%','%cobertura%','%pergolado%']) then
    potencial := 'medio';
  end if;
  if s.possui_projeto then potencial := 'premium'; score_calc := score_calc + 5; end if;

  -- Prioridade
  if score_calc >= 80 then prioridade_calc := 'maxima'; prob := least(95, prob + 20);
  elsif score_calc >= 60 then prioridade_calc := 'alta'; prob := least(85, prob + 10);
  elsif score_calc >= 40 then prioridade_calc := 'media';
  else prioridade_calc := 'baixa'; end if;

  update public.triage_sessions set
    score = least(100, score_calc),
    potencial_financeiro = potencial,
    prioridade = prioridade_calc,
    probabilidade = least(100, prob),
    updated_at = now()
  where id = p_session_id;
end $$;

-- 8. Seed: config padrão para empresas existentes
insert into public.ai_agent_config(company_id, active, agent_name, openai_model)
select id, false, 'Ana', 'gpt-4o'
from public.companies
on conflict(company_id) do nothing;

-- 9. Trigger: nova empresa recebe config padrão
create or replace function public.on_new_company_ai_config() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.ai_agent_config(company_id, active, agent_name, openai_model)
  values (new.id, false, 'Ana', 'gpt-4o')
  on conflict(company_id) do nothing;
  return new;
end $$;
drop trigger if exists company_ai_config_seed on public.companies;
create trigger company_ai_config_seed after insert on public.companies
  for each row execute function public.on_new_company_ai_config();
