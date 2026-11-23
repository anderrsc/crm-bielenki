begin;
create table if not exists public.work_teams(
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 name text not null check(length(btrim(name)) between 1 and 80), leader_id uuid not null references public.profiles(id),
 active boolean not null default true, created_at timestamptz not null default now());
create unique index if not exists work_teams_name on public.work_teams(company_id,lower(name));
create index if not exists work_teams_leader on public.work_teams(leader_id);
create table if not exists public.work_team_members(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),team_id uuid not null references public.work_teams(id),
 profile_id uuid not null references public.profiles(id), duty text not null default 'Equipe',
 started_at timestamptz not null default now(),ended_at timestamptz,check(ended_at is null or ended_at>=started_at));
create unique index if not exists work_members_active on public.work_team_members(team_id,profile_id) where ended_at is null;
create index if not exists work_members_company on public.work_team_members(company_id);
create index if not exists work_members_profile on public.work_team_members(profile_id);
create index if not exists work_members_team on public.work_team_members(team_id);
create table if not exists public.work_vehicles(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 name text not null check(length(btrim(name)) between 1 and 80),plate text check(plate is null or plate ~ '^[A-Z0-9]{7}$'),
 vehicle_type text not null default 'Utilitário',capacity_kg numeric check(capacity_kg>0),useful_length_m numeric check(useful_length_m>0),
 status text not null default 'disponivel' check(status in ('disponivel','manutencao','inativo')),created_at timestamptz not null default now());
create unique index if not exists work_vehicles_plate on public.work_vehicles(company_id,plate) where plate is not null;
create index if not exists work_vehicles_company on public.work_vehicles(company_id);
create table if not exists public.work_days(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),work_date date not null,
 team_id uuid not null references public.work_teams(id),vehicle_id uuid not null references public.work_vehicles(id),driver_id uuid not null references public.profiles(id),
 team_name text not null,vehicle_name text not null,driver_name text not null,notes text,
 status text not null default 'planejada' check(status in ('planejada','em_andamento','concluida','cancelada')),
 crew_review_required boolean not null default false,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now());
create unique index if not exists work_day_team on public.work_days(company_id,work_date,team_id) where status<>'cancelada';
create unique index if not exists work_day_vehicle on public.work_days(company_id,work_date,vehicle_id) where status<>'cancelada';
create index if not exists work_days_team on public.work_days(team_id);
create index if not exists work_days_vehicle on public.work_days(vehicle_id);
create index if not exists work_days_driver on public.work_days(driver_id);
create index if not exists work_days_creator on public.work_days(created_by);
create index if not exists work_days_company_date on public.work_days(company_id,work_date);
create table if not exists public.work_day_members(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),day_id uuid not null references public.work_days(id),
 work_date date not null,profile_id uuid not null references public.profiles(id),profile_name text not null,duty text not null default 'Equipe',
 added_at timestamptz not null default now(),released_at timestamptz);
create unique index if not exists work_person_day on public.work_day_members(company_id,work_date,profile_id) where released_at is null;
create index if not exists work_day_members_day on public.work_day_members(day_id);
create index if not exists work_day_members_profile on public.work_day_members(profile_id);
create table if not exists public.work_day_jobs(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),day_id uuid not null references public.work_days(id),
 event_id uuid references public.operational_events(id),measurement_id uuid references public.measurements(id),installation_id uuid references public.installations(id),
 order_id uuid references public.orders(id),title text not null,address text,scheduled_at timestamptz not null,position integer not null check(position>0),
 active boolean not null default true,needs_review boolean not null default false,created_at timestamptz not null default now(),
 check(num_nonnulls(event_id,measurement_id,installation_id)=1));
create unique index if not exists work_job_event on public.work_day_jobs(event_id) where active and event_id is not null;
create unique index if not exists work_job_measurement on public.work_day_jobs(measurement_id) where active and measurement_id is not null;
create unique index if not exists work_job_installation on public.work_day_jobs(installation_id) where active and installation_id is not null;
create unique index if not exists work_job_position on public.work_day_jobs(day_id,position) where active;
create index if not exists work_jobs_company on public.work_day_jobs(company_id);
create index if not exists work_jobs_order on public.work_day_jobs(order_id);
create index if not exists work_jobs_day on public.work_day_jobs(day_id);
-- Índices completos também cobrem as FKs dos registros encerrados.
create index if not exists work_jobs_event on public.work_day_jobs(event_id);
create index if not exists work_jobs_measurement on public.work_day_jobs(measurement_id);
create index if not exists work_jobs_installation on public.work_day_jobs(installation_id);
create table if not exists public.work_load_items(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),job_id uuid not null references public.work_day_jobs(id),
 order_id uuid references public.orders(id),order_item_id uuid references public.order_items(id),material_id uuid references public.materials(id),
 description text not null check(length(btrim(description)) between 1 and 300),kind text not null default 'item' check(kind in ('item','material','ferramenta')),
 quantity numeric not null check(quantity>0),unit text not null default 'un',
 state text not null default 'pendente' check(state in ('pendente','separado','carregado','retorno_conferido')),
 returned_quantity numeric check(returned_quantity>=0 and returned_quantity<=quantity),active boolean not null default true,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 check(num_nonnulls(order_item_id,material_id)<=1));
create unique index if not exists work_load_order_item on public.work_load_items(job_id,order_item_id) where active and order_item_id is not null;
create index if not exists work_load_company on public.work_load_items(company_id);
create index if not exists work_load_job on public.work_load_items(job_id);
create index if not exists work_load_order on public.work_load_items(order_id);
create index if not exists work_load_source on public.work_load_items(order_item_id);
create index if not exists work_load_material on public.work_load_items(material_id);
create index if not exists work_load_creator on public.work_load_items(created_by);
create table if not exists public.work_load_events(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),item_id uuid not null references public.work_load_items(id),
 from_state text,to_state text not null,returned_quantity numeric,notes text,profile_id uuid not null references public.profiles(id),created_at timestamptz not null default now());
create index if not exists work_load_events_company on public.work_load_events(company_id);
create index if not exists work_load_events_item on public.work_load_events(item_id);
create index if not exists work_load_events_profile on public.work_load_events(profile_id);

insert into public.permissions(role,resource,can_view,can_create,can_update,can_delete)
select r,'work_planning',true,r in ('administrador','gerente'),r in ('administrador','gerente'),false
from unnest(enum_range(null::public.app_role)) r on conflict(role,resource) do nothing;

create or replace function crm_private.work_can_view_day(p_day uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.current_company_id() is not null and public.has_table_access('work_planning','select') and exists(
 select 1 from public.work_days d where d.id=p_day and d.company_id=public.current_company_id() and
 (public.has_role(array['administrador','gerente','estoque','producao']::public.app_role[]) or exists(
 select 1 from public.work_day_members m where m.day_id=d.id and m.profile_id=auth.uid())))
$$;
revoke all on function crm_private.work_can_view_day(uuid) from public,anon;
grant usage on schema crm_private to authenticated;
grant execute on function crm_private.work_can_view_day(uuid) to authenticated;
do $$ declare t text; begin
 foreach t in array array['work_teams','work_team_members','work_vehicles','work_days','work_day_members','work_day_jobs','work_load_items','work_load_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('drop policy if exists %I on public.%I',t||'_read',t);
  if t in ('work_teams','work_team_members','work_vehicles') then
   execute format('create policy %I on public.%I for select to authenticated using(company_id=(select public.current_company_id()) and (select public.has_table_access(''work_planning'',''select'')))',t||'_read',t);
  elsif t='work_days' then
   execute format('create policy %I on public.%I for select to authenticated using(company_id=(select public.current_company_id()) and crm_private.work_can_view_day(id))',t||'_read',t);
  elsif t in ('work_day_members','work_day_jobs') then
   execute format('create policy %I on public.%I for select to authenticated using(company_id=(select public.current_company_id()) and crm_private.work_can_view_day(day_id))',t||'_read',t);
  elsif t='work_load_items' then
   execute format('create policy %I on public.%I for select to authenticated using(company_id=(select public.current_company_id()) and exists(select 1 from public.work_day_jobs j where j.id=job_id and crm_private.work_can_view_day(j.day_id)))',t||'_read',t);
  else
   execute format('create policy %I on public.%I for select to authenticated using(company_id=(select public.current_company_id()) and exists(select 1 from public.work_load_items i join public.work_day_jobs j on j.id=i.job_id where i.id=item_id and crm_private.work_can_view_day(j.day_id)))',t||'_read',t);
  end if;
 end loop;
end $$;

create or replace function crm_private.work_actor(p_manager boolean) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=public.current_company_id(); begin
 if c is null or auth.uid() is null or not public.has_table_access('work_planning','select')
  or (p_manager and (not public.has_role(array['administrador','gerente']::public.app_role[]) or not public.has_table_access('work_planning','update'))) then
  raise exception 'Sem permissão para planejar equipes' using errcode='42501'; end if;
 -- Serializa as reservas da empresa; índices únicos também protegem chamadas concorrentes.
 perform 1 from public.companies where id=c for update;
 return c;
end $$;
revoke all on function crm_private.work_actor(boolean) from public,anon,authenticated;

create or replace function crm_private.work_source(p_source text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb; c uuid:=public.current_company_id(); installation uuid;
begin
 if p_source='operational_events' then
  select installation_id into installation from public.operational_events where id=p_id and company_id=c;
  if installation is not null then return crm_private.work_source('installations',installation); end if;
  select jsonb_build_object('source',p_source,'id',id,'title',title,'starts_at',starts_at,'status',status,'address',address,'order_id',order_id)
  into result from public.operational_events where id=p_id and company_id=c and event_type in ('medicao','instalacao');
 elsif p_source='measurements' then
  select jsonb_build_object('source',p_source,'id',m.id,'title','Medição · '||coalesce(cl.name,m.measurement_number),'starts_at',m.scheduled_at,'status',m.status,'address',m.address,'order_id',m.order_id)
  into result from public.measurements m left join public.clients cl on cl.id=m.client_id where m.id=p_id and m.company_id=c;
 elsif p_source='installations' then
  select jsonb_build_object('source',p_source,'id',i.id,'title','Instalação · '||o.order_number,'starts_at',i.scheduled_at,'status',i.status,'address',i.address,'order_id',i.order_id)
  into result from public.installations i join public.orders o on o.id=i.order_id where i.id=p_id and i.company_id=c;
 else raise exception 'Tipo de visita inválido'; end if;
 return result;
end $$;
revoke all on function crm_private.work_source(text,uuid) from public,anon,authenticated;

create or replace function crm_private.work_set_crew(p_day uuid,p_driver uuid,p_members jsonb) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.work_days; person uuid; crew uuid[]; begin
 select * into d from public.work_days where id=p_day and company_id=public.current_company_id() for update;
 if not found or d.status not in ('planejada','em_andamento') then raise exception 'Equipe do dia só pode mudar enquanto a saída está aberta'; end if;
 if not exists(select 1 from public.profiles where id=p_driver and company_id=d.company_id and status='ativo') then raise exception 'Motorista inválido ou inativo'; end if;
 if p_members is null or jsonb_array_length(p_members)=0 then
  select array_agg(profile_id) into crew from public.work_team_members where team_id=d.team_id and ended_at is null;
  crew:=array_append(coalesce(crew,'{}'),p_driver);
 else select array_agg(distinct value::uuid) into crew from jsonb_array_elements_text(p_members); end if;
 if not(p_driver=any(crew)) then raise exception 'Inclua o motorista nos membros do dia'; end if;
 if exists(select 1 from unnest(crew) x where not exists(select 1 from public.profiles where id=x and company_id=d.company_id and status='ativo')) then raise exception 'Membro inválido ou inativo'; end if;
 if exists(select 1 from public.work_day_members where company_id=d.company_id and work_date=d.work_date and released_at is null and day_id<>d.id and profile_id=any(crew)) then raise exception 'Funcionário já alocado em outra saída neste dia'; end if;
 update public.work_day_members set released_at=now() where day_id=d.id and released_at is null;
 for person in select distinct unnest(crew) loop
  insert into public.work_day_members(company_id,day_id,work_date,profile_id,profile_name,duty)
  select d.company_id,d.id,d.work_date,p.id,coalesce(p.full_name,'Funcionário'),case when p.id=p_driver then 'Motorista' else coalesce((select duty from public.work_team_members where team_id=d.team_id and profile_id=p.id and ended_at is null),'Apoio') end from public.profiles p where p.id=person;
 end loop;
 update public.work_days set driver_id=p_driver,driver_name=(select coalesce(full_name,'Motorista') from public.profiles where id=p_driver),crew_review_required=false where id=d.id;
end $$;
revoke all on function crm_private.work_set_crew(uuid,uuid,jsonb) from public,anon,authenticated;

create or replace function crm_private.work_manage(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_variable
declare c uuid; id uuid:=nullif(p_payload->>'id','')::uuid; team uuid; person uuid; driver uuid; vehicle uuid; day uuid;
 d public.work_days; j public.work_day_jobs; item public.work_load_items; src jsonb; old jsonb; order_line record;
 v_name text:=btrim(p_payload->>'name'); target text; qty numeric; members jsonb; action text:=p_action;
begin
 c:=crm_private.work_actor(action not in ('load_add','load_order','load_state'));
 if action='team' then
  person:=(p_payload->>'leader_id')::uuid;
  if not exists(select 1 from public.profiles where profiles.id=person and company_id=c and status='ativo') then raise exception 'Líder inválido ou inativo'; end if;
  if id is null then insert into public.work_teams(company_id,name,leader_id) values(c,v_name,person) returning work_teams.id into id;
  else
   select to_jsonb(t) into old from public.work_teams t where t.id=id and t.company_id=c for update;
   if not found then raise exception 'Equipe não encontrada'; end if;
   if coalesce((p_payload->>'active')::boolean,true)=false and exists(select 1 from public.work_days where team_id=id and work_date>=(now() at time zone 'America/Sao_Paulo')::date and status in ('planejada','em_andamento')) then raise exception 'Cancele as saídas futuras antes de inativar a equipe'; end if;
   update public.work_teams set name=v_name,leader_id=person,active=coalesce((p_payload->>'active')::boolean,true) where work_teams.id=id;
  end if;
  insert into public.work_team_members(company_id,team_id,profile_id,duty) values(c,id,person,'Líder') on conflict(team_id,profile_id) where ended_at is null do nothing;
 elsif action='member' then
  team:=(p_payload->>'team_id')::uuid; person:=(p_payload->>'profile_id')::uuid;
  if not exists(select 1 from public.work_teams where work_teams.id=team and company_id=c) or not exists(select 1 from public.profiles where profiles.id=person and company_id=c and status='ativo') then raise exception 'Equipe ou funcionário inválido'; end if;
  if coalesce((p_payload->>'end')::boolean,false) and exists(select 1 from public.work_teams where work_teams.id=team and leader_id=person) then raise exception 'Troque o líder antes de encerrar sua participação'; end if;
  update public.work_team_members set ended_at=now() where team_id=team and profile_id=person and ended_at is null;
  if not coalesce((p_payload->>'end')::boolean,false) then insert into public.work_team_members(company_id,team_id,profile_id,duty) values(c,team,person,left(coalesce(nullif(p_payload->>'duty',''),'Equipe'),80)) returning work_team_members.id into id; else id:=team; end if;
 elsif action='vehicle' then
  target:=coalesce(p_payload->>'status','disponivel');
  if id is not null then
   select to_jsonb(t) into old from public.work_vehicles t where t.id=id and company_id=c for update;
   if not found then raise exception 'Veículo não encontrado'; end if;
   if target<>'disponivel' and exists(select 1 from public.work_days where vehicle_id=id and work_date>=(now() at time zone 'America/Sao_Paulo')::date and status in ('planejada','em_andamento')) then raise exception 'Cancele as saídas futuras antes de indisponibilizar o veículo'; end if;
   update public.work_vehicles set name=v_name,plate=nullif(regexp_replace(upper(p_payload->>'plate'),'[^A-Z0-9]','','g'),''),vehicle_type=left(coalesce(p_payload->>'vehicle_type','Utilitário'),80),capacity_kg=nullif(p_payload->>'capacity_kg','')::numeric,useful_length_m=nullif(p_payload->>'useful_length_m','')::numeric,status=target where work_vehicles.id=id;
  else insert into public.work_vehicles(company_id,name,plate,vehicle_type,capacity_kg,useful_length_m,status)
   values(c,v_name,nullif(regexp_replace(upper(p_payload->>'plate'),'[^A-Z0-9]','','g'),''),left(coalesce(p_payload->>'vehicle_type','Utilitário'),80),nullif(p_payload->>'capacity_kg','')::numeric,nullif(p_payload->>'useful_length_m','')::numeric,target) returning work_vehicles.id into id; end if;
 elsif action in ('day','crew') then
  if action='day' then
   team:=(p_payload->>'team_id')::uuid;vehicle:=(p_payload->>'vehicle_id')::uuid;driver:=(p_payload->>'driver_id')::uuid;
   if (p_payload->>'work_date')::date<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Use hoje ou uma data futura para a saída'; end if;
   if not exists(select 1 from public.work_teams t join public.profiles p on p.id=t.leader_id where t.id=team and t.company_id=c and t.active and p.status='ativo') then raise exception 'Equipe ou líder inativo'; end if;
   if not exists(select 1 from public.work_vehicles where work_vehicles.id=vehicle and company_id=c and status='disponivel') then raise exception 'Veículo indisponível'; end if;
   if exists(select 1 from public.work_days where company_id=c and work_date=(p_payload->>'work_date')::date and status<>'cancelada' and (team_id=team or vehicle_id=vehicle)) then raise exception 'Equipe ou veículo já alocado neste dia'; end if;
   insert into public.work_days(company_id,work_date,team_id,vehicle_id,driver_id,team_name,vehicle_name,driver_name,notes,created_by)
   select c,(p_payload->>'work_date')::date,team,vehicle,driver,t.name,v.name||coalesce(' · '||v.plate,''),'Motorista',left(p_payload->>'notes',1000),auth.uid() from public.work_teams t cross join public.work_vehicles v where t.id=team and v.id=vehicle returning work_days.id into id;
  else
   if not exists(select 1 from public.work_days where work_days.id=id and company_id=c) then raise exception 'Saída não encontrada'; end if;
   driver:=(p_payload->>'driver_id')::uuid;
  end if;
  perform crm_private.work_set_crew(id,driver,p_payload->'members');
 elsif action='day_status' then
  select * into d from public.work_days where work_days.id=id and company_id=c for update;
  if not found then raise exception 'Saída não encontrada'; end if;
  target:=p_payload->>'status';
  if d.status='cancelada' or target not in ('em_andamento','concluida','cancelada') or (target='em_andamento' and d.status<>'planejada') or (target='concluida' and d.status<>'em_andamento') then raise exception 'Mudança de situação inválida'; end if;
  if target in ('em_andamento','concluida') and (d.crew_review_required or exists(select 1 from public.work_day_jobs where day_id=id and active and needs_review)) then raise exception 'Revise a equipe e as visitas antes de continuar'; end if;
  if target='em_andamento' and not exists(select 1 from public.work_day_jobs where day_id=id and active) then raise exception 'Inclua uma visita antes da saída'; end if;
  update public.work_days set status=target where work_days.id=id;
  if target='cancelada' then update public.work_day_members set released_at=coalesce(released_at,now()) where day_id=id; update public.work_day_jobs set active=false where day_id=id; end if;
 elsif action in ('job','job_review','job_remove') then
  if action='job' then day:=(p_payload->>'day_id')::uuid;
  else select * into j from public.work_day_jobs where work_day_jobs.id=id and company_id=c for update; if not found then raise exception 'Visita não encontrada'; end if; day:=j.day_id; end if;
  select * into d from public.work_days where work_days.id=day and company_id=c for update;
  if not found or d.status in ('cancelada','concluida') then raise exception 'Saída encerrada'; end if;
  if action='job_remove' then update public.work_day_jobs set active=false where work_day_jobs.id=id;
  else
   if action='job' then src:=crm_private.work_source(p_payload->>'source',(p_payload->>'source_id')::uuid);
   else src:=crm_private.work_source(case when j.event_id is not null then 'operational_events' when j.measurement_id is not null then 'measurements' else 'installations' end,coalesce(j.event_id,j.measurement_id,j.installation_id)); end if;
   if src is null or src->>'starts_at' is null or ((src->>'starts_at')::timestamptz at time zone 'America/Sao_Paulo')::date<>d.work_date or src->>'status' in ('cancelado','cancelada') or (action='job' and src->>'status' in ('concluido','concluida','medicao_concluida','finalizado')) then raise exception 'Visita cancelada, encerrada ou em outro dia: remova e reprograme a saída'; end if;
   if action='job_review' and nullif(src->>'order_id','')::uuid is distinct from j.order_id then raise exception 'O pedido da visita mudou: remova a visita e inclua novamente'; end if;
   if action='job' then
    insert into public.work_day_jobs(company_id,day_id,event_id,measurement_id,installation_id,order_id,title,address,scheduled_at,position)
    values(c,day,case when src->>'source'='operational_events' then (src->>'id')::uuid end,case when src->>'source'='measurements' then (src->>'id')::uuid end,case when src->>'source'='installations' then (src->>'id')::uuid end,nullif(src->>'order_id','')::uuid,src->>'title',src->>'address',(src->>'starts_at')::timestamptz,(p_payload->>'position')::integer) returning work_day_jobs.id into id;
   else update public.work_day_jobs set title=src->>'title',address=src->>'address',scheduled_at=(src->>'starts_at')::timestamptz,needs_review=false,position=coalesce(nullif(p_payload->>'position','')::integer,position) where work_day_jobs.id=id and active; end if;
  end if;
 elsif action in ('load_add','load_order','load_state') then
  if action='load_state' then select * into item from public.work_load_items where work_load_items.id=id and company_id=c and active for update; if not found then raise exception 'Item não encontrado'; end if; team:=item.job_id;
  else team:=(p_payload->>'job_id')::uuid; end if;
  select * into j from public.work_day_jobs where work_day_jobs.id=team and company_id=c for update;
  if not found or not crm_private.work_can_view_day(j.day_id) then raise exception 'Visita não encontrada ou sem permissão' using errcode='42501'; end if;
  select * into d from public.work_days where work_days.id=j.day_id and company_id=c for update;
  target:=p_payload->>'state';
  if not public.has_role(array['administrador','gerente','producao','estoque']::public.app_role[]) and not exists(
   select 1 from public.work_day_members m where m.day_id=d.id and m.profile_id=auth.uid()
   and (m.released_at is null or (d.status='cancelada' and target='retorno_conferido')))
   then raise exception 'Sem permissão para conferir esta saída' using errcode='42501'; end if;
  if not(action='load_state' and target='retorno_conferido' and item.state='carregado') and
    (not j.active or d.status in ('concluida','cancelada') or d.crew_review_required or exists(select 1 from public.work_day_jobs where day_id=d.id and active and needs_review)) then raise exception 'Saída encerrada ou aguardando revisão'; end if;
  if action<>'load_state' and not public.has_role(array['administrador','gerente','producao','estoque']::public.app_role[]) then raise exception 'Sem permissão para alterar a lista' using errcode='42501'; end if;
  if action='load_order' then
   if j.order_id is null then raise exception 'Visita sem pedido vinculado'; end if;
   for order_line in select * from public.order_items where order_id=j.order_id and company_id=c loop
    insert into public.work_load_items(company_id,job_id,order_id,order_item_id,description,quantity,unit,created_by)
    values(c,j.id,j.order_id,order_line.id,left(coalesce(nullif(order_line.description,''),order_line.product,'Item do pedido'),300),order_line.quantity,order_line.unit,auth.uid()) on conflict(job_id,order_item_id) where active and order_item_id is not null do nothing;
   end loop; id:=j.id;
  elsif action='load_add' then
   vehicle:=nullif(p_payload->>'material_id','')::uuid;
   if vehicle is not null and not exists(select 1 from public.materials where materials.id=vehicle and company_id=c and active) then raise exception 'Material inválido'; end if;
   insert into public.work_load_items(company_id,job_id,order_id,material_id,description,kind,quantity,unit,created_by)
   values(c,j.id,j.order_id,vehicle,btrim(p_payload->>'description'),coalesce(p_payload->>'kind','item'),(p_payload->>'quantity')::numeric,left(coalesce(nullif(p_payload->>'unit',''),'un'),20),auth.uid()) returning work_load_items.id into id;
  else
   target:=p_payload->>'state';
   if target=item.state then return id; end if;
   if coalesce(p_payload->>'expected_state','')<>item.state then raise exception 'A lista mudou. Atualize a página'; end if;
   if not ((item.state='pendente' and target='separado') or (item.state='separado' and target='carregado') or (item.state='carregado' and target='retorno_conferido') or (target='pendente' and public.has_role(array['administrador','gerente']::public.app_role[]) and length(btrim(coalesce(p_payload->>'notes','')))>2)) then raise exception 'Etapa de conferência inválida'; end if;
   qty:=case when target='retorno_conferido' then (p_payload->>'returned_quantity')::numeric else null end;
   if target='retorno_conferido' and (qty is null or qty<0 or qty>item.quantity) then raise exception 'Quantidade devolvida inválida'; end if;
   if target='retorno_conferido' and item.kind='ferramenta' and qty<item.quantity and length(btrim(coalesce(p_payload->>'notes','')))<3 then raise exception 'Informe o motivo da ferramenta não devolvida'; end if;
   insert into public.work_load_events(company_id,item_id,from_state,to_state,returned_quantity,notes,profile_id) values(c,id,item.state,target,qty,left(p_payload->>'notes',1000),auth.uid());
   update public.work_load_items set state=target,returned_quantity=qty where work_load_items.id=id;
  end if;
 else raise exception 'Ação inválida'; end if;
 insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
 values(c,auth.uid(),'work_planning',id,upper(action),old,p_payload);
 return id;
end $$;
revoke all on function crm_private.work_manage(text,jsonb) from public,anon;
grant execute on function crm_private.work_manage(text,jsonb) to authenticated;
create or replace function public.work_manage(p_action text,p_payload jsonb) returns uuid language sql security invoker set search_path=pg_catalog,public as $$select crm_private.work_manage(p_action,p_payload)$$;
revoke all on function public.work_manage(text,jsonb) from public,anon;
grant execute on function public.work_manage(text,jsonb) to authenticated;

create or replace function crm_private.work_job_options(p_date date) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v record; src jsonb; result jsonb:='[]'; seen text[]:='{}'; k text;
begin
 if public.current_company_id() is null or not public.has_table_access('work_planning','select') or not public.has_role(array['administrador','gerente']::public.app_role[]) then raise exception 'Sem permissão' using errcode='42501'; end if;
 for v in select a.source,a.id from public.v_operational_agenda a where a.company_id=public.current_company_id() and a.event_type in ('medicao','instalacao') and (a.starts_at at time zone 'America/Sao_Paulo')::date=p_date order by a.starts_at loop
  src:=crm_private.work_source(v.source,v.id);k:=src->>'source'||':'||(src->>'id');
  if src is not null and src->>'starts_at' is not null and ((src->>'starts_at')::timestamptz at time zone 'America/Sao_Paulo')::date=p_date and not(k=any(seen)) and src->>'status' not in ('cancelado','cancelada','concluido','concluida','medicao_concluida','finalizado') then result:=result||jsonb_build_array(src);seen:=array_append(seen,k);end if;
 end loop;return result;
end $$;
revoke all on function crm_private.work_job_options(date) from public,anon;
grant execute on function crm_private.work_job_options(date) to authenticated;
create or replace function public.work_job_options(p_date date) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select crm_private.work_job_options(p_date)$$;
revoke all on function public.work_job_options(date) from public,anon;
grant execute on function public.work_job_options(date) to authenticated;

create or replace function crm_private.work_schedule_changed() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(to_jsonb(old)->>'starts_at',to_jsonb(old)->>'scheduled_at') is not distinct from coalesce(to_jsonb(new)->>'starts_at',to_jsonb(new)->>'scheduled_at')
  and old.address is not distinct from new.address and to_jsonb(old)->>'order_id' is not distinct from to_jsonb(new)->>'order_id'
  and new.status not in ('cancelado','cancelada') then return new; end if;
 update public.work_day_jobs set needs_review=true where active and
 ((tg_table_name='operational_events' and event_id=new.id) or (tg_table_name='measurements' and measurement_id=new.id) or (tg_table_name='installations' and installation_id=new.id));
 return new;
end $$;
revoke all on function crm_private.work_schedule_changed() from public,anon,authenticated;
drop trigger if exists work_events_changed on public.operational_events;
create trigger work_events_changed after update of starts_at,status,address,order_id on public.operational_events for each row
when(old.starts_at is distinct from new.starts_at or old.status is distinct from new.status or old.address is distinct from new.address or old.order_id is distinct from new.order_id) execute function crm_private.work_schedule_changed();
drop trigger if exists work_measurements_changed on public.measurements;
create trigger work_measurements_changed after update of scheduled_at,status,address,order_id on public.measurements for each row
when(old.scheduled_at is distinct from new.scheduled_at or old.status is distinct from new.status or old.address is distinct from new.address or old.order_id is distinct from new.order_id) execute function crm_private.work_schedule_changed();
drop trigger if exists work_installations_changed on public.installations;
create trigger work_installations_changed after update of scheduled_at,status,address on public.installations for each row
when(old.scheduled_at is distinct from new.scheduled_at or old.status is distinct from new.status or old.address is distinct from new.address) execute function crm_private.work_schedule_changed();
create or replace function crm_private.work_profile_changed() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status<>'ativo' then update public.work_days d set crew_review_required=true where d.work_date>=(now() at time zone 'America/Sao_Paulo')::date and d.status in ('planejada','em_andamento') and exists(select 1 from public.work_day_members m where m.day_id=d.id and m.profile_id=new.id and m.released_at is null);end if;
 return new;
end $$;
revoke all on function crm_private.work_profile_changed() from public,anon,authenticated;
drop trigger if exists work_profile_changed on public.profiles;
create trigger work_profile_changed after update of status on public.profiles for each row when(old.status is distinct from new.status) execute function crm_private.work_profile_changed();
commit;



