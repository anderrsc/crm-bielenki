-- Dados do Pix de cada conta, para gerar a cobrança com "copia e cola".
alter table public.receiving_accounts add column if not exists pix_key text check (pix_key is null or length(pix_key) <= 120);
alter table public.receiving_accounts add column if not exists holder_name text check (holder_name is null or length(holder_name) <= 80);
alter table public.receiving_accounts add column if not exists holder_city text check (holder_city is null or length(holder_city) <= 60);
