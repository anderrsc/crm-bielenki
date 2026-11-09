-- Medidor sem usuário no sistema (terceirizado, freelancer): só o nome no orçamento.
alter table public.quotes add column if not exists measurer_name text;
comment on column public.quotes.measurer_name is 'Medidor sem usuário no CRM (só o nome). Quando preenchido, measurer_id fica vazio.';
