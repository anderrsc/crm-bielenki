-- Adiciona colunas de provedor de IA e WhatsApp que faltavam em ai_agent_config
alter table public.ai_agent_config
  add column if not exists ai_provider        text not null default 'groq',
  add column if not exists groq_api_key       text,
  add column if not exists wpp_provider       text not null default 'evolution',
  add column if not exists evolution_api_url  text,
  add column if not exists evolution_api_key  text,
  add column if not exists evolution_instance text;

-- Garante que service_role pode ler/escrever (RLS já existe via policy da 013)
grant select, insert, update on public.ai_agent_config to service_role;
