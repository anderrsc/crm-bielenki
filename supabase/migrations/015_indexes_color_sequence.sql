-- 7. Coluna color em gutter_quote_items
alter table public.gutter_quote_items
  add column if not exists color text;

-- 8. Sequences thread-safe para next_number
-- quotes
create sequence if not exists public.seq_quote_number start 1;
create or replace function public.next_quote_number(p_company_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_num int;
begin
  select nextval('public.seq_quote_number') into v_num;
  return 'ORC-' || lpad(v_num::text, 5, '0');
end;$$;

-- orders
create sequence if not exists public.seq_order_number start 1;
create or replace function public.next_order_number(p_company_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_num int;
begin
  select nextval('public.seq_order_number') into v_num;
  return 'PED-' || lpad(v_num::text, 5, '0');
end;$$;

-- purchase_orders
create sequence if not exists public.seq_purchase_number start 1;
create or replace function public.next_purchase_number(p_company_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_num int;
begin
  select nextval('public.seq_purchase_number') into v_num;
  return 'COM-' || lpad(v_num::text, 5, '0');
end;$$;

-- Sincroniza sequences com valores atuais para não repetir números existentes
select setval('public.seq_quote_number',   coalesce((select count(*) from public.quotes), 0) + 1, false);
select setval('public.seq_order_number',   coalesce((select count(*) from public.orders), 0) + 1, false);
select setval('public.seq_purchase_number',coalesce((select count(*) from public.purchase_orders), 0) + 1, false);

-- 9. Índices em leads(stage_id) e leads(owner_id)
create index if not exists leads_stage_id_idx  on public.leads(stage_id);
create index if not exists leads_owner_id_idx  on public.leads(owner_id);
create index if not exists leads_company_stage on public.leads(company_id, stage_id);
