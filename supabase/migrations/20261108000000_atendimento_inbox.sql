-- Atendimento (caixa de entrada do WhatsApp, estilo Octadesk).
-- Uma conversa por contato; cada mensagem guarda quem escreveu (cliente, Ana,
-- alguém da equipe ou automação) para mostrar o nome em cima da mensagem.
-- Reexecutável.

alter table public.conversations
  add column if not exists phone text,
  add column if not exists contact_name text,
  add column if not exists last_message_at timestamptz,
  add column if not exists last_message_preview text,
  add column if not exists last_inbound_at timestamptz,
  add column if not exists unread_count integer not null default 0,
  add column if not exists ai_paused boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.messages
  add column if not exists external_id text,
  add column if not exists sender_name text,
  add column if not exists author text,
  add column if not exists delivery_status text,
  add column if not exists error_message text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_author_check') then
    alter table public.messages add constraint messages_author_check
      check (author is null or author in ('cliente', 'ana', 'equipe', 'automacao'));
  end if;
end $$;

create unique index if not exists messages_company_external_idx
  on public.messages(company_id, external_id) where external_id is not null;
create index if not exists messages_conversation_sent_idx
  on public.messages(conversation_id, sent_at);
create index if not exists conversations_inbox_idx
  on public.conversations(company_id, channel, last_message_at desc);
create index if not exists conversations_phone_idx
  on public.conversations(company_id, channel, external_id);
