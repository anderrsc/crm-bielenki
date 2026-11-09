-- Respostas prontas do Atendimento (endereço, horário, Pix, pedir foto...). Toda a equipe usa e edita.
create table if not exists public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  shortcut text not null,
  body text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quick_replies_company_idx on public.quick_replies(company_id, sort_order);
alter table public.quick_replies enable row level security;
drop policy if exists quick_replies_rls on public.quick_replies;
create policy quick_replies_rls on public.quick_replies for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant select, insert, update, delete on public.quick_replies to authenticated;
