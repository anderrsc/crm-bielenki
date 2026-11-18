begin;
-- Chave do Google Gemini (criptografada no app) para leitura de notas fiscais com IA.
alter table public.ai_agent_config add column if not exists gemini_api_key text;
commit;
