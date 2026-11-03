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
order by 1, 2;
