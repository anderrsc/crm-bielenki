begin;
-- Fluxo operacional depois do fechamento do orcamento: decisao sobre conferencia de
-- medidas, visita de conferencia, validacao e liberacao para corte.
-- Aditivo. Pedidos antigos ficam com op_stage nulo e seguem como estavam.
alter table public.orders add column if not exists op_stage text;
alter table public.orders add column if not exists op_stage_at timestamptz;
alter table public.orders add column if not exists cut_released_at timestamptz;
alter table public.orders add column if not exists cut_released_by uuid references public.profiles(id);
alter table public.orders add column if not exists cut_responsible_id uuid references public.profiles(id);
alter table public.orders add column if not exists cut_notes text;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.orders'::regclass and conname='orders_op_stage_check') then
    alter table public.orders add constraint orders_op_stage_check check(op_stage is null or op_stage in
      ('aguardando_decisao','aguardando_conferencia','aguardando_validacao','revisar_orcamento','aguardando_liberacao_corte','liberado_corte'));
  end if;
end $$;
-- So pedidos novos entram no fluxo (o padrao nao e aplicado aos existentes).
alter table public.orders alter column op_stage set default 'aguardando_decisao';
create index if not exists orders_op_stage_idx on public.orders(company_id,op_stage) where op_stage is not null and op_stage<>'liberado_corte';
create index if not exists orders_cut_released_by_idx on public.orders(cut_released_by);
create index if not exists orders_cut_responsible_idx on public.orders(cut_responsible_id);

-- Visitas de conferencia de medidas de um pedido. Sem data = pendencia a agendar.
create table if not exists public.order_measure_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null default 'pendente' check(status in ('pendente','agendada','concluida','cancelada')),
  scheduled_at timestamptz,
  responsible_id uuid references public.profiles(id),
  notes text,
  result text check(result is null or result in ('conferidas','alteradas','revisar_orcamento','nova_visita')),
  result_notes text,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
-- Compromisso correspondente na Agenda (criado quando a visita ganha data).
alter table public.order_measure_checks add column if not exists agenda_event_id uuid references public.operational_events(id) on delete set null;
create index if not exists order_measure_checks_event_idx on public.order_measure_checks(agenda_event_id);
-- Uma unica conferencia em aberto por pedido: cliques repetidos nao criam pendencias em dobro.
create unique index if not exists order_measure_checks_open_key on public.order_measure_checks(order_id) where status in ('pendente','agendada');
create index if not exists order_measure_checks_company_idx on public.order_measure_checks(company_id,status,scheduled_at);
create index if not exists order_measure_checks_responsible_idx on public.order_measure_checks(responsible_id);
create index if not exists order_measure_checks_completed_by_idx on public.order_measure_checks(completed_by);
create index if not exists order_measure_checks_created_by_idx on public.order_measure_checks(created_by);
alter table public.order_measure_checks enable row level security;
revoke all on public.order_measure_checks from public,anon,authenticated;
grant select on public.order_measure_checks to authenticated;
drop policy if exists measure_checks_select on public.order_measure_checks;
create policy measure_checks_select on public.order_measure_checks for select to authenticated
  using(company_id=(select public.current_company_id()) and (select public.has_table_access('orders','select')));

create or replace function crm_private.order_op_log(p_order uuid, p_company uuid, p_action text, p_old jsonb, p_new jsonb) returns void
language sql security definer set search_path=pg_catalog,public as $$
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
  values(p_company,auth.uid(),'order_operations',p_order,p_action,p_old,p_new);
$$;
revoke all on function crm_private.order_op_log(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;

create or replace function crm_private.order_for_operation(p_order uuid) returns public.orders
language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.orders;
begin
  if public.current_company_id() is null or not public.has_table_access('orders','update') then
    raise exception 'Sem permissao para atualizar o pedido' using errcode='42501';
  end if;
  select * into o from public.orders where id=p_order and company_id=public.current_company_id() for update;
  if o.id is null then raise exception 'Pedido nao encontrado'; end if;
  return o;
end $$;
revoke all on function crm_private.order_for_operation(uuid) from public,anon,authenticated;

-- "Este pedido precisa de conferencia de medidas?" p_redo permite pedir nova conferencia depois.
create or replace function public.order_measure_decision(p_order_id uuid, p_needs boolean, p_redo boolean default false)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.orders := crm_private.order_for_operation(p_order_id); stage text;
begin
  if o.op_stage is not null and o.op_stage<>'aguardando_decisao' and not coalesce(p_redo,false) then
    return o.op_stage; -- ja respondido: nao repete nem duplica.
  end if;
  if o.op_stage='liberado_corte' and not p_needs then return o.op_stage; end if;
  if p_needs then
    stage := 'aguardando_conferencia';
    insert into public.order_measure_checks(company_id,order_id) values(o.company_id,o.id)
      on conflict (order_id) where status in ('pendente','agendada') do nothing;
  else
    stage := 'aguardando_liberacao_corte';
    update public.operational_events set status='cancelado', updated_at=now()
      where id in (select agenda_event_id from public.order_measure_checks where order_id=o.id and status in ('pendente','agendada')) and status not in ('concluido','cancelado');
    update public.order_measure_checks set status='cancelada' where order_id=o.id and status in ('pendente','agendada');
  end if;
  update public.orders set op_stage=stage, op_stage_at=now(),
    next_action=case when p_needs then 'Agendar conferência de medidas' else 'Confirmar envio para corte' end
    where id=o.id;
  perform crm_private.order_op_log(o.id,o.company_id,case when coalesce(p_redo,false) then 'NOVA_CONFERENCIA' else 'DECISAO_MEDIDAS' end,
    jsonb_build_object('op_stage',o.op_stage), jsonb_build_object('op_stage',stage,'precisa_conferencia',p_needs));
  return stage;
end $$;

create or replace function public.order_schedule_measure_check(p_order_id uuid, p_at timestamptz, p_responsible uuid default null, p_notes text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.orders := crm_private.order_for_operation(p_order_id); n integer; ev uuid;
begin
  if p_at is null then raise exception 'Informe a data da conferencia'; end if;
  if p_responsible is not null and not exists(select 1 from public.profiles where id=p_responsible and company_id=o.company_id and status='ativo') then
    raise exception 'Responsavel invalido'; end if;
  update public.order_measure_checks set status='agendada', scheduled_at=p_at, responsible_id=p_responsible, notes=nullif(btrim(coalesce(p_notes,'')),'')
    where order_id=o.id and status in ('pendente','agendada');
  get diagnostics n = row_count;
  if n=0 then raise exception 'Este pedido nao tem conferencia em aberto'; end if;
  -- Compromisso na Agenda: cria na primeira vez, atualiza ao reagendar.
  select agenda_event_id into ev from public.order_measure_checks where order_id=o.id and status='agendada';
  if ev is not null and exists(select 1 from public.operational_events where id=ev) then
    update public.operational_events set starts_at=p_at, responsible_id=p_responsible, notes=nullif(btrim(coalesce(p_notes,'')),''), status='agendado', updated_at=now() where id=ev;
  else
    insert into public.operational_events(company_id,event_type,title,client_id,order_id,responsible_id,starts_at,address,phone,status,notes,created_by)
    select o.company_id,'medicao','Conferência de medidas - Pedido '||o.order_number,o.client_id,o.id,p_responsible,p_at,
      nullif(concat_ws(', ',nullif(c.address,''),nullif(c.neighborhood,''),nullif(c.city,'')),''),coalesce(nullif(c.whatsapp,''),c.phone),'agendado',nullif(btrim(coalesce(p_notes,'')),''),auth.uid()
    from public.clients c where c.id=o.client_id returning id into ev;
    update public.order_measure_checks set agenda_event_id=ev where order_id=o.id and status='agendada';
  end if;
  update public.orders set next_action='Fazer a conferência de medidas', next_action_date=(p_at at time zone 'America/Sao_Paulo')::date where id=o.id;
  perform crm_private.order_op_log(o.id,o.company_id,'CONFERENCIA_AGENDADA',null,jsonb_build_object('data',p_at,'responsavel',p_responsible));
end $$;

-- Resultado da visita. Medidas alteradas exigem validacao da gerencia antes do corte.
create or replace function public.order_finish_measure_check(p_order_id uuid, p_result text, p_notes text default null)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.orders := crm_private.order_for_operation(p_order_id); stage text; n integer;
begin
  if p_result not in ('conferidas','alteradas','revisar_orcamento','nova_visita') then raise exception 'Resultado invalido'; end if;
  update public.operational_events set status='concluido', updated_at=now()
    where id in (select agenda_event_id from public.order_measure_checks where order_id=o.id and status in ('pendente','agendada')) and status not in ('concluido','cancelado');
  update public.order_measure_checks set status='concluida', result=p_result, result_notes=nullif(btrim(coalesce(p_notes,'')),''), completed_at=now(), completed_by=auth.uid()
    where order_id=o.id and status in ('pendente','agendada');
  get diagnostics n = row_count;
  if n=0 then raise exception 'Este pedido nao tem conferencia em aberto'; end if;
  stage := case p_result when 'conferidas' then 'aguardando_liberacao_corte' when 'alteradas' then 'aguardando_validacao'
    when 'revisar_orcamento' then 'revisar_orcamento' else 'aguardando_conferencia' end;
  if p_result='nova_visita' then insert into public.order_measure_checks(company_id,order_id) values(o.company_id,o.id); end if;
  update public.orders set op_stage=stage, op_stage_at=now(), next_action_date=null,
    next_action=case stage when 'aguardando_liberacao_corte' then 'Confirmar envio para corte' when 'aguardando_validacao' then 'Validar medidas alteradas'
      when 'revisar_orcamento' then 'Revisar o orçamento com as novas medidas' else 'Agendar nova conferência de medidas' end
    where id=o.id;
  perform crm_private.order_op_log(o.id,o.company_id,'CONFERENCIA_CONCLUIDA',jsonb_build_object('op_stage',o.op_stage),jsonb_build_object('op_stage',stage,'resultado',p_result,'observacoes',p_notes));
  return stage;
end $$;

-- Validacao das medidas alteradas ou do orcamento revisado: so gerencia.
create or replace function public.order_validate_measures(p_order_id uuid, p_notes text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.orders := crm_private.order_for_operation(p_order_id);
begin
  if not exists(select 1 from unnest(public.current_user_roles()) r where r::text in ('administrador','gerente')) then
    raise exception 'Somente a gerencia valida medidas alteradas' using errcode='42501'; end if;
  if o.op_stage not in ('aguardando_validacao','revisar_orcamento') then raise exception 'Este pedido nao esta aguardando validacao'; end if;
  update public.orders set op_stage='aguardando_liberacao_corte', op_stage_at=now(), next_action='Confirmar envio para corte' where id=o.id;
  perform crm_private.order_op_log(o.id,o.company_id,'MEDIDAS_VALIDADAS',jsonb_build_object('op_stage',o.op_stage),jsonb_build_object('op_stage','aguardando_liberacao_corte','observacoes',p_notes));
end $$;

-- Liberar para corte: separado de "medidas confirmadas". A producao passa da etapa Medicao para a seguinte.
create or replace function public.order_release_cut(p_order_id uuid, p_responsible uuid default null, p_notes text default null, p_date date default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.orders := crm_private.order_for_operation(p_order_id); po record;
begin
  if o.op_stage='liberado_corte' then return; end if; -- clique repetido
  if o.op_stage is distinct from 'aguardando_liberacao_corte' then raise exception 'Confirme as medidas antes de liberar para corte'; end if;
  if p_responsible is not null and not exists(select 1 from public.profiles where id=p_responsible and company_id=o.company_id and status='ativo') then
    raise exception 'Responsavel invalido'; end if;
  update public.orders set op_stage='liberado_corte', op_stage_at=now(), cut_released_at=coalesce(p_date::timestamptz, now()), cut_released_by=auth.uid(),
    cut_responsible_id=p_responsible, cut_notes=nullif(btrim(coalesce(p_notes,'')),''), next_action='Produção em andamento' where id=o.id;
  for po in select id,current_step,flow_type from public.production_orders where order_id=o.id and status<>'cancelado' and current_step=1 for update loop
    insert into public.production_step_logs(company_id,production_order_id,step_number,step_name,started_at,completed_at,responsible_id,notes)
      values(o.company_id,po.id,1,'Medicao',now(),now(),auth.uid(),'Medidas confirmadas e pedido liberado para corte')
      on conflict(production_order_id,step_number) do nothing;
    update public.production_orders set current_step=2, status='em_producao', started_at=coalesce(started_at,now()) where id=po.id;
  end loop;
  perform crm_private.order_op_log(o.id,o.company_id,'LIBERADO_CORTE',jsonb_build_object('op_stage',o.op_stage),jsonb_build_object('op_stage','liberado_corte','responsavel',p_responsible,'observacoes',p_notes));
end $$;

do $$ declare f text; begin
  foreach f in array array['order_measure_decision(uuid,boolean,boolean)','order_schedule_measure_check(uuid,timestamptz,uuid,text)',
    'order_finish_measure_check(uuid,text,text)','order_validate_measures(uuid,text)','order_release_cut(uuid,uuid,text,date)'] loop
    execute format('revoke all on function public.%s from public,anon',f);
    execute format('grant execute on function public.%s to authenticated',f);
  end loop;
end $$;

-- A producao so avanca depois da liberacao para corte (pedidos antigos, sem op_stage, nao sao afetados).
create or replace function crm_private.production_requires_cut_release() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.current_step > old.current_step and exists(select 1 from public.orders o where o.id=new.order_id and o.op_stage is not null and o.op_stage<>'liberado_corte') then
    raise exception 'Confirme as medidas e libere o pedido para corte antes de avancar a producao';
  end if;
  return new;
end $$;
revoke all on function crm_private.production_requires_cut_release() from public,anon,authenticated;
drop trigger if exists production_requires_cut_release on public.production_orders;
create trigger production_requires_cut_release before update of current_step on public.production_orders
  for each row execute function crm_private.production_requires_cut_release();

-- Pendencias operacionais sem data, para a Agenda e os paineis.
create or replace view public.v_order_pending with (security_invoker=true) as
select o.id as order_id, o.company_id, o.order_number, o.sale_id, o.op_stage, o.op_stage_at, c.name as client_name,
  coalesce(nullif(c.whatsapp,''),c.phone) as phone, concat_ws(', ',nullif(c.address,''),nullif(c.neighborhood,''),nullif(c.city,'')) as address,
  mc.id as check_id, mc.status as check_status, mc.scheduled_at, p.full_name as responsible_name
from public.orders o
left join public.clients c on c.id=o.client_id and c.company_id=o.company_id
left join public.order_measure_checks mc on mc.order_id=o.id and mc.status in ('pendente','agendada')
left join public.profiles p on p.id=mc.responsible_id and p.company_id=o.company_id
where o.op_stage is not null and o.op_stage<>'liberado_corte' and o.operational_status not in ('finalizado','cancelado');
revoke all on public.v_order_pending from public,anon;
grant select on public.v_order_pending to authenticated;
commit;
