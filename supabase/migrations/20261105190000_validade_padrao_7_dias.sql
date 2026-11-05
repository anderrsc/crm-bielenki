-- Validade padrão dos orçamentos: 7 dias corridos (continua editável em Configurações e em cada orçamento).
alter table public.companies alter column default_validity_days set default 7;
update public.companies set default_validity_days = 7 where default_validity_days is distinct from 7;
