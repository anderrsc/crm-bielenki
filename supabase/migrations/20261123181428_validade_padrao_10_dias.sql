begin;
-- Decisão do dono em 23/11: preservar prazos personalizados e orçamentos existentes.
alter table public.companies alter column default_validity_days set default 10;
update public.companies set default_validity_days = 10 where default_validity_days = 7;

-- Atualiza as definições vigentes, incluindo o corpo renomeado pelas migrações
-- de segurança. Não reaplica versões antigas das funções nem altera os grants.
do $$
declare r record; definition text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('create_gutter_quote','create_gutter_quote_unchecked','create_window_quote','duplicate_quote','create_quote_from_measurement')
  loop
    definition := pg_get_functiondef(r.oid);
    definition := replace(definition, 'where id=c),15)', 'where id=c),10)');
    definition := replace(definition, 'where id=c),null),15)', 'where id=c),null),10)');
    definition := replace(definition, 'current_date+15', 'current_date+coalesce((select default_validity_days from public.companies where id=c),10)');
    if (select proname from pg_proc where oid=r.oid)='create_window_quote'
      and position('coalesce(nullif(p_payload->>''valid_until'','''')::date,current_date+' in definition)=0 then
      definition := replace(definition, 'nullif(p_payload->>''valid_until'','''')::date,',
        'coalesce(nullif(p_payload->>''valid_until'','''')::date,current_date+coalesce((select default_validity_days from public.companies where id=c),10)),');
    end if;
    execute definition;
  end loop;
end $$;
commit;
