-- WhatsApp — auditoria de 23/11/2026, etapa C1. Aditiva e pode ser rodada mais de uma vez.
--
-- P1) Mensagem do cliente que chega atrasada (mais de 2 min, ex.: depois de a conexão travar e
--     ser reiniciada) ou que a reconciliação recupera passa a contar como não lida, desde que:
--     seja dos últimos 2 dias, mais nova que o ponto até onde a conversa foi lida e sem resposta
--     da equipe depois dela. A Lia continua só para mensagens ao vivo (regra no código).
-- P4) Isolamento por número: mensagens (gravar, alterar, apagar), notas/eventos da conversa e as
--     ações de nota, transferência e status passam a conferir o acesso ao número, como a leitura.

-- ── P1 ─────────────────────────────────────────────────────────────────────────────────────
alter table public.conversations add column if not exists read_through_at timestamptz;
comment on column public.conversations.read_through_at is
  'Até onde a conversa foi lida (no CRM ou no celular). Mensagem atrasada ou recuperada mais antiga que isto não volta a contar como não lida.';

create or replace function public.inbox_counts_as_unread(p_conversation uuid, p_read_through timestamptz, p_at timestamptz)
returns boolean language sql stable set search_path = public as $$
  select p_at >= now() - interval '2 days'
    and p_at > coalesce(p_read_through, '-infinity'::timestamptz)
    and not exists (
      select 1 from public.messages m
      where m.conversation_id = p_conversation and m.direction = 'outbound' and m.author = 'equipe' and m.sent_at >= p_at
    );
$$;
revoke all on function public.inbox_counts_as_unread(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.inbox_counts_as_unread(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- Mesma assinatura de antes: ao vivo soma 1; atrasada soma 1 se ainda não foi vista.
create or replace function public.inbox_receive(p_id uuid, p_company uuid, p_at timestamptz, p_preview text, p_generation uuid, p_historical boolean default false)
returns void language sql set search_path = public as $$
  update public.conversations set
    last_message_preview = case when last_message_at is null or p_at >= last_message_at then p_preview else last_message_preview end,
    last_message_at = greatest(last_message_at, p_at), last_inbound_at = greatest(last_inbound_at, p_at),
    unread_count = unread_count + case
      when not p_historical then 1
      when public.inbox_counts_as_unread(id, read_through_at, p_at) then 1
      else 0 end,
    ai_generation_id = p_generation, updated_at = now()
  where id = p_id and company_id = p_company;
$$;
revoke all on function public.inbox_receive(uuid, uuid, timestamptz, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.inbox_receive(uuid, uuid, timestamptz, text, uuid, boolean) to service_role;

-- Reconciliação/importação: soma as recebidas que acabaram de entrar e ainda não foram vistas.
-- Roda com as permissões de quem chama (rotina = service role; importação = gerência).
create or replace function public.inbox_count_recovered(p_conversation uuid, p_company uuid, p_ats timestamptz[])
returns integer language plpgsql set search_path = public as $$
declare c public.conversations; v_add integer;
begin
  select * into c from public.conversations where id = p_conversation and company_id = p_company for update;
  if c.id is null or p_ats is null then return 0; end if;
  select count(*) into v_add from unnest(p_ats) as t(at) where public.inbox_counts_as_unread(c.id, c.read_through_at, t.at);
  if v_add > 0 then
    update public.conversations set unread_count = unread_count + v_add, updated_at = now() where id = c.id;
  end if;
  return v_add;
end $$;
revoke all on function public.inbox_count_recovered(uuid, uuid, timestamptz[]) from public, anon;
grant execute on function public.inbox_count_recovered(uuid, uuid, timestamptz[]) to authenticated, service_role;

-- ── P4 ─────────────────────────────────────────────────────────────────────────────────────
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check (
  company_id = (select public.current_company_id()) and (select public.has_table_access('messages', 'insert'))
  and exists (select 1 from public.conversations c where c.id = messages.conversation_id
    and (c.channel_id is null or (select public.my_whatsapp_channels()) @> array[c.channel_id])));

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update to authenticated using (
  company_id = (select public.current_company_id()) and (select public.has_table_access('messages', 'update'))
  and exists (select 1 from public.conversations c where c.id = messages.conversation_id
    and (c.channel_id is null or (select public.my_whatsapp_channels()) @> array[c.channel_id])))
  with check (company_id = (select public.current_company_id()));

drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete to authenticated using (
  company_id = (select public.current_company_id()) and (select public.has_table_access('messages', 'delete'))
  and exists (select 1 from public.conversations c where c.id = messages.conversation_id
    and (c.channel_id is null or (select public.my_whatsapp_channels()) @> array[c.channel_id])));

-- Notas internas e transferências só para quem atende aquele número.
drop policy if exists conversation_events_select on public.conversation_events;
create policy conversation_events_select on public.conversation_events for select to authenticated using (
  company_id = (select public.current_company_id())
  and exists (select 1 from public.conversations c where c.id = conversation_events.conversation_id
    and (c.channel_id is null or (select public.my_whatsapp_channels()) @> array[c.channel_id])));

-- O histórico de conexão é gravado só pelo servidor (record_whatsapp_connection_event).
drop policy if exists whatsapp_conn_hist_insert on public.whatsapp_connection_history;

-- Nota, transferência e status: a conversa precisa ser de um número que a pessoa atende.
create or replace function crm_private.inbox_conversation(p_conversation uuid)
returns public.conversations language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  if auth.uid() is null then raise exception 'Sessão expirada.'; end if;
  select * into c from public.conversations where id = p_conversation and company_id = public.current_company_id() for update;
  if c.id is null or (c.channel_id is not null and not (public.my_whatsapp_channels() @> array[c.channel_id])) then
    raise exception 'Conversa não encontrada.';
  end if;
  return c;
end $$;
