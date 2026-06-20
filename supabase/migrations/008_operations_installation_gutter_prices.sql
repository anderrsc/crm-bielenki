-- Operação de campo, recebimento e tabela real de preços de calhas.
alter table public.installation_checklists
  add column if not exists required boolean not null default true,
  add column if not exists completed_by uuid references public.profiles(id),
  add column if not exists updated_at timestamptz not null default now();

create table public.gutter_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product text not null,
  thickness text not null,
  cut_mm integer not null check(cut_mm>0),
  unit_price numeric(14,2) not null check(unit_price>=0),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,product,thickness,cut_mm)
);
alter table public.gutter_prices enable row level security;
create policy gutter_prices_read on public.gutter_prices for select to authenticated using(company_id=public.current_company_id());
create policy gutter_prices_manage on public.gutter_prices for all to authenticated
using(company_id=public.current_company_id() and public.has_role(array['administrador','gerente']::public.app_role[]))
with check(company_id=public.current_company_id() and public.has_role(array['administrador','gerente']::public.app_role[]));

create or replace function public.create_default_installation_checklist() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.installation_checklists where installation_id=new.id) then
    insert into public.installation_checklists(company_id,installation_id,title,sort_order,required)
    select new.company_id,new.id,x.title,x.ord,true from (values
      (1,'Confirmar cliente, endereço e acesso'),(2,'Conferir medidas e projeto'),(3,'Conferir peças, acessórios e ferramentas'),
      (4,'Proteger pisos, paredes e móveis'),(5,'Executar instalação e fixação'),(6,'Realizar vedação e acabamento'),
      (7,'Testar abertura, fechamento e funcionamento'),(8,'Limpar o local e recolher resíduos'),
      (9,'Registrar fotos finais'),(10,'Obter conferência/aceite do cliente')
    ) as x(ord,title);
  end if;
  return new;
end $$;
create trigger installation_default_checklist after insert on public.installations for each row execute function public.create_default_installation_checklist();

insert into public.installation_checklists(company_id,installation_id,title,sort_order,required)
select i.company_id,i.id,x.title,x.ord,true from public.installations i cross join (values
  (1,'Confirmar cliente, endereço e acesso'),(2,'Conferir medidas e projeto'),(3,'Conferir peças, acessórios e ferramentas'),
  (4,'Proteger pisos, paredes e móveis'),(5,'Executar instalação e fixação'),(6,'Realizar vedação e acabamento'),
  (7,'Testar abertura, fechamento e funcionamento'),(8,'Limpar o local e recolher resíduos'),
  (9,'Registrar fotos finais'),(10,'Obter conferência/aceite do cliente')
) as x(ord,title)
where not exists(select 1 from public.installation_checklists ic where ic.installation_id=i.id);

create or replace function public.sync_installation_checklist() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.installation_checklists where installation_id=new.installation_id) and
     not exists(select 1 from public.installation_checklists where installation_id=new.installation_id and required and not completed) then
    update public.installations set status='concluida',completed_at=coalesce(completed_at,now()) where id=new.installation_id and status<>'concluida';
  elsif exists(select 1 from public.installations where id=new.installation_id and status in ('nao_agendada','agendada')) then
    update public.installations set status='em_andamento' where id=new.installation_id;
  end if;
  return new;
end $$;
create trigger installation_checklist_progress after update of completed on public.installation_checklists for each row execute function public.sync_installation_checklist();

insert into public.permissions(role,resource,can_view,can_create,can_update,can_delete)
select role,'gutter_prices',true,false,false,false from unnest(array['vendedor','compras','producao','estoque','instalador','financeiro','atendente']::public.app_role[]) role
on conflict(role,resource) do update set can_view=true;

-- Reforça o recebimento: só libera produção quando existe uma ordem e todos os materiais obrigatórios chegaram.
create or replace function public.receive_purchase_item(p_item_id uuid,p_quantity numeric,p_location_id uuid,p_unit_cost numeric default null,p_notes text default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare i public.purchase_order_items; movement uuid; all_received boolean; prod uuid;
begin
  select * into i from public.purchase_order_items where id=p_item_id and company_id=public.current_company_id() for update;
  if i.id is null or i.material_id is null then raise exception 'Vincule um material do estoque a este item antes de receber'; end if;
  if p_quantity<=0 or p_quantity>i.pending_quantity then raise exception 'Quantidade excede o saldo pendente'; end if;
  if not exists(select 1 from public.stock_locations where id=p_location_id and company_id=i.company_id and active) then raise exception 'Local de estoque inválido'; end if;
  update public.purchase_order_items set received_quantity=received_quantity+p_quantity,status=case when received_quantity+p_quantity>=purchased_quantity then 'recebido_completo' else 'recebido_parcial' end where id=i.id;
  insert into public.stock_movements(company_id,material_id,location_id,movement_type,quantity,unit_cost,purchase_order_item_id,order_id,notes,created_by)
  values(i.company_id,i.material_id,p_location_id,'entrada',p_quantity,coalesce(p_unit_cost,i.unit_price),i.id,i.order_id,p_notes,auth.uid()) returning id into movement;
  select coalesce(bool_and(pending_quantity=0),false) into all_received from public.purchase_order_items where purchase_order_id=i.purchase_order_id;
  update public.purchase_orders set status=case when all_received then 'recebido_completo' else 'recebido_parcial' end,received_at=case when all_received then current_date else null end where id=i.purchase_order_id;
  if i.order_id is not null then
    update public.production_materials pm set received_quantity=least(pm.required_quantity,pm.received_quantity+p_quantity),status=case when pm.received_quantity+p_quantity>=pm.required_quantity then 'recebido_completo' else 'recebido_parcial' end
    from public.production_orders po where pm.production_order_id=po.id and po.order_id=i.order_id and pm.material_id=i.material_id returning pm.production_order_id into prod;
    if prod is not null and not exists(select 1 from public.production_materials where production_order_id=prod and required and received_quantity<required_quantity) then
      update public.production_orders set status='liberado' where id=prod;
      update public.orders set production_status='liberado',purchase_status='recebido_completo' where id=i.order_id;
    elsif all_received then update public.orders set purchase_status='recebido_completo' where id=i.order_id;
    end if;
  end if;
  return movement;
end $$;
