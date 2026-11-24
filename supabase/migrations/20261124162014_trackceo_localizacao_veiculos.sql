begin;

-- Reutiliza integrations para o cadastro do provedor. Credenciais ficam fora da API.
create table if not exists crm_private.trackceo_connections(
 company_id uuid primary key references public.companies(id),
 account text, password_encrypted text check(password_encrypted is null or password_encrypted like 'enc:%'),
 token_encrypted text check(token_encrypted is null or token_encrypted like 'enc:%'),token_expires_at timestamptz,
 generation uuid not null default gen_random_uuid(),active boolean not null default false,
 lease_id uuid,lease_until timestamptz,last_attempt_at timestamptz,last_sync_at timestamptz,last_error text,
 check(last_error is null or last_error in ('credentials','permission','unavailable','invalid_response','rate_limit','configuration')));
alter table crm_private.trackceo_connections enable row level security;
revoke all on crm_private.trackceo_connections from public,anon,authenticated,service_role;
drop policy if exists integrations_trackceo_private on public.integrations;
create policy integrations_trackceo_private on public.integrations as restrictive for all to authenticated
 using(provider<>'trackceo') with check(provider<>'trackceo');

create table if not exists public.trackceo_devices(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 integration_id uuid not null references public.integrations(id),generation uuid not null,
 imei text not null check(imei ~ '^[0-9]{10,20}$'),name text not null,model text,plate text,
 vehicle_id uuid references public.work_vehicles(id),available boolean not null default true,
 latitude double precision check(latitude between -90 and 90),longitude double precision check(longitude between -180 and 180),
 gps_at timestamptz,heartbeat_at timestamptz,speed double precision check(speed between 0 and 400),
 ignition smallint check(ignition in (-1,0,1)),provider_status smallint check(provider_status between 1 and 5),
 synced_at timestamptz not null default now(),unique(company_id,imei),
 check((latitude is null)=(longitude is null)),check((latitude is null)=(gps_at is null)));
create index if not exists trackceo_devices_integration on public.trackceo_devices(integration_id);
create unique index if not exists trackceo_vehicle_unique on public.trackceo_devices(company_id,vehicle_id) where vehicle_id is not null;
create index if not exists trackceo_devices_vehicle on public.trackceo_devices(vehicle_id);
alter table public.trackceo_devices enable row level security;
revoke all on public.trackceo_devices from public,anon,authenticated;
grant select on public.trackceo_devices to authenticated;

create or replace function crm_private.trackceo_manager() returns uuid language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c uuid:=public.current_company_id();begin
 if auth.uid() is null or c is null or not public.has_role(array['administrador','gerente']::public.app_role[])
 or not public.has_table_access('work_planning','select') then raise exception 'Sem permissão para o rastreamento' using errcode='42501';end if;
 return c;
end $$;
revoke all on function crm_private.trackceo_manager() from public,anon,authenticated;

create or replace function crm_private.trackceo_visible(p_company uuid,p_generation uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and p_company=public.current_company_id()
 and public.has_role(array['administrador','gerente']::public.app_role[]) and public.has_table_access('work_planning','select')
 and exists(select 1 from crm_private.trackceo_connections c where c.company_id=p_company and c.active and c.generation=p_generation)
$$;
revoke all on function crm_private.trackceo_visible(uuid,uuid) from public,anon;
grant execute on function crm_private.trackceo_visible(uuid,uuid) to authenticated;
drop policy if exists trackceo_devices_read on public.trackceo_devices;
create policy trackceo_devices_read on public.trackceo_devices for select to authenticated
 using(company_id=(select public.current_company_id()) and crm_private.trackceo_visible(company_id,generation));

create or replace function crm_private.trackceo_status() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c uuid:=crm_private.trackceo_manager();s crm_private.trackceo_connections;begin
 select * into s from crm_private.trackceo_connections where company_id=c;
 return jsonb_build_object('company_id',c,'account',s.account,'active',coalesce(s.active,false),
 'configured',s.password_encrypted is not null,'last_sync_at',s.last_sync_at,'last_error',s.last_error,
 'busy',coalesce(s.lease_until>now(),false));
end $$;
revoke all on function crm_private.trackceo_status() from public,anon;
grant execute on function crm_private.trackceo_status() to authenticated;
create or replace function public.trackceo_status() returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select crm_private.trackceo_status()$$;
revoke all on function public.trackceo_status() from public,anon;
grant execute on function public.trackceo_status() to authenticated;

-- Somente o backend com service_role consegue ler/gravar os segredos e sincronizar.
create or replace function crm_private.trackceo_server(p_company uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s crm_private.trackceo_connections;actor uuid:=(p_payload->>'actor_id')::uuid;
 item jsonb;integration uuid;gen uuid;lease uuid;begin
 if not exists(select 1 from public.profiles p join public.user_roles r on r.profile_id=p.id and r.company_id=p.company_id
 where p.id=actor and p.company_id=p_company and p.status='ativo' and r.role in ('administrador','gerente')) then
 raise exception 'Operador inválido' using errcode='42501';end if;
 if p_action='begin' then
  insert into crm_private.trackceo_connections(company_id) values(p_company) on conflict do nothing;
 end if;
 select * into s from crm_private.trackceo_connections where company_id=p_company for update;
 if not found then raise exception 'Conexão não configurada';end if;
 if p_action='begin' then
  if s.lease_until>now() then return jsonb_build_object('busy',true);end if;
  if not coalesce((p_payload->>'connect')::boolean,false) and not s.active then raise exception 'Conecte o TrackCEO primeiro';end if;
  if s.last_attempt_at>now()-interval '30 seconds' then return jsonb_build_object('throttled',true);end if;
  lease:=gen_random_uuid();
  update crm_private.trackceo_connections set lease_id=lease,lease_until=now()+interval '2 minutes',last_attempt_at=now() where company_id=p_company;
  return to_jsonb(s)||jsonb_build_object('lease_id',lease);
 end if;
 if s.lease_id is null or s.lease_id is distinct from (p_payload->>'lease_id')::uuid or s.lease_until<=now() then
 raise exception 'A conexão mudou. Atualize a tela';end if;
 if p_action='fail' then
  update crm_private.trackceo_connections set lease_id=null,lease_until=null,last_error=p_payload->>'error' where company_id=p_company;
  return '{}'::jsonb;
 elsif p_action<>'finish' then raise exception 'Ação inválida';end if;
 if coalesce((p_payload->>'connect')::boolean,false) then
  if coalesce(p_payload->>'password_encrypted','') not like 'enc:%' or coalesce(p_payload->>'token_encrypted','') not like 'enc:%'
   or length(btrim(coalesce(p_payload->>'account',''))) not between 1 and 120 then raise exception 'Credenciais inválidas';end if;
  gen:=gen_random_uuid();
  update crm_private.trackceo_connections set account=p_payload->>'account',password_encrypted=p_payload->>'password_encrypted',active=true,generation=gen where company_id=p_company;
 else
  if not s.active then raise exception 'Conexão desligada';end if;gen:=s.generation;
 end if;
 if coalesce(p_payload->>'token_encrypted','') not like 'enc:%' then raise exception 'Token inválido';end if;
 insert into public.integrations(company_id,provider,name,config,active,last_tested_at,last_test_status)
 values(p_company,'trackceo','TrackCEO','{}',true,now(),'ok') on conflict(company_id,provider)
 do update set active=true,last_tested_at=now(),last_test_status='ok',updated_at=now() returning id into integration;
 if jsonb_typeof(p_payload->'devices') is distinct from 'array' or jsonb_array_length(p_payload->'devices')>500 then raise exception 'Lista inválida';end if;
 update public.trackceo_devices set available=false where company_id=p_company;
 for item in select value from jsonb_array_elements(p_payload->'devices') loop
  insert into public.trackceo_devices(company_id,integration_id,generation,imei,name,model,plate,available,
   latitude,longitude,gps_at,heartbeat_at,speed,ignition,provider_status,synced_at)
  values(p_company,integration,gen,item->>'imei',left(item->>'name',160),left(item->>'model',80),left(item->>'plate',15),true,
   (item->>'latitude')::double precision,(item->>'longitude')::double precision,(item->>'gps_at')::timestamptz,
   (item->>'heartbeat_at')::timestamptz,(item->>'speed')::double precision,(item->>'ignition')::smallint,(item->>'provider_status')::smallint,now())
  on conflict(company_id,imei) do update set integration_id=excluded.integration_id,generation=excluded.generation,
   name=excluded.name,model=excluded.model,plate=excluded.plate,available=true,heartbeat_at=excluded.heartbeat_at,
   provider_status=excluded.provider_status,synced_at=now(),
   latitude=case when trackceo_devices.generation=excluded.generation and (excluded.gps_at is null or trackceo_devices.gps_at>excluded.gps_at) then trackceo_devices.latitude else excluded.latitude end,
   longitude=case when trackceo_devices.generation=excluded.generation and (excluded.gps_at is null or trackceo_devices.gps_at>excluded.gps_at) then trackceo_devices.longitude else excluded.longitude end,
   gps_at=case when trackceo_devices.generation=excluded.generation and (excluded.gps_at is null or trackceo_devices.gps_at>excluded.gps_at) then trackceo_devices.gps_at else excluded.gps_at end,
   speed=case when trackceo_devices.generation=excluded.generation and (excluded.gps_at is null or trackceo_devices.gps_at>excluded.gps_at) then trackceo_devices.speed else excluded.speed end,
   ignition=case when trackceo_devices.generation=excluded.generation and (excluded.gps_at is null or trackceo_devices.gps_at>excluded.gps_at) then trackceo_devices.ignition else excluded.ignition end;
 end loop;
 update crm_private.trackceo_connections set token_encrypted=p_payload->>'token_encrypted',token_expires_at=(p_payload->>'token_expires_at')::timestamptz,
  lease_id=null,lease_until=null,last_sync_at=now(),last_error=null where company_id=p_company;
 insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,new_data)
 values(p_company,actor,'integrations',integration,case when coalesce((p_payload->>'connect')::boolean,false) then 'TRACKCEO_CONNECT' else 'TRACKCEO_SYNC' end,
 jsonb_build_object('devices',jsonb_array_length(p_payload->'devices')));
 return jsonb_build_object('devices',jsonb_array_length(p_payload->'devices'));
end $$;
revoke all on function crm_private.trackceo_server(uuid,text,jsonb) from public,anon,authenticated;
grant usage on schema crm_private to service_role;
grant execute on function crm_private.trackceo_server(uuid,text,jsonb) to service_role;
create or replace function public.trackceo_server(p_company uuid,p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select crm_private.trackceo_server(p_company,p_action,p_payload)$$;
revoke all on function public.trackceo_server(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.trackceo_server(uuid,text,jsonb) to service_role;

create or replace function crm_private.trackceo_link(p_device uuid,p_vehicle uuid,p_create boolean) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=crm_private.trackceo_manager();d public.trackceo_devices;v uuid:=p_vehicle;clean_plate text;begin
 perform 1 from public.companies where id=c for update;
 select * into d from public.trackceo_devices where id=p_device and company_id=c and available and crm_private.trackceo_visible(company_id,generation) for update;
 if not found then raise exception 'Rastreador não disponível nesta conexão';end if;
 if p_create then
  if v is not null then raise exception 'Escolha cadastrar ou vincular';end if;
  if d.vehicle_id is not null then return d.vehicle_id;end if;
  clean_plate:=regexp_replace(upper(coalesce(d.plate,'')),'[^A-Z0-9]','','g');
  if clean_plate !~ '^[A-Z0-9]{7}$' then clean_plate:=null;end if;
  if clean_plate is not null then select id into v from public.work_vehicles where company_id=c and plate=clean_plate;end if;
  if v is null then v:=crm_private.work_manage('vehicle',jsonb_build_object('name',left(d.name,80),'plate',clean_plate,'vehicle_type','Veículo','status','disponivel'));end if;
 end if;
 if v is not null and not exists(select 1 from public.work_vehicles where id=v and company_id=c) then raise exception 'Veículo inválido';end if;
 if exists(select 1 from public.trackceo_devices x where x.company_id=c and x.vehicle_id=v and x.id<>d.id and crm_private.trackceo_visible(x.company_id,x.generation) and x.available) then raise exception 'Veículo já vinculado a outro rastreador';end if;
 -- Vínculos de uma conexão anterior podem ser substituídos, mantendo a auditoria.
 insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
 select c,auth.uid(),'trackceo_devices',id,'TRACKCEO_UNLINK',jsonb_build_object('vehicle_id',vehicle_id),'{}'::jsonb
 from public.trackceo_devices where company_id=c and vehicle_id=v and id<>d.id;
 update public.trackceo_devices set vehicle_id=null where company_id=c and vehicle_id=v and id<>d.id;
 update public.trackceo_devices set vehicle_id=v where id=d.id;
 insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
 values(c,auth.uid(),'trackceo_devices',d.id,'TRACKCEO_LINK',jsonb_build_object('vehicle_id',d.vehicle_id),jsonb_build_object('vehicle_id',v));
 return v;
end $$;
revoke all on function crm_private.trackceo_link(uuid,uuid,boolean) from public,anon;
grant execute on function crm_private.trackceo_link(uuid,uuid,boolean) to authenticated;
create or replace function public.trackceo_link(p_device uuid,p_vehicle uuid,p_create boolean default false) returns uuid language sql security invoker set search_path=pg_catalog,public as $$select crm_private.trackceo_link(p_device,p_vehicle,p_create)$$;
revoke all on function public.trackceo_link(uuid,uuid,boolean) from public,anon;
grant execute on function public.trackceo_link(uuid,uuid,boolean) to authenticated;

create or replace function crm_private.trackceo_disconnect() returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=crm_private.trackceo_manager();i uuid;begin
 update crm_private.trackceo_connections set active=false,generation=gen_random_uuid(),lease_id=null,lease_until=null where company_id=c;
 update public.integrations set active=false,updated_at=now() where company_id=c and provider='trackceo' returning id into i;
 insert into public.audit_logs(company_id,profile_id,table_name,record_id,action) values(c,auth.uid(),'integrations',i,'TRACKCEO_DISCONNECT');
end $$;
revoke all on function crm_private.trackceo_disconnect() from public,anon;
grant execute on function crm_private.trackceo_disconnect() to authenticated;
create or replace function public.trackceo_disconnect() returns void language sql security invoker set search_path=pg_catalog,public as $$select crm_private.trackceo_disconnect()$$;
revoke all on function public.trackceo_disconnect() from public,anon;
grant execute on function public.trackceo_disconnect() to authenticated;
commit;
