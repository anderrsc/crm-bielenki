alter table public.clients
  add column if not exists postal_code text
  check (postal_code ~ '^[0-9]{8}$');
