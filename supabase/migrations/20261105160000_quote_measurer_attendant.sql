-- Orçamento: medidor e atendente responsável pela obra (uso interno da equipe,
-- não sai no PDF do cliente). Escolhidos entre os funcionários. Pode ser
-- rodada mais de uma vez.
alter table public.quotes
  add column if not exists measurer_id uuid references public.profiles(id) on delete set null,
  add column if not exists attendant_id uuid references public.profiles(id) on delete set null;

create index if not exists quotes_measurer_id_idx on public.quotes(measurer_id);
create index if not exists quotes_attendant_id_idx on public.quotes(attendant_id);

comment on column public.quotes.measurer_id is 'Funcionário que fez/fará a medição da obra.';
comment on column public.quotes.attendant_id is 'Funcionário atendente responsável pela obra.';
