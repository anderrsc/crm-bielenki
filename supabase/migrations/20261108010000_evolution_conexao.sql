-- WhatsApp pela Evolution API conectado pelo próprio CRM (Central de IA).
-- O CRM gera a chave da Evolution e o segredo do webhook (guardados criptografados).
-- Reexecutável.
alter table public.ai_agent_config
  add column if not exists evolution_webhook_secret text,
  add column if not exists evolution_known_synced_at timestamptz;
