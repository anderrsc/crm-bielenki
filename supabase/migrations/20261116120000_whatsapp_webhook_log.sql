begin;
-- Registro tecnico do resultado de cada evento recebido do WhatsApp, para descobrir
-- por que uma mensagem nao entrou no Atendimento. Sem texto, nome ou telefone.
create table if not exists crm_admin.whatsapp_webhook_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  provider text not null,
  event text,
  status text,
  http integer,
  from_me boolean,
  jid_kind text,
  message_types text,
  key_fields text
);
create index if not exists whatsapp_webhook_log_at_idx on crm_admin.whatsapp_webhook_log(at);
revoke all on crm_admin.whatsapp_webhook_log from public, anon, authenticated;

-- Gravacao pela rota do webhook (service role), mantendo so 7 dias.
create or replace function public.log_whatsapp_webhook(p jsonb) returns void
language sql security definer set search_path=pg_catalog,public as $$
  delete from crm_admin.whatsapp_webhook_log where at < now() - interval '7 days';
  insert into crm_admin.whatsapp_webhook_log(provider,event,status,http,from_me,jid_kind,message_types,key_fields)
  values(left(p->>'provider',20), left(p->>'event',60), left(p->>'status',60), nullif(p->>'http','')::integer,
    (p->>'from_me')::boolean, left(p->>'jid_kind',30), left(p->>'message_types',300), left(p->>'key_fields',300));
$$;
revoke all on function public.log_whatsapp_webhook(jsonb) from public, anon, authenticated;
grant execute on function public.log_whatsapp_webhook(jsonb) to service_role;
commit;
