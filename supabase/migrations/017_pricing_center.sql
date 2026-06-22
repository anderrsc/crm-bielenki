-- ============================================================
-- 017 — Central de Preços: Pintura, Peças, Serviços, Comercial, Log
-- ============================================================

-- Pintura
create table if not exists public.pricing_paints (
  id           uuid         primary key default gen_random_uuid(),
  company_id   uuid         not null references public.companies(id) on delete cascade,
  color        text         not null,
  price_per_meter numeric(12,4) not null default 0,
  notes        text,
  active       boolean      not null default true,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now(),
  unique(company_id, color)
);

-- Peças especiais
create table if not exists public.pricing_special_parts (
  id           uuid         primary key default gen_random_uuid(),
  company_id   uuid         not null references public.companies(id) on delete cascade,
  item_name    text         not null,
  unit         text         not null default 'Unidade',
  unit_price   numeric(12,4) not null default 0,
  notes        text,
  active       boolean      not null default true,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now(),
  unique(company_id, item_name)
);

-- Serviços e Logística
create table if not exists public.pricing_services (
  id           uuid         primary key default gen_random_uuid(),
  company_id   uuid         not null references public.companies(id) on delete cascade,
  service_name text         not null,
  unit         text         not null default 'Serviço',
  price        numeric(12,4) not null default 0,
  notes        text,
  active       boolean      not null default true,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now(),
  unique(company_id, service_name)
);

-- Tabelas Comerciais
create table if not exists public.pricing_commercial_tables (
  id               uuid         primary key default gen_random_uuid(),
  company_id       uuid         not null references public.companies(id) on delete cascade,
  name             text         not null,
  description      text,
  adjustment_type  text         not null default 'desconto'
    check (adjustment_type in ('desconto','acrescimo','multiplicador')),
  adjustment_value numeric(10,4) not null default 0,
  active           boolean      not null default true,
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now(),
  unique(company_id, name)
);

-- Histórico de alterações
create table if not exists public.pricing_change_log (
  id           uuid         primary key default gen_random_uuid(),
  company_id   uuid         not null,
  user_id      uuid         references public.profiles(id) on delete set null,
  table_name   text         not null,
  record_id    uuid,
  operation    text         not null,
  old_data     jsonb,
  new_data     jsonb,
  reason       text,
  created_at   timestamptz  not null default now()
);

-- RLS
alter table public.pricing_paints              enable row level security;
alter table public.pricing_special_parts       enable row level security;
alter table public.pricing_services            enable row level security;
alter table public.pricing_commercial_tables   enable row level security;
alter table public.pricing_change_log          enable row level security;

-- Políticas de isolamento por empresa
create policy "pricing_paints_company"
  on public.pricing_paints
  using (company_id = (select company_id from public.profiles where id = auth.uid()));

create policy "pricing_special_parts_company"
  on public.pricing_special_parts
  using (company_id = (select company_id from public.profiles where id = auth.uid()));

create policy "pricing_services_company"
  on public.pricing_services
  using (company_id = (select company_id from public.profiles where id = auth.uid()));

create policy "pricing_commercial_tables_company"
  on public.pricing_commercial_tables
  using (company_id = (select company_id from public.profiles where id = auth.uid()));

create policy "pricing_change_log_company"
  on public.pricing_change_log
  using (company_id = (select company_id from public.profiles where id = auth.uid()));

-- Trigger de log automático
create or replace function public.log_pricing_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.pricing_change_log(company_id, user_id, table_name, record_id, operation, old_data, new_data)
  values (
    coalesce(NEW.company_id, OLD.company_id),
    auth.uid(),
    TG_TABLE_NAME,
    coalesce(NEW.id, OLD.id),
    TG_OP,
    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end
  );
  return coalesce(NEW, OLD);
end $$;

create trigger pricing_paints_log
  after insert or update or delete on public.pricing_paints
  for each row execute function public.log_pricing_change();

create trigger pricing_special_parts_log
  after insert or update or delete on public.pricing_special_parts
  for each row execute function public.log_pricing_change();

create trigger pricing_services_log
  after insert or update or delete on public.pricing_services
  for each row execute function public.log_pricing_change();

create trigger pricing_commercial_tables_log
  after insert or update or delete on public.pricing_commercial_tables
  for each row execute function public.log_pricing_change();
