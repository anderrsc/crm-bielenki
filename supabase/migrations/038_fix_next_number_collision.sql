-- Migration 038 - Corrige colisao de numeracao (quotes_company_id_quote_number_key)
--
-- next_number() gerava o proximo numero com count(*)+1 por empresa. Se qualquer
-- linha da tabela for excluida (ex.: orcamento de teste apagado), a contagem cai
-- e o proximo numero gerado volta a coincidir com um numero ja usado por uma
-- linha remanescente, disparando "duplicate key value violates unique
-- constraint" em TODO salvamento seguinte. Trocamos para max(sufixo numerico)+1,
-- que nao depende da quantidade de linhas, e serializamos com advisory lock para
-- evitar corrida entre duas gravacoes simultaneas.

begin;

create or replace function public.next_number(prefix text, relation regclass, company uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  n bigint;
  col text;
  tbl text := regexp_replace(relation::text, '^.*\.', '');
begin
  perform pg_advisory_xact_lock(hashtextextended(tbl || ':' || prefix, 0));

  select column_name into col
  from information_schema.columns
  where table_schema = 'public' and table_name = tbl and column_name like '%\_number' escape '\'
  limit 1;

  execute format(
    'select coalesce(max(substring(%I from ''(\d+)$'')::bigint), 0) + 1 from %s where company_id = $1 and %I like $2',
    col, relation, col
  ) into n using company, prefix || '-%';

  return prefix || '-' || to_char(current_date, 'YYYY') || '-' || lpad(n::text, 5, '0');
end;$$;

commit;
