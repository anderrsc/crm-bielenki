-- Diagnostico do Agente IA no banco de producao. So mostra tipos e contagens
-- (nunca o conteudo das conversas, nomes ou telefones).
select 'coluna' tipo, table_name || '.' || column_name || ' ' || data_type || case when is_nullable = 'YES' then ' null' else '' end info
from information_schema.columns
where table_schema = 'public' and table_name in ('triage_sessions', 'ai_agent_config')
union all
select 'conversas', count(*)::text from public.triage_sessions
union all
select 'formato', k || ': ' || coalesce(t, 'nulo') || ' = ' || count(*)
from public.triage_sessions s, lateral jsonb_each(to_jsonb(s)) e(k, v), lateral (select jsonb_typeof(v) t) x
where k not in ('id', 'company_id', 'conversation_id', 'created_at', 'updated_at', 'completed_at')
group by k, t
union all
select 'mensagens', 'itens nao-objeto: ' || count(*) from public.triage_sessions s, lateral jsonb_array_elements(case when jsonb_typeof(to_jsonb(s.messages)) = 'array' then to_jsonb(s.messages) else '[]' end) m where jsonb_typeof(m) <> 'object' or jsonb_typeof(m->'content') not in ('string')
union all
select 'config', k || ': ' || coalesce(jsonb_typeof(v), 'nulo') from public.ai_agent_config c, lateral jsonb_each(to_jsonb(c)) e(k, v) where k not like '%key%' and k not like '%token%'
union all
select 'chave', k || ': ' || case when coalesce(v #>> '{}', '') = '' then 'vazia' when v #>> '{}' like 'enc:%' then 'criptografada' else 'texto' end
from public.ai_agent_config c, lateral jsonb_each(to_jsonb(c)) e(k, v) where k like '%key%' or k like '%token%'
union all
-- Valores que nao sao segredo: provedores escolhidos e estado do agente.
select 'valor', k || ' = ' || coalesce(v #>> '{}', 'nulo')
from public.ai_agent_config c, lateral jsonb_each(to_jsonb(c)) e(k, v) where k in ('ai_provider', 'wpp_provider', 'active', 'openai_model', 'agent_name')
union all
-- Campos de conexao: so se estao preenchidos.
select 'preenchido', k || ': ' || case when coalesce(v #>> '{}', '') = '' then 'vazio' else 'preenchido' end
from public.ai_agent_config c, lateral jsonb_each(to_jsonb(c)) e(k, v) where k in ('evolution_api_url', 'evolution_instance', 'whatsapp_number_id') or k like 'evolution%secret%'
union all
select 'empresa', 'whatsapp_phone_number_id: ' || case when coalesce(whatsapp_phone_number_id, '') = '' then 'vazio' else 'preenchido' end from public.companies
union all
-- Saude do recebimento do WhatsApp: so horarios (Brasilia) e contagens.
select 'whatsapp', 'ultima mensagem recebida (gravada): ' || coalesce(to_char(max(sent_at) at time zone 'America/Sao_Paulo','DD/MM HH24:MI'),'nenhuma') from public.messages where direction='inbound'
union all
select 'whatsapp', 'ultima mensagem enviada (gravada): ' || coalesce(to_char(max(sent_at) at time zone 'America/Sao_Paulo','DD/MM HH24:MI'),'nenhuma') from public.messages where direction='outbound'
union all
select 'whatsapp', 'recebidas nas ultimas 24h: ' || count(*) from public.messages where direction='inbound' and sent_at > now() - interval '24 hours'
union all
select 'whatsapp', 'ultimo evento do webhook: ' || coalesce(to_char(max(received_at) at time zone 'America/Sao_Paulo','DD/MM HH24:MI'),'nenhum') from public.whatsapp_webhook_events
union all
select 'whatsapp', 'eventos do webhook nas ultimas 24h: ' || count(*) from public.whatsapp_webhook_events where received_at > now() - interval '24 hours'
union all
select 'whatsapp', 'config atualizada em: ' || coalesce(to_char(max(updated_at) at time zone 'America/Sao_Paulo','DD/MM HH24:MI'),'nunca') from public.ai_agent_config
union all
select 'whatsapp', 'agenda sincronizada em: ' || coalesce(to_char(max(evolution_known_synced_at) at time zone 'America/Sao_Paulo','DD/MM HH24:MI'),'nunca') from public.ai_agent_config
union all
select 'whatsapp', 'conversas com nao lidas: ' || count(*) || ' (total ' || coalesce(sum(unread_count),0) || ')' from public.conversations where unread_count > 0
union all
select 'whatsapp', 'agora: ' || to_char(now() at time zone 'America/Sao_Paulo','DD/MM HH24:MI')
order by 1, 2;
