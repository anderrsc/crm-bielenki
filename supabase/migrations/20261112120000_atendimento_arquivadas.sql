-- Atendimento: conversas arquivadas (como no WhatsApp). A conversa continua
-- arquivada quando chega mensagem nova; sai do arquivo so quando alguem
-- desarquiva. Pode ser rodada mais de uma vez.
alter table public.conversations add column if not exists archived_at timestamptz;
create index if not exists conversations_archived_idx
  on public.conversations (company_id, channel, last_message_at desc) where archived_at is not null;
