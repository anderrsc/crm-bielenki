begin;
-- Chave da Anthropic (Claude), criptografada no app, para a Lia e a leitura de notas.
alter table public.ai_agent_config add column if not exists anthropic_api_key text;
commit;
