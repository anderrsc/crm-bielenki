begin;
-- Additive classification only: no existing financial history is rewritten.
create table if not exists public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check(length(btrim(name)) between 1 and 80),
  entry_type public.financial_entry_type not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,company_id,entry_type)
);
create unique index if not exists financial_categories_name_key on public.financial_categories(company_id,entry_type,lower(btrim(name)));
create table if not exists public.financial_cost_centers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check(length(btrim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,company_id)
);
create unique index if not exists financial_cost_centers_name_key on public.financial_cost_centers(company_id,lower(btrim(name)));
alter table public.financial_categories enable row level security;
alter table public.financial_cost_centers enable row level security;
revoke all on public.financial_categories, public.financial_cost_centers from public,anon,authenticated;
grant select,insert,update on public.financial_categories,public.financial_cost_centers to authenticated;
do $$ declare t text; begin
  foreach t in array array['financial_categories','financial_cost_centers'] loop
    execute format('drop policy if exists classification_select on public.%I',t);
    execute format('drop policy if exists classification_insert on public.%I',t);
    execute format('drop policy if exists classification_update on public.%I',t);
    execute format('create policy classification_select on public.%I for select to authenticated using(company_id=(select public.current_company_id()) and (select public.has_table_access(''financial_entries'',''select'')))',t);
    execute format('create policy classification_insert on public.%I for insert to authenticated with check(company_id=(select public.current_company_id()) and (select public.has_table_access(''financial_entries'',''update'')))',t);
    execute format('create policy classification_update on public.%I for update to authenticated using(company_id=(select public.current_company_id()) and (select public.has_table_access(''financial_entries'',''update''))) with check(company_id=(select public.current_company_id()) and (select public.has_table_access(''financial_entries'',''update'')))',t);
  end loop;
end $$;

alter table public.financial_entries add column if not exists category_id uuid, add column if not exists cost_center_id uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.financial_entries'::regclass and conname='financial_entry_category_company_type_fk') then
    alter table public.financial_entries add constraint financial_entry_category_company_type_fk foreign key(category_id,company_id,entry_type) references public.financial_categories(id,company_id,entry_type);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.financial_entries'::regclass and conname='financial_entry_cost_center_company_fk') then
    alter table public.financial_entries add constraint financial_entry_cost_center_company_fk foreign key(cost_center_id,company_id) references public.financial_cost_centers(id,company_id);
  end if;
end $$;
create index if not exists financial_entries_category_idx on public.financial_entries(company_id,category_id);
create index if not exists financial_entries_cost_center_idx on public.financial_entries(company_id,cost_center_id);

create or replace function public.validate_financial_classification() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.category_id is not null and (tg_op='INSERT' or new.category_id is distinct from old.category_id) then
    if not exists(select 1 from public.financial_categories c where c.id=new.category_id and c.company_id=new.company_id and c.entry_type=new.entry_type and c.active) then
      raise exception 'Categoria indisponivel para este lancamento';
    end if;
  end if;
  if new.cost_center_id is not null and (tg_op='INSERT' or new.cost_center_id is distinct from old.cost_center_id) then
    if not exists(select 1 from public.financial_cost_centers c where c.id=new.cost_center_id and c.company_id=new.company_id and c.active) then
      raise exception 'Centro de custos indisponivel';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.validate_financial_classification() from public,anon,authenticated;
drop trigger if exists financial_entry_classification_validate on public.financial_entries;
create trigger financial_entry_classification_validate before insert or update of category_id,cost_center_id,company_id,entry_type on public.financial_entries for each row execute function public.validate_financial_classification();

-- Audit writer is private and trigger-only. It cannot be invoked as a public RPC.
create schema if not exists crm_private;
revoke all on schema crm_private from public,anon,authenticated;
create or replace function crm_private.audit_financial_classification() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous jsonb; following jsonb;
begin
  if tg_table_name='financial_entries' then
    previous := case when tg_op='UPDATE' then jsonb_build_object('category_id',old.category_id,'cost_center_id',old.cost_center_id) end;
    following := jsonb_build_object('category_id',new.category_id,'cost_center_id',new.cost_center_id);
    if (tg_op='INSERT' and new.category_id is null and new.cost_center_id is null) or previous=following then return new; end if;
  elsif tg_table_name in ('financial_categories','financial_cost_centers') then
    previous:=case when tg_op='UPDATE' then to_jsonb(old) end;
    following:=to_jsonb(new);
  else raise exception 'Unsupported audit target'; end if;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values(new.company_id,auth.uid(),tg_table_name,new.id,tg_op,previous,following);
  return new;
end $$;
revoke all on function crm_private.audit_financial_classification() from public,anon,authenticated;
drop trigger if exists financial_categories_touch on public.financial_categories;
create trigger financial_categories_touch before update on public.financial_categories for each row execute function public.touch_updated_at();
drop trigger if exists financial_cost_centers_touch on public.financial_cost_centers;
create trigger financial_cost_centers_touch before update on public.financial_cost_centers for each row execute function public.touch_updated_at();
drop trigger if exists financial_categories_audit on public.financial_categories;
create trigger financial_categories_audit after insert or update on public.financial_categories for each row execute function crm_private.audit_financial_classification();
drop trigger if exists financial_cost_centers_audit on public.financial_cost_centers;
create trigger financial_cost_centers_audit after insert or update on public.financial_cost_centers for each row execute function crm_private.audit_financial_classification();
drop trigger if exists financial_entry_classification_audit on public.financial_entries;
create trigger financial_entry_classification_audit after insert or update of category_id,cost_center_id on public.financial_entries for each row execute function crm_private.audit_financial_classification();

create or replace function public.seed_financial_classifications() returns void language plpgsql security invoker set search_path=public as $$
declare cid uuid:=public.current_company_id();
begin
  perform public.require_table_access('financial_entries','update');
  if cid is null then raise exception 'Empresa nao encontrada'; end if;
  insert into public.financial_categories(company_id,name,entry_type)
    select cid,n,'pagar'::public.financial_entry_type from unnest(array['Compra de bobinas','Compra de perfis','Compra de vidros','Compra de acessórios','Pintura','Ferramentas','Equipamentos','Combustível','Frete','Salários','Encargos trabalhistas','Comissões','Benefícios','Impostos','Aluguel','Energia','Água','Internet','Sistemas','Manutenção','Terceirizações','Despesas bancárias','Despesas administrativas']) n on conflict do nothing;
  insert into public.financial_categories(company_id,name,entry_type)
    select cid,n,'receber'::public.financial_entry_type from unnest(array['Venda de calhas','Venda de esquadrias','Serviços','Outras receitas']) n on conflict do nothing;
  insert into public.financial_cost_centers(company_id,name)
    select cid,n from unnest(array['Administração','Comercial','Fábrica de calhas','Produção de esquadrias','Instalação de calhas','Instalação de esquadrias','Veículos e transporte','Manutenção','Estoque','Outros']) n on conflict do nothing;
end $$;
revoke all on function public.seed_financial_classifications() from public,anon;
grant execute on function public.seed_financial_classifications() to authenticated;

-- Append columns to preserve the order and types consumed by existing callers.
create or replace view public.v_financial_entries with (security_invoker=true) as
select fe.id,fe.company_id,fe.description,fe.entry_type,fe.origin,
  fe.total_amount,fe.paid_amount,fe.open_amount,fe.interest_amount,fe.discount_amount,fe.installment_count,fe.first_installment_due_date,fe.due_date,fe.status,
  fe.payment_method,fe.paid_at,fe.notes,fe.created_at,fe.client_id,fe.supplier_id,fe.sale_id,fe.purchase_order_id,
  case when fe.status='pago' then 'pago' when fe.status='cancelado' then 'cancelado' when fe.due_date<current_date then 'vencido' when fe.due_date=current_date then 'vence_hoje' when fe.status='parcialmente_pago' then 'parcialmente_pago' else 'aguardando_pagamento' end as display_status,
  c.name as client_name,s.name as supplier_name,sl.sale_type_id,fe.category_id,fe.cost_center_id,
  fc.name as category_name,cc.name as cost_center_name
from public.financial_entries fe
left join public.clients c on c.id=fe.client_id and c.company_id=fe.company_id
left join public.suppliers s on s.id=fe.supplier_id and s.company_id=fe.company_id
left join public.sales sl on sl.id=fe.sale_id and sl.company_id=fe.company_id
left join public.financial_categories fc on fc.id=fe.category_id and fc.company_id=fe.company_id
left join public.financial_cost_centers cc on cc.id=fe.cost_center_id and cc.company_id=fe.company_id;

commit;
