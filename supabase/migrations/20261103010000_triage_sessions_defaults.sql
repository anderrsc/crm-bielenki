-- Conversas de triagem sem mensagens/dados/pontuacao quebravam a pagina
-- Agente IA e o webhook do WhatsApp. Preenche os vazios e garante os padroes.
-- Pode ser rodada mais de uma vez.
update public.triage_sessions set messages = '[]' where messages is null;
update public.triage_sessions set dados_coletados = '{}' where dados_coletados is null;
update public.triage_sessions set score = 0 where score is null;
alter table public.triage_sessions alter column messages set default '[]';
alter table public.triage_sessions alter column dados_coletados set default '{}';
alter table public.triage_sessions alter column score set default 0;
