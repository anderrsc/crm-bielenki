-- Security and integrity corrections identified in the full system audit.

begin;

update public.gutter_prices set thickness=case thickness
  when '0.43 mm' then '0.43 mm' when '0.5 mm' then '0.50 mm'
  when '0.6 mm' then '0.60 mm' when '0.7 mm' then '0.70 mm'
  when '1.0 mm' then '1.00 mm' else thickness end;
update public.gutter_prices set product='Calha de Beiral' where product='Calha Beiral';

alter table public.financial_entries add column if not exists interest_amount numeric(14,2) not null default 0 check(interest_amount>=0);
alter table public.financial_entries add column if not exists discount_amount numeric(14,2) not null default 0 check(discount_amount>=0);
alter table public.financial_entries add column if not exists installment_count integer not null default 1 check(installment_count between 1 and 60);
alter table public.financial_entries add column if not exists first_installment_due_date date;
alter table public.payments add column if not exists reversed_at timestamptz;
alter table public.payments add column if not exists reversed_by uuid references public.profiles(id);
alter table public.payments add column if not exists reversal_notes text;

create table if not exists public.financial_installments(
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  financial_entry_id uuid not null references public.financial_entries(id) on delete cascade,
  installment_number integer not null, amount numeric(14,2) not null check(amount>0),
  due_date date not null, paid_amount numeric(14,2) not null default 0 check(paid_amount>=0),
  status text not null default 'aberta' check(status in ('aberta','parcial','paga','vencida')),
  unique(financial_entry_id,installment_number)
);
alter table public.financial_installments enable row level security;
create policy financial_installments_select on public.financial_installments for select using(company_id=public.current_company_id() and public.has_table_access('financial_entries','select'));
create policy financial_installments_insert on public.financial_installments for insert with check(company_id=public.current_company_id() and public.has_table_access('financial_entries','update'));
create policy financial_installments_update on public.financial_installments for update using(company_id=public.current_company_id() and public.has_table_access('financial_entries','update')) with check(company_id=public.current_company_id());
create policy financial_installments_delete on public.financial_installments for delete using(company_id=public.current_company_id() and public.has_table_access('financial_entries','update'));

-- The previous migration recreated this view as a definer view without a tenant
-- predicate. security_invoker keeps the underlying financial_entries RLS active.
drop view if exists public.v_financial_entries;
create view public.v_financial_entries with (security_invoker=true) as
select
  fe.id, fe.company_id, fe.description, fe.entry_type, fe.origin,
  fe.total_amount, fe.paid_amount, fe.open_amount, fe.interest_amount, fe.discount_amount, fe.installment_count, fe.first_installment_due_date, fe.due_date, fe.status,
  fe.payment_method, fe.paid_at, fe.notes, fe.created_at,
  fe.client_id, fe.supplier_id, fe.sale_id, fe.purchase_order_id,
  case
    when fe.status = 'pago' then 'pago'
    when fe.status = 'cancelado' then 'cancelado'
    when fe.due_date < current_date then 'vencido'
    when fe.due_date = current_date then 'vence_hoje'
    when fe.status = 'parcialmente_pago' then 'parcialmente_pago'
    else 'aguardando_pagamento'
  end as display_status,
  c.name as client_name,
  s.name as supplier_name
from public.financial_entries fe
left join public.clients c on c.id = fe.client_id and c.company_id = fe.company_id
left join public.suppliers s on s.id = fe.supplier_id and s.company_id = fe.company_id;
grant select on public.v_financial_entries to authenticated;

create or replace function public.require_table_access(p_resource text, p_action text)
returns void language plpgsql stable security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_table_access(p_resource, p_action) then
    raise exception 'Sem permissao para realizar esta operacao' using errcode='42501';
  end if;
end $$;
revoke all on function public.require_table_access(text,text) from public;
grant execute on function public.require_table_access(text,text) to authenticated;

-- Preserve the established transactional implementations behind guarded wrappers.
alter function public.create_gutter_quote(jsonb) rename to create_gutter_quote_unchecked;
revoke all on function public.create_gutter_quote_unchecked(jsonb) from public, authenticated;
create function public.create_gutter_quote(p_payload jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
begin
  perform public.require_table_access('quotes','insert');
  return public.create_gutter_quote_unchecked(p_payload);
end $$;
grant execute on function public.create_gutter_quote(jsonb) to authenticated;

alter function public.approve_quote(uuid,date) rename to approve_quote_unchecked;
revoke all on function public.approve_quote_unchecked(uuid,date) from public, authenticated;
create function public.approve_quote(p_quote_id uuid, p_due_date date default null) returns uuid
language plpgsql security definer set search_path=public as $$
begin
  perform public.require_table_access('quotes','update');
  perform public.require_table_access('sales','insert');
  return public.approve_quote_unchecked(p_quote_id,p_due_date);
end $$;
grant execute on function public.approve_quote(uuid,date) to authenticated;

alter function public.create_manual_sale(jsonb) rename to create_manual_sale_unchecked;
revoke all on function public.create_manual_sale_unchecked(jsonb) from public, authenticated;
create function public.create_manual_sale(p_payload jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
begin
  perform public.require_table_access('sales','insert');
  return public.create_manual_sale_unchecked(p_payload);
end $$;
grant execute on function public.create_manual_sale(jsonb) to authenticated;

alter function public.create_manual_purchase(jsonb) rename to create_manual_purchase_unchecked;
revoke all on function public.create_manual_purchase_unchecked(jsonb) from public, authenticated;
create function public.create_manual_purchase(p_payload jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
begin
  perform public.require_table_access('purchase_orders','insert');
  return public.create_manual_purchase_unchecked(p_payload);
end $$;
grant execute on function public.create_manual_purchase(jsonb) to authenticated;

create or replace function public.update_gutter_quote(p_quote_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_company_id(); q public.quotes; gutter_id uuid; item jsonb; subtotal_value numeric:=0;
begin
  perform public.require_table_access('quotes','update');
  select * into q from public.quotes where id=p_quote_id and company_id=c for update;
  if q.id is null then raise exception 'Orcamento nao encontrado'; end if;
  if q.status='aprovado' then raise exception 'Orcamento aprovado nao pode ser editado'; end if;
  if not exists(select 1 from public.clients where id=(p_payload->>'client_id')::uuid and company_id=c) then raise exception 'Cliente invalido'; end if;
  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then raise exception 'Informe ao menos um item'; end if;
  select coalesce(sum((i->>'quantity')::numeric*(i->>'meters')::numeric*(i->>'unit_price')::numeric),0)
    into subtotal_value from jsonb_array_elements(p_payload->'items') i;
  if subtotal_value<=0 then raise exception 'Total do orcamento deve ser positivo'; end if;
  select id into gutter_id from public.gutter_quotes where quote_id=q.id;
  if gutter_id is null then raise exception 'Orcamento nao e do tipo calhas'; end if;
  delete from public.gutter_quote_items where gutter_quote_id=gutter_id;
  delete from public.quote_items where quote_id=q.id;
  update public.quotes set client_id=(p_payload->>'client_id')::uuid,subtotal=subtotal_value,
    discount=coalesce((p_payload->>'discount')::numeric,0),freight=coalesce((p_payload->>'freight')::numeric,0),
    notes=p_payload->>'notes',valid_until=nullif(p_payload->>'valid_until','')::date,
    installation_deadline=nullif(p_payload->>'installation_deadline',''),updated_at=now()
  where id=q.id;
  for item in select * from jsonb_array_elements(p_payload->'items') loop
    if (item->>'quantity')::numeric<=0 or (item->>'meters')::numeric<=0 or (item->>'unit_price')::numeric<0 then raise exception 'Item invalido'; end if;
    insert into public.gutter_quote_items(company_id,gutter_quote_id,product,thickness,cut,color,quantity,meters,unit_price)
    values(c,gutter_id,item->>'product',item->>'thickness',item->>'cut',item->>'color',(item->>'quantity')::numeric,(item->>'meters')::numeric,(item->>'unit_price')::numeric);
    insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production)
    values(c,q.id,item->>'product',(item->>'thickness')||' - corte '||(item->>'cut'),'m',(item->>'quantity')::numeric*(item->>'meters')::numeric,(item->>'unit_price')::numeric,true,true);
  end loop;
  return q.id;
end $$;
revoke all on function public.update_gutter_quote(uuid,jsonb) from public;
grant execute on function public.update_gutter_quote(uuid,jsonb) to authenticated;

create or replace function public.duplicate_quote(p_quote_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_company_id(); source public.quotes; target uuid; old_gutter uuid; new_gutter uuid;
begin
  perform public.require_table_access('quotes','insert');
  select * into source from public.quotes where id=p_quote_id and company_id=c;
  if source.id is null then raise exception 'Orcamento nao encontrado'; end if;
  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,status,valid_until,installation_deadline,notes,seller_name,payment_methods,client_notes)
  values(c,public.next_number('ORC','public.quotes',c),source.client_id,source.sale_type_id,auth.uid(),source.subtotal,source.discount,source.freight,'rascunho',current_date+15,source.installation_deadline,source.notes,source.seller_name,source.payment_methods,source.client_notes)
  returning id into target;
  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production)
  select c,target,product,description,unit,quantity,unit_price,requires_purchase,requires_production from public.quote_items where quote_id=source.id;
  select id into old_gutter from public.gutter_quotes where quote_id=source.id;
  if old_gutter is not null then
    insert into public.gutter_quotes(company_id,quote_id) values(c,target) returning id into new_gutter;
    insert into public.gutter_quote_items(company_id,gutter_quote_id,product,thickness,cut,color,quantity,meters,unit_price)
    select c,new_gutter,product,thickness,cut,color,quantity,meters,unit_price from public.gutter_quote_items where gutter_quote_id=old_gutter;
  end if;
  return target;
end $$;
revoke all on function public.duplicate_quote(uuid) from public;
grant execute on function public.duplicate_quote(uuid) to authenticated;

create or replace function public.delete_draft_quote(p_quote_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.require_table_access('quotes','delete');
  if not exists(select 1 from public.quotes where id=p_quote_id and company_id=public.current_company_id() and status<>'aprovado') then
    raise exception 'Somente orcamentos nao aprovados podem ser excluidos';
  end if;
  delete from public.quotes where id=p_quote_id and company_id=public.current_company_id();
end $$;
revoke all on function public.delete_draft_quote(uuid) from public;
grant execute on function public.delete_draft_quote(uuid) to authenticated;

create or replace function public.create_window_quote(p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_company_id(); sale_type uuid; quote_id uuid; item jsonb; subtotal_value numeric:=0;
begin
  perform public.require_table_access('quotes','insert');
  if not exists(select 1 from public.clients where id=(p_payload->>'client_id')::uuid and company_id=c) then raise exception 'Cliente invalido'; end if;
  select id into sale_type from public.sale_types where company_id=c and name ilike 'Esquadrias%' and active limit 1;
  if sale_type is null then raise exception 'Tipo de venda Esquadrias nao configurado'; end if;
  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then raise exception 'Informe ao menos um item'; end if;
  select coalesce(sum((i->>'quantity')::numeric*(i->>'unit_price')::numeric),0) into subtotal_value from jsonb_array_elements(p_payload->'items') i;
  if subtotal_value<=0 then raise exception 'Total deve ser positivo'; end if;
  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,notes,valid_until,installation_deadline)
  values(c,public.next_number('ORC','public.quotes',c),(p_payload->>'client_id')::uuid,sale_type,auth.uid(),subtotal_value,
    coalesce((p_payload->>'discount')::numeric,0),coalesce((p_payload->>'freight')::numeric,0),p_payload->>'notes',
    nullif(p_payload->>'valid_until','')::date,nullif(p_payload->>'installation_deadline','')) returning id into quote_id;
  for item in select * from jsonb_array_elements(p_payload->'items') loop
    if (item->>'quantity')::numeric<=0 or (item->>'unit_price')::numeric<0 then raise exception 'Item invalido'; end if;
    insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production)
    values(c,quote_id,item->>'product',concat_ws(' | ',nullif(item->>'line',''),nullif(item->>'measurements',''),nullif(item->>'glass',''),nullif(item->>'accessories',''),nullif(item->>'color','')),
      'un',(item->>'quantity')::numeric,(item->>'unit_price')::numeric,true,true);
  end loop;
  return quote_id;
end $$;
revoke all on function public.create_window_quote(jsonb) from public;
grant execute on function public.create_window_quote(jsonb) to authenticated;

-- Enforce permission checks inside definer RPCs. These checks cannot be left to
-- RLS because SECURITY DEFINER intentionally bypasses the caller's table RLS.
create or replace function public.register_payment(p_entry_id uuid, p_amount numeric, p_paid_at date, p_method text, p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare e public.financial_entries; pid uuid; total_paid numeric;
begin
  perform public.require_table_access('payments','insert');
  perform public.require_table_access('financial_entries','update');
  select * into e from public.financial_entries
    where id=p_entry_id and company_id=public.current_company_id() for update;
  if e.id is null then raise exception 'Lancamento nao encontrado'; end if;
  if p_amount is null or p_amount<=0 or p_amount>e.open_amount then
    raise exception 'Valor invalido ou superior ao saldo aberto';
  end if;
  insert into public.payments(company_id,financial_entry_id,amount,paid_at,payment_method,notes,created_by)
  values(e.company_id,e.id,p_amount,p_paid_at,p_method,p_notes,auth.uid()) returning id into pid;
  select coalesce(sum(amount),0) into total_paid from public.payments where financial_entry_id=e.id and reversed_at is null;
  update public.financial_entries set
    paid_amount=total_paid,
    paid_at=case when total_paid>=total_amount then p_paid_at else null end,
    payment_method=p_method,
    status=case when total_paid>=total_amount then 'pago'::public.financial_status else 'parcialmente_pago'::public.financial_status end
  where id=e.id;
  if e.sale_id is not null then
    update public.sales set paid_amount=total_paid,
      financial_status=case when total_paid>=total then 'pago'::public.financial_status else 'parcialmente_pago'::public.financial_status end
    where id=e.sale_id and company_id=e.company_id;
  end if;
  if e.purchase_order_id is not null then
    update public.purchase_orders set paid_amount=total_paid
    where id=e.purchase_order_id and company_id=e.company_id;
  end if;
  return pid;
end $$;

create or replace function public.register_payment_with_adjustment(
  p_entry_id uuid, p_amount numeric, p_paid_at date, p_method text,
  p_notes text default null, p_interest numeric default 0, p_discount numeric default 0,
  p_installments integer default 1, p_first_due_date date default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare e public.financial_entries; base_amount numeric; adjusted_total numeric; installment_amount numeric; allocated numeric:=0; i integer; payment_id uuid; remaining numeric; part record; part_paid numeric;
begin
  perform public.require_table_access('payments','insert');
  perform public.require_table_access('financial_entries','update');
  select * into e from public.financial_entries where id=p_entry_id and company_id=public.current_company_id() for update;
  if e.id is null then raise exception 'Lancamento nao encontrado'; end if;
  if p_interest<0 or p_discount<0 then raise exception 'Juros e desconto devem ser positivos'; end if;
  base_amount:=e.total_amount-e.interest_amount+e.discount_amount;
  adjusted_total:=greatest(base_amount+p_interest-p_discount,0);
  if adjusted_total<e.paid_amount then raise exception 'Desconto inferior ao valor ja pago'; end if;
  if p_installments<1 or p_installments>60 then raise exception 'Quantidade de parcelas invalida'; end if;
  if e.paid_amount>0 and p_installments<>e.installment_count then raise exception 'Parcelamento nao pode mudar apos o primeiro pagamento'; end if;
  update public.financial_entries set total_amount=adjusted_total,interest_amount=p_interest,discount_amount=p_discount,
    installment_count=p_installments,first_installment_due_date=coalesce(p_first_due_date,due_date,current_date) where id=e.id;
  if e.paid_amount=0 then
    delete from public.financial_installments where financial_entry_id=e.id;
    installment_amount:=trunc((adjusted_total/p_installments)::numeric,2);
    for i in 1..p_installments loop
      insert into public.financial_installments(company_id,financial_entry_id,installment_number,amount,due_date)
      values(e.company_id,e.id,i,case when i=p_installments then adjusted_total-allocated else installment_amount end,
        coalesce(p_first_due_date,e.due_date,current_date)+(i-1)*interval '1 month');
      allocated:=allocated+installment_amount;
    end loop;
  end if;
  payment_id:=public.register_payment(p_entry_id,p_amount,p_paid_at,p_method,p_notes);
  select paid_amount into remaining from public.financial_entries where id=e.id;
  for part in select id,amount,due_date from public.financial_installments where financial_entry_id=e.id order by installment_number loop
    part_paid:=least(part.amount,greatest(remaining,0));remaining:=remaining-part_paid;
    update public.financial_installments set paid_amount=part_paid,status=case when part_paid>=part.amount then 'paga' when part_paid>0 then 'parcial' when part.due_date<current_date then 'vencida' else 'aberta' end where id=part.id;
  end loop;
  return payment_id;
end $$;
revoke all on function public.register_payment_with_adjustment(uuid,numeric,date,text,text,numeric,numeric,integer,date) from public;
grant execute on function public.register_payment_with_adjustment(uuid,numeric,date,text,text,numeric,numeric,integer,date) to authenticated;

create or replace function public.reverse_payment(p_payment_id uuid, p_notes text default null)
returns void language plpgsql security definer set search_path=public as $$
declare p public.payments; e public.financial_entries; total_paid numeric; remaining numeric; part record; part_paid numeric;
begin
  perform public.require_table_access('payments','update');
  select * into p from public.payments where id=p_payment_id and company_id=public.current_company_id() for update;
  if p.id is null or p.reversed_at is not null then raise exception 'Pagamento invalido ou ja estornado'; end if;
  update public.payments set reversed_at=now(),reversed_by=auth.uid(),reversal_notes=p_notes where id=p.id;
  select * into e from public.financial_entries where id=p.financial_entry_id for update;
  select coalesce(sum(amount),0) into total_paid from public.payments where financial_entry_id=e.id and reversed_at is null;
  update public.financial_entries set paid_amount=total_paid,paid_at=null,
    status=case when total_paid=0 then 'aguardando_pagamento'::public.financial_status else 'parcialmente_pago'::public.financial_status end
  where id=e.id;
  remaining:=total_paid;
  for part in select id,amount,due_date from public.financial_installments where financial_entry_id=e.id order by installment_number loop
    part_paid:=least(part.amount,greatest(remaining,0));remaining:=remaining-part_paid;
    update public.financial_installments set paid_amount=part_paid,status=case when part_paid>=part.amount then 'paga' when part_paid>0 then 'parcial' when part.due_date<current_date then 'vencida' else 'aberta' end where id=part.id;
  end loop;
  if e.sale_id is not null then update public.sales set paid_amount=total_paid,
    financial_status=case when total_paid=0 then 'aguardando_pagamento'::public.financial_status else 'parcialmente_pago'::public.financial_status end
    where id=e.sale_id and company_id=e.company_id; end if;
  if e.purchase_order_id is not null then update public.purchase_orders set paid_amount=total_paid where id=e.purchase_order_id and company_id=e.company_id; end if;
end $$;
revoke all on function public.reverse_payment(uuid,text) from public;
grant execute on function public.reverse_payment(uuid,text) to authenticated;

create or replace function public.receive_purchase_item(p_item_id uuid, p_quantity numeric, p_location_id uuid, p_unit_cost numeric default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare i public.purchase_order_items; movement uuid; all_received boolean; prod uuid;
begin
  perform public.require_table_access('purchase_order_items','update');
  perform public.require_table_access('stock_movements','insert');
  select * into i from public.purchase_order_items
    where id=p_item_id and company_id=public.current_company_id() for update;
  if i.id is null or i.material_id is null then raise exception 'Item ou material invalido'; end if;
  if p_quantity is null or p_quantity<=0 or p_quantity>i.pending_quantity then raise exception 'Quantidade excede o saldo pendente'; end if;
  if not exists(select 1 from public.stock_locations where id=p_location_id and company_id=i.company_id and active) then
    raise exception 'Local de estoque invalido';
  end if;
  update public.purchase_order_items set
    received_quantity=received_quantity+p_quantity,
    status=case when received_quantity+p_quantity>=purchased_quantity then 'recebido_completo' else 'recebido_parcial' end
  where id=i.id;
  insert into public.stock_movements(company_id,material_id,location_id,movement_type,quantity,unit_cost,purchase_order_item_id,order_id,notes,created_by)
  values(i.company_id,i.material_id,p_location_id,'entrada',p_quantity,coalesce(p_unit_cost,i.unit_price),i.id,i.order_id,p_notes,auth.uid())
  returning id into movement;
  select bool_and(pending_quantity=0) into all_received
  from public.purchase_order_items where purchase_order_id=i.purchase_order_id;
  update public.purchase_orders set
    status=case when all_received then 'recebido_completo' else 'recebido_parcial' end,
    received_at=case when all_received then current_date else null end
  where id=i.purchase_order_id and company_id=i.company_id;
  if i.order_id is not null then
    update public.production_materials pm set
      received_quantity=least(pm.required_quantity,pm.received_quantity+p_quantity),
      status=case when pm.received_quantity+p_quantity>=pm.required_quantity then 'recebido_completo' else 'recebido_parcial' end
    from public.production_orders po
    where pm.production_order_id=po.id and po.order_id=i.order_id and pm.material_id=i.material_id
    returning pm.production_order_id into prod;
    if prod is not null and not exists(
      select 1 from public.production_materials where production_order_id=prod and required and received_quantity<required_quantity
    ) then
      update public.production_orders set status='liberado' where id=prod and company_id=i.company_id;
      update public.orders set production_status='liberado',purchase_status='recebido_completo'
      where id=i.order_id and company_id=i.company_id;
    end if;
  end if;
  return movement;
end $$;

-- Exact summaries are calculated in the database instead of over a truncated UI page.
create or replace function public.financial_summary(p_entry_type text default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c uuid:=public.current_company_id(); result jsonb;
begin
  perform public.require_table_access('financial_entries','select');
  select jsonb_build_object(
    'open_amount', coalesce(sum(open_amount) filter(where open_amount>0 and status<>'cancelado'),0),
    'open_count', count(*) filter(where open_amount>0 and status<>'cancelado'),
    'overdue_amount', coalesce(sum(open_amount) filter(where open_amount>0 and due_date<current_date and status not in ('pago','cancelado')),0),
    'overdue_count', count(*) filter(where open_amount>0 and due_date<current_date and status not in ('pago','cancelado')),
    'due_today_count', count(*) filter(where open_amount>0 and due_date=current_date and status not in ('pago','cancelado')),
    'done_count', count(*) filter(where status in ('pago','cancelado')),
    'total_count', count(*)
  ) into result
  from public.financial_entries
  where company_id=c and (p_entry_type is null or entry_type::text=p_entry_type);
  return result;
end $$;
revoke all on function public.financial_summary(text) from public;
grant execute on function public.financial_summary(text) to authenticated;

-- Tenant integrity for role assignments.
create or replace function public.validate_user_role_company()
returns trigger language plpgsql security definer set search_path=public as $$
declare profile_company uuid;
begin
  select company_id into profile_company from public.profiles where id=new.profile_id;
  if profile_company is null or profile_company<>new.company_id then
    raise exception 'Perfil nao pertence a empresa informada';
  end if;
  return new;
end $$;
drop trigger if exists user_roles_company_guard on public.user_roles;
create trigger user_roles_company_guard before insert or update on public.user_roles
for each row execute function public.validate_user_role_company();

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
using(
  id=auth.uid() or
  (company_id=public.current_company_id() and public.has_role(array['administrador','gerente']::public.app_role[]))
)
with check(company_id=public.current_company_id());

drop policy if exists permissions_admin_update on public.permissions;
create policy permissions_admin_update on public.permissions for update
using(public.has_role(array['administrador']::public.app_role[]))
with check(public.has_role(array['administrador']::public.app_role[]));

create or replace function public.replace_user_roles(p_profile_id uuid, p_roles public.app_role[])
returns void language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_company_id(); target_company uuid; current_is_admin boolean; requested_admin boolean;
begin
  if not public.has_role(array['administrador','gerente']::public.app_role[]) then
    raise exception 'Sem permissao para alterar cargos' using errcode='42501';
  end if;
  select company_id into target_company from public.profiles where id=p_profile_id;
  if target_company is null or target_company<>c then raise exception 'Funcionario invalido'; end if;
  current_is_admin:=exists(select 1 from public.user_roles where profile_id=p_profile_id and role='administrador');
  requested_admin:='administrador'=any(coalesce(p_roles,array[]::public.app_role[]));
  if current_is_admin and not requested_admin and
     (select count(*) from public.user_roles where company_id=c and role='administrador')<=1 then
    raise exception 'A empresa deve manter ao menos um administrador';
  end if;
  delete from public.user_roles where profile_id=p_profile_id and company_id=c;
  insert into public.user_roles(company_id,profile_id,role)
  select c,p_profile_id,role from unnest(coalesce(p_roles,array[]::public.app_role[])) role;
end $$;
revoke all on function public.replace_user_roles(uuid,public.app_role[]) from public;
grant execute on function public.replace_user_roles(uuid,public.app_role[]) to authenticated;

-- Production step logging needs a real conflict target and an atomic server-side transition.
delete from public.production_step_logs a using public.production_step_logs b
where a.production_order_id=b.production_order_id and a.step_number=b.step_number and a.created_at>b.created_at;
create unique index if not exists production_step_logs_order_step_unique
  on public.production_step_logs(production_order_id,step_number);

create or replace function public.advance_production_step(
  p_production_order_id uuid, p_responsible_id uuid default null, p_notes text default null
) returns integer language plpgsql security definer set search_path=public as $$
declare po public.production_orders; total_steps integer; step_name text; next_step integer;
begin
  perform public.require_table_access('production_orders','update');
  select * into po from public.production_orders
    where id=p_production_order_id and company_id=public.current_company_id() for update;
  if po.id is null then raise exception 'Ordem de producao nao encontrada'; end if;
  total_steps:=case when po.flow_type='esquadrias' then 9 else 7 end;
  if po.current_step<1 or po.current_step>total_steps then raise exception 'Fluxo de producao ja finalizado'; end if;
  if p_responsible_id is not null and not exists(
    select 1 from public.profiles where id=p_responsible_id and company_id=po.company_id and status='ativo'
  ) then raise exception 'Responsavel invalido'; end if;
  step_name:=(case when po.flow_type='esquadrias' then
    array['Medicao','Projeto','Corte','Usinagem','Montagem','Solda','Acabamento','Pintura','Controle de Qualidade']
  else array['Medicao','Corte','Dobra','Pintura','Agendamento','Instalacao','Pos-venda'] end)[po.current_step];
  insert into public.production_step_logs(
    company_id,production_order_id,step_number,step_name,started_at,completed_at,responsible_id,notes
  ) values(po.company_id,po.id,po.current_step,step_name,now(),now(),p_responsible_id,p_notes)
  on conflict(production_order_id,step_number) do update set
    step_name=excluded.step_name,completed_at=excluded.completed_at,
    responsible_id=excluded.responsible_id,notes=excluded.notes;
  next_step:=po.current_step+1;
  update public.production_orders set current_step=next_step,
    status=case when next_step>total_steps then 'finalizado' else 'em_producao' end
  where id=po.id;
  return next_step;
end $$;
revoke all on function public.advance_production_step(uuid,uuid,text) from public;
grant execute on function public.advance_production_step(uuid,uuid,text) to authenticated;

-- Existing installations may have been created before these columns were introduced.
alter table public.installation_checklists add column if not exists required boolean not null default true;
alter table public.installation_checklists add column if not exists completed_by uuid references public.profiles(id);
alter table public.installation_checklists add column if not exists updated_at timestamptz not null default now();

-- Replace the broad bootstrap matrix with least-privilege defaults for existing rows.
update public.permissions set can_view=false,can_create=false,can_update=false,can_delete=false
where role not in ('administrador','gerente');
update public.permissions set can_view=true,can_create=true,can_update=true
where role in ('vendedor','atendente') and resource in ('clients','quotes','sales','orders','leads','activities','tasks','followups','conversations','messages');
update public.permissions set can_view=true,can_create=true,can_update=true
where role='compras' and resource in ('suppliers','purchase_requests','purchase_request_items','purchase_orders','purchase_order_items','materials','stock_locations','stock_movements');
update public.permissions set can_view=true,can_update=true
where role in ('producao','estoque') and resource in ('orders','order_checklist_items','materials','stock_locations','stock_movements','production_orders','production_order_items','production_materials');
update public.permissions set can_view=true,can_update=true
where role='instalador' and resource in ('orders','installations','installation_checklists','tasks');
update public.permissions set can_view=true,can_create=true,can_update=true
where role='financeiro' and resource in ('clients','sales','orders','financial_entries','payments','commissions','tasks');

commit;
