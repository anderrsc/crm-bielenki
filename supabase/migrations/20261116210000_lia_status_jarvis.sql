-- Resumo da Lia para o JARVIS (e para a gestão): modo, decisões de hoje, sugestões
-- esperando aprovação, conversas esperando a equipe e falhas recentes. Só leitura,
-- só da empresa de quem chama, sem nenhum segredo da configuração.
create or replace function public.lia_status_center() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_inicio timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v jsonb;
begin
  if auth.uid() is null or v_company is null then raise exception 'Sessão expirada.'; end if;
  select jsonb_build_object('ativa', c.active, 'modo', c.lia_mode, 'limite_diario', c.lia_daily_limit, 'horario', c.lia_hours)
    into v from public.ai_agent_config c where c.company_id = v_company;
  v := coalesce(v, jsonb_build_object('ativa', false, 'modo', 'automatica', 'limite_diario', 200, 'horario', null));
  return v || jsonb_build_object(
    'hoje', (select coalesce(jsonb_object_agg(decisao, n), '{}'::jsonb) from (
      select decisao, count(*) n from public.ai_decisions where company_id = v_company and created_at >= v_inicio group by decisao) x),
    'sugestoes', (select coalesce(jsonb_agg(jsonb_build_object('conversa', s.id, 'contato', coalesce(nullif(s.contact_name, ''), s.phone), 'texto', left(s.ai_suggestion, 200), 'desde', s.ai_suggestion_at) order by s.ai_suggestion_at), '[]'::jsonb) from (
      select id, contact_name, phone, ai_suggestion, ai_suggestion_at from public.conversations
      where company_id = v_company and ai_suggestion is not null order by ai_suggestion_at limit 20) s),
    'aguardando_equipe', (select count(*) from public.conversations
      where company_id = v_company and unread_count > 0 and ai_paused and archived_at is null and coalesce(status, 'aberta') <> 'resolvida'),
    'falhas_24h', (select coalesce(jsonb_agg(jsonb_build_object('motivo', f.motivo, 'quando', f.created_at) order by f.created_at desc), '[]'::jsonb) from (
      select motivo, created_at from public.ai_decisions
      where company_id = v_company and decisao = 'falhou' and created_at >= now() - interval '24 hours' order by created_at desc limit 5) f)
  );
end $$;
revoke all on function public.lia_status_center() from public, anon;
grant execute on function public.lia_status_center() to authenticated;
