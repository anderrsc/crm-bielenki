begin;
-- Modulo Servicos: instalacoes avulsas, manutencoes, reparos, garantias e visitas tecnicas.
-- Aditivo: nao altera pedidos, instalacoes, agenda nem lancamentos existentes.
create table if not exists public.service_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  service_number text not null,
  client_id uuid not null references public.clients(id),
  order_id uuid references public.orders(id),
  quote_id uuid references public.quotes(id),
  kind text not null check(kind in ('instalacao_calhas','instalacao_esquadrias','manutencao_calhas','manutencao_esquadrias','reparo','substituicao','ajuste','garantia','visita_tecnica','outro')),
  classification text check(classification is null or classification in ('garantia','preventiva','corretiva','ajuste','problema_instalacao','dano_terceiros','adicional')),
  related_to_previous boolean not null default false,
  description text not null check(length(btrim(description)) between 1 and 2000),
  priority text not null default 'normal' check(priority in ('baixa','normal','alta','urgente')),
  status text not null default 'solicitacao_recebida' check(status in
    ('solicitacao_recebida','aguardando_avaliacao','aguardando_agendamento','visita_agendada','em_atendimento','aguardando_material','necessita_retorno','concluido','cancelado')),
  opened_at date not null default current_date,
  expected_date date,
  scheduled_at timestamptz,
  responsible_id uuid references public.profiles(id),
  team text,
  phone text, address text, neighborhood text, city text, location_url text,
  internal_notes text,
  billing text not null default 'cobrado' check(billing in ('gratuito','cobrado')),
  expected_amount numeric(14,2) check(expected_amount is null or expected_amount >= 0),
  materials_used text,
  extra_expenses numeric(14,2) not null default 0 check(extra_expenses >= 0),
  final_amount numeric(14,2) check(final_amount is null or final_amount >= 0),
  financial_entry_id uuid references public.financial_entries(id) on delete set null,
  agenda_event_id uuid references public.operational_events(id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  completion_notes text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,service_number)
);
-- Um lancamento financeiro por servico: concluir duas vezes nao cobra em dobro.
create unique index if not exists service_orders_entry_key on public.service_orders(financial_entry_id) where financial_entry_id is not null;
create index if not exists service_orders_company_status_idx on public.service_orders(company_id,status,priority);
create index if not exists service_orders_client_idx on public.service_orders(client_id);
create index if not exists service_orders_order_idx on public.service_orders(order_id);
create index if not exists service_orders_quote_idx on public.service_orders(quote_id);
create index if not exists service_orders_responsible_idx on public.service_orders(responsible_id);
create index if not exists service_orders_event_idx on public.service_orders(agenda_event_id);
create index if not exists service_orders_completed_by_idx on public.service_orders(completed_by);
create index if not exists service_orders_created_by_idx on public.service_orders(created_by);

create table if not exists public.service_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  service_id uuid not null references public.service_orders(id) on delete cascade,
  moment text not null default 'geral' check(moment in ('antes','depois','geral')),
  file_path text not null,
  original_name text not null,
  size_bytes integer not null,
  uploaded_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists service_photos_service_idx on public.service_photos(service_id);
create index if not exists service_photos_company_idx on public.service_photos(company_id);
create index if not exists service_photos_uploaded_by_idx on public.service_photos(uploaded_by);

-- Permissao propria: todos os cargos operam servicos; so a gerencia exclui.
insert into public.permissions(role,resource,can_view,can_create,can_update,can_delete)
  select r,'service_orders',true,true,true,r::text in ('administrador','gerente')
  from unnest(enum_range(null::public.app_role)) r on conflict(role,resource) do nothing;

alter table public.service_orders enable row level security;
alter table public.service_photos enable row level security;
revoke all on public.service_orders, public.service_photos from public,anon,authenticated;
grant select,insert,update on public.service_orders to authenticated;
grant select,insert,delete on public.service_photos to authenticated;
do $$ declare t text; begin
  foreach t in array array['service_orders','service_photos'] loop
    execute format('drop policy if exists service_select on public.%I',t);
    execute format('drop policy if exists service_insert on public.%I',t);
    execute format('create policy service_select on public.%I for select to authenticated using(company_id=(select public.current_company_id()) and (select public.has_table_access(''service_orders'',''select'')))',t);
    execute format('create policy service_insert on public.%I for insert to authenticated with check(company_id=(select public.current_company_id()) and (select public.has_table_access(''service_orders'',''%s'')))',t,case when t='service_orders' then 'insert' else 'update' end);
  end loop;
end $$;
drop policy if exists service_update on public.service_orders;
create policy service_update on public.service_orders for update to authenticated
  using(company_id=(select public.current_company_id()) and (select public.has_table_access('service_orders','update')))
  with check(company_id=(select public.current_company_id()));
drop policy if exists service_photo_delete on public.service_photos;
create policy service_photo_delete on public.service_photos for delete to authenticated
  using(company_id=(select public.current_company_id()) and (select public.has_table_access('service_orders','update')));

-- Cliente, pedido e orcamento precisam ser da mesma empresa; status, cobranca e agenda so mudam pelas funcoes.
create or replace function crm_private.service_orders_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.clients where id=new.client_id and company_id=new.company_id) then raise exception 'Cliente invalido'; end if;
  if new.order_id is not null and not exists(select 1 from public.orders where id=new.order_id and company_id=new.company_id) then raise exception 'Pedido invalido'; end if;
  if new.quote_id is not null and not exists(select 1 from public.quotes where id=new.quote_id and company_id=new.company_id) then raise exception 'Orcamento invalido'; end if;
  if new.responsible_id is not null and not exists(select 1 from public.profiles where id=new.responsible_id and company_id=new.company_id) then raise exception 'Responsavel invalido'; end if;
  if tg_op='INSERT' then
    new.service_number := public.next_number('SRV','public.service_orders',new.company_id);
    new.financial_entry_id := null; new.agenda_event_id := null; new.completed_at := null; new.completed_by := null;
    if new.status in ('concluido','visita_agendada') then new.status := 'solicitacao_recebida'; end if;
  elsif coalesce(current_setting('crm.service_rpc',true),'')<>'1' then
    new.company_id := old.company_id; new.service_number := old.service_number; new.status := old.status;
    new.financial_entry_id := old.financial_entry_id; new.agenda_event_id := old.agenda_event_id; new.scheduled_at := old.scheduled_at;
    new.completed_at := old.completed_at; new.completed_by := old.completed_by; new.final_amount := old.final_amount; new.completion_notes := old.completion_notes;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function crm_private.service_orders_guard() from public,anon,authenticated;
drop trigger if exists service_orders_guard on public.service_orders;
create trigger service_orders_guard before insert or update on public.service_orders for each row execute function crm_private.service_orders_guard();

create or replace function crm_private.service_for_update(p_id uuid) returns public.service_orders
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.service_orders;
begin
  if public.current_company_id() is null or not public.has_table_access('service_orders','update') then
    raise exception 'Sem permissao para atualizar servicos' using errcode='42501'; end if;
  select * into s from public.service_orders where id=p_id and company_id=public.current_company_id() for update;
  if s.id is null then raise exception 'Servico nao encontrado'; end if;
  perform set_config('crm.service_rpc','1',true);
  return s;
end $$;
revoke all on function crm_private.service_for_update(uuid) from public,anon,authenticated;

create or replace function crm_private.service_log(s public.service_orders, p_action text, p_new jsonb) returns void
language sql security definer set search_path=pg_catalog,public as $$
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
  values(s.company_id,auth.uid(),'service_orders',s.id,p_action,jsonb_build_object('status',s.status),p_new);
$$;
revoke all on function crm_private.service_log(public.service_orders,text,jsonb) from public,anon,authenticated;

-- Muda a situacao (menos concluir e agendar, que tem funcao propria).
create or replace function public.service_set_status(p_id uuid, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.service_orders := crm_private.service_for_update(p_id);
begin
  if p_status not in ('solicitacao_recebida','aguardando_avaliacao','aguardando_agendamento','em_atendimento','aguardando_material','necessita_retorno','cancelado') then
    raise exception 'Situacao invalida'; end if;
  if s.status='concluido' then raise exception 'Servico concluido nao muda de situacao'; end if;
  if s.status=p_status then return; end if;
  update public.service_orders set status=p_status where id=s.id;
  if p_status in ('cancelado','necessita_retorno','aguardando_agendamento') and s.agenda_event_id is not null then
    update public.operational_events set status=case when p_status='cancelado' then 'cancelado' else 'concluido' end, updated_at=now()
      where id=s.agenda_event_id and status not in ('concluido','cancelado');
    if p_status<>'cancelado' then update public.service_orders set agenda_event_id=null, scheduled_at=null where id=s.id; end if;
  end if;
  perform crm_private.service_log(s,'STATUS',jsonb_build_object('status',p_status,'observacoes',p_notes));
end $$;

-- Agenda (ou reagenda) a visita e cria o compromisso na Agenda.
create or replace function public.service_schedule(p_id uuid, p_at timestamptz, p_responsible uuid default null, p_team text default null, p_notes text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.service_orders := crm_private.service_for_update(p_id); ev uuid := s.agenda_event_id; label text;
begin
  if p_at is null then raise exception 'Informe a data da visita'; end if;
  if s.status in ('concluido','cancelado') then raise exception 'Servico encerrado nao pode ser agendado'; end if;
  if p_responsible is not null and not exists(select 1 from public.profiles where id=p_responsible and company_id=s.company_id and status='ativo') then raise exception 'Responsavel invalido'; end if;
  label := case when s.kind like 'instalacao%' then 'Instalação' when s.kind='visita_tecnica' then 'Visita técnica' else 'Manutenção' end;
  if ev is not null and exists(select 1 from public.operational_events where id=ev and status not in ('concluido','cancelado')) then
    update public.operational_events set starts_at=p_at, responsible_id=p_responsible, notes=nullif(btrim(coalesce(p_notes,'')),''), status='agendado', updated_at=now() where id=ev;
  else
    insert into public.operational_events(company_id,event_type,title,client_id,order_id,responsible_id,starts_at,address,phone,status,notes,created_by)
    select s.company_id, case when s.kind like 'instalacao%' then 'instalacao' when s.kind='visita_tecnica' then 'outro' else 'manutencao' end,
      label||' - '||s.service_number||' - '||c.name, s.client_id, s.order_id, p_responsible, p_at,
      nullif(concat_ws(', ',nullif(coalesce(s.address,c.address),''),nullif(coalesce(s.neighborhood,c.neighborhood),''),nullif(coalesce(s.city,c.city),'')),''),
      coalesce(nullif(s.phone,''),nullif(c.whatsapp,''),c.phone),'agendado',nullif(btrim(coalesce(p_notes,'')),''),auth.uid()
    from public.clients c where c.id=s.client_id returning id into ev;
  end if;
  update public.service_orders set status='visita_agendada', scheduled_at=p_at, responsible_id=coalesce(p_responsible,responsible_id),
    team=coalesce(nullif(btrim(coalesce(p_team,'')),''),team), agenda_event_id=ev where id=s.id;
  perform crm_private.service_log(s,'AGENDADO',jsonb_build_object('status','visita_agendada','data',p_at,'responsavel',p_responsible));
end $$;

-- Conclui o servico. Se for cobrado e tiver valor, cria UMA conta a receber no Financeiro.
create or replace function public.service_complete(p_id uuid, p_done text, p_final numeric default null, p_materials text default null, p_expenses numeric default null, p_due date default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.service_orders := crm_private.service_for_update(p_id); entry uuid := s.financial_entry_id; amount numeric(14,2);
begin
  if s.status='cancelado' then raise exception 'Servico cancelado nao pode ser concluido'; end if;
  if s.status='concluido' then return entry; end if; -- clique repetido
  if nullif(btrim(coalesce(p_done,'')),'') is null then raise exception 'Descreva o que foi executado'; end if;
  if coalesce(p_final,0) < 0 or coalesce(p_expenses,0) < 0 then raise exception 'Valor invalido'; end if;
  amount := case when s.billing='cobrado' then round(coalesce(p_final, s.expected_amount, 0),2) else 0 end;
  if amount > 0 and entry is null then
    insert into public.financial_entries(company_id,entry_type,origin,client_id,description,total_amount,due_date)
      values(s.company_id,'receber','manual',s.client_id,'Serviço '||s.service_number,amount,coalesce(p_due,current_date)) returning id into entry;
  end if;
  update public.service_orders set status='concluido', completed_at=now(), completed_by=auth.uid(), completion_notes=btrim(p_done),
    final_amount=amount, materials_used=coalesce(nullif(btrim(coalesce(p_materials,'')),''),materials_used),
    extra_expenses=coalesce(p_expenses,extra_expenses), financial_entry_id=entry where id=s.id;
  update public.operational_events set status='concluido', updated_at=now() where id=s.agenda_event_id and status not in ('concluido','cancelado');
  perform crm_private.service_log(s,'CONCLUIDO',jsonb_build_object('status','concluido','valor',amount,'conta',entry));
  return entry;
end $$;

do $$ declare f text; begin
  foreach f in array array['service_set_status(uuid,text,text)','service_schedule(uuid,timestamptz,uuid,text,text)','service_complete(uuid,text,numeric,text,numeric,date)'] loop
    execute format('revoke all on function public.%s from public,anon',f);
    execute format('grant execute on function public.%s to authenticated',f);
  end loop;
end $$;

-- Fotos do servico (antes/depois) em bucket privado, por empresa.
insert into storage.buckets(id,name,public,file_size_limit) values('service-photos','service-photos',false,10485760)
  on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit;
drop policy if exists service_photo_storage_read on storage.objects;
create policy service_photo_storage_read on storage.objects for select to authenticated
  using(bucket_id='service-photos' and (storage.foldername(name))[1]=(select public.current_company_id())::text and public.has_table_access('service_orders','select'));
drop policy if exists service_photo_storage_add on storage.objects;
create policy service_photo_storage_add on storage.objects for insert to authenticated
  with check(bucket_id='service-photos' and (storage.foldername(name))[1]=(select public.current_company_id())::text and public.has_table_access('service_orders','update'));
drop policy if exists service_photo_storage_remove on storage.objects;
create policy service_photo_storage_remove on storage.objects for delete to authenticated
  using(bucket_id='service-photos' and (storage.foldername(name))[1]=(select public.current_company_id())::text and public.has_table_access('service_orders','update'));

-- Indicadores do painel operacional, numa consulta so.
create or replace function public.operational_indicators() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  with c as (select public.current_company_id() as id),
  o as (select op_stage from public.orders, c where company_id=c.id and op_stage is not null and operational_status not in ('finalizado','cancelado')),
  p as (select po.current_step, po.flow_type, po.status, po.planned_end, ord.op_stage from public.production_orders po join public.orders ord on ord.id=po.order_id, c
        where po.company_id=c.id and po.status not in ('cancelado','finalizado')),
  s as (select status, priority, completed_at from public.service_orders, c where company_id=c.id)
  select jsonb_build_object(
    'aguardando_decisao', (select count(*) from o where op_stage='aguardando_decisao'),
    'aguardando_conferencia', (select count(*) from o where op_stage='aguardando_conferencia'),
    'conferencias_sem_data', (select count(*) from public.order_measure_checks m, c where m.company_id=c.id and m.status='pendente'),
    'aguardando_validacao', (select count(*) from o where op_stage in ('aguardando_validacao','revisar_orcamento')),
    'aguardando_corte', (select count(*) from o where op_stage='aguardando_liberacao_corte'),
    'em_producao', (select count(*) from p where (op_stage is null or op_stage='liberado_corte') and (flow_type='esquadrias' or current_step<=4)),
    'producao_atrasada', (select count(*) from p where planned_end is not null and planned_end<current_date),
    'instalacoes_pendentes', (select count(*) from p where flow_type<>'esquadrias' and current_step in (5,6)),
    'manutencoes_abertas', (select count(*) from s where status not in ('concluido','cancelado')),
    'manutencoes_urgentes', (select count(*) from s where status not in ('concluido','cancelado') and priority='urgente'),
    'servicos_concluidos_mes', (select count(*) from s where status='concluido' and completed_at>=date_trunc('month',now()))
  );
$$;
revoke all on function public.operational_indicators() from public,anon;
grant execute on function public.operational_indicators() to authenticated;
commit;
