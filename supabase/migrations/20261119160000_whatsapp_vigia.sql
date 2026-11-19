-- Vigia do WhatsApp: detecta a conexão "zumbi" (aparece conectada, mas parou de receber mensagens)
-- e reinicia a conexão sozinho. Só acrescenta colunas.
alter table public.whatsapp_channels add column if not exists last_message_event_at timestamptz;
alter table public.whatsapp_channels add column if not exists last_restart_at timestamptz;
alter table public.whatsapp_channels add column if not exists restart_count integer not null default 0;
-- Ponto de partida: a última mensagem gravada de cada número (eventos de conexão não contam).
update public.whatsapp_channels w set last_message_event_at = (
  select max(m.sent_at) from public.messages m join public.conversations c on c.id = m.conversation_id where c.channel_id = w.id)
where w.last_message_event_at is null and w.deleted_at is null;
comment on column public.whatsapp_channels.last_message_event_at is 'Último evento de mensagem/recibo/contato vindo do servidor (eventos de conexão não contam).';
comment on column public.whatsapp_channels.last_restart_at is 'Última vez que a conexão foi reiniciada (manual ou pelo vigia).';

-- Aviso para a equipe disparado pela rotina do servidor (só o service_role chama).
create or replace function public.notify_team_service(p_company_id uuid, p_event text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform crm_private.notify_team(p_company_id, p_event, p_title, p_body, p_link);
end $$;
revoke all on function public.notify_team_service(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.notify_team_service(uuid, text, text, text, text) to service_role;
