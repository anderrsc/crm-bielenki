begin;
-- IDs externos continuam iguais aos do provedor. Apenas a unicidade ganha o canal.
alter table public.messages add column if not exists channel_id uuid references public.whatsapp_channels(id);
alter table public.whatsapp_webhook_events add column if not exists channel_id uuid references public.whatsapp_channels(id);
create index if not exists messages_channel_idx on public.messages(channel_id);
create index if not exists whatsapp_webhook_events_channel_idx on public.whatsapp_webhook_events(channel_id);

create or replace function crm_private.message_channel() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare conversation_company uuid;
begin
  if new.conversation_id is null then new.channel_id:=null; return new; end if;
  select company_id,channel_id into conversation_company,new.channel_id from public.conversations where id=new.conversation_id;
  if not found or conversation_company<>new.company_id then raise exception 'Conversa inválida para a empresa' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function crm_private.message_channel() from public,anon,authenticated;
drop trigger if exists messages_channel on public.messages;
create trigger messages_channel before insert or update of conversation_id,company_id,channel_id on public.messages
for each row execute function crm_private.message_channel();
update public.messages m set channel_id=c.channel_id from public.conversations c where c.id=m.conversation_id and m.channel_id is distinct from c.channel_id;
create unique index if not exists messages_company_channel_external_idx on public.messages(company_id,channel_id,external_id) nulls not distinct where external_id is not null;
drop index if exists public.messages_company_external_idx;

create or replace function crm_private.conversation_message_channels() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.messages set channel_id=new.channel_id where conversation_id=new.id and channel_id is distinct from new.channel_id;
  return new;
end $$;
revoke all on function crm_private.conversation_message_channels() from public,anon,authenticated;
drop trigger if exists conversations_message_channels on public.conversations;
create trigger conversations_message_channels after update of channel_id on public.conversations
for each row when(old.channel_id is distinct from new.channel_id) execute function crm_private.conversation_message_channels();
-- O webhook conserva a PK antiga: o novo código grava event_id como tupla
-- (canal,id do provedor). Assim a versão anterior continua funcionando até o deploy.
commit;
