-- Migration 021 — Colunas faltantes em installation_checklists
alter table public.installation_checklists
  add column if not exists deadline date,
  add column if not exists responsible_id uuid references public.profiles(id),
  add column if not exists required boolean not null default true;

create index if not exists idx_installation_checklists_deadline
  on public.installation_checklists(deadline)
  where deadline is not null and completed = false;
