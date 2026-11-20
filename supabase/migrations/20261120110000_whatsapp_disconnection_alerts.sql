-- Alertas automáticos para canais WhatsApp desconectados
-- Detecta canais que ficaram sem conexão por mais de 30 minutos e notifica gerência

create or replace function public.check_whatsapp_disconnections()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_threshold_minutes int := 30;
  v_threshold_time timestamptz := now() - (v_threshold_minutes || ' minutes')::interval;
  v_company_id uuid;
  v_channel_id uuid;
  v_channel_name text;
  v_last_event timestamptz;
  v_already_notified boolean;
begin
  -- Para cada empresa com canais ativos
  for v_company_id in select distinct company_id from whatsapp_channels where active = true and deleted_at is null
  loop
    -- Verifica canais desconectados há mais de 30 minutos
    for v_channel_id, v_channel_name, v_last_event in
      select id, name, last_event_at
      from whatsapp_channels
      where company_id = v_company_id
        and active = true
        and deleted_at is null
        and status != 'open'
        and (last_event_at is null or last_event_at < v_threshold_time)
    loop
      -- Verifica se já notificou recentemente (últimas 2 horas)
      select exists(
        select 1 from notifications
        where company_id = v_company_id
          and type = 'whatsapp_disconnection'
          and data->>'channel_id' = v_channel_id::text
          and created_at > now() - interval '2 hours'
      ) into v_already_notified;

      if not v_already_notified then
        -- Cria notificação para administradores e gerentes da empresa
        insert into notifications (company_id, profile_id, type, title, message, data, read, created_at)
        select
          v_company_id,
          p.id,
          'whatsapp_disconnection',
          'WhatsApp desconectado',
          format('O canal "%s" está desconectado há mais de %s minutos. Verifique a conexão.', v_channel_name, v_threshold_minutes),
          jsonb_build_object('channel_id', v_channel_id, 'channel_name', v_channel_name, 'last_event_at', v_last_event),
          false,
          now()
        from profiles p
        inner join user_roles ur on ur.profile_id = p.id
        where p.company_id = v_company_id
          and ur.role in ('administrador', 'gerente')
          and p.status = 'ativo';
      end if;
    end loop;
  end loop;
end;
$$;

-- Grant para service_role (executado pela rotina de operações)
grant execute on function public.check_whatsapp_disconnections() to service_role;

-- View para listar alertas recentes de desconexão
create or replace view public.v_whatsapp_disconnection_alerts with (security_invoker=true) as
select
  n.company_id,
  n.profile_id,
  n.id as notification_id,
  n.data->>'channel_id' as channel_id,
  n.data->>'channel_name' as channel_name,
  (n.data->>'last_event_at')::timestamptz as last_event_at,
  n.created_at as alerted_at,
  n.read,
  extract(epoch from (now() - (n.data->>'last_event_at')::timestamptz)) / 60 as minutes_disconnected
from notifications n
where n.type = 'whatsapp_disconnection'
  and n.created_at > now() - interval '24 hours'
order by n.created_at desc;