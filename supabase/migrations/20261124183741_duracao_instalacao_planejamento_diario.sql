begin;
alter table public.quotes add column if not exists installation_duration_minutes integer check(installation_duration_minutes between 1 and 14400);
alter table public.work_days add column if not exists work_minutes integer not null default 480 check(work_minutes between 1 and 1440);
alter table public.work_days add column if not exists reserved_minutes integer not null default 0 check(reserved_minutes>=0 and reserved_minutes<=work_minutes);
alter table public.work_day_jobs add column if not exists duration_minutes integer check(duration_minutes between 1 and 14400);
alter table public.work_day_jobs add column if not exists duration_from_quote boolean not null default true;
create index if not exists quotes_installation_sale on public.quotes(company_id,sale_id) where sale_id is not null;

create or replace function crm_private.quote_save_installation_duration(p_quote uuid,p_payload jsonb) returns void language plpgsql set search_path=pg_catalog,public as $$
declare v text:=p_payload->>'installation_duration_minutes'; n integer;
begin
 if not(p_payload?'installation_duration_minutes') then return;end if;
 if v is not null then
  if v !~ '^[0-9]{1,5}$' then raise exception 'Duração inválida: use minutos inteiros';end if;
  n:=v::integer;if n<1 or n>14400 then raise exception 'Duração deve ficar entre 1 e 14400 minutos';end if;
 end if;
 update public.quotes set installation_duration_minutes=n where id=p_quote and company_id=public.current_company_id();
end $$;
revoke all on function crm_private.quote_save_installation_duration(uuid,jsonb) from public,anon,authenticated;

-- Preserva as definições vigentes e suas verificações; adiciona somente a duração na mesma transação.
do $$ declare r record; definition text; needle text; addition text;begin
 for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_gutter_quote','create_gutter_quote_unchecked','update_gutter_quote','create_window_quote','duplicate_quote') loop
  definition:=pg_get_functiondef(r.oid);
  if position('installation_duration_v1' in definition)>0 then continue;end if;
  needle:=case r.proname when 'create_window_quote' then 'return quote_id;' when 'update_gutter_quote' then 'return q.id;' when 'duplicate_quote' then 'return target;' else 'return q;' end;
  if position(needle in definition)=0 then raise exception 'Definição inesperada de %; revisar antes de aplicar',r.proname;end if;
  addition:=case when r.proname='duplicate_quote' then
   'perform crm_private.quote_save_installation_duration(target,jsonb_build_object(''installation_duration_minutes'',(select installation_duration_minutes from public.quotes where id=p_quote_id and company_id=public.current_company_id())));'
   else 'perform crm_private.quote_save_installation_duration('||case r.proname when 'create_window_quote' then 'quote_id' when 'update_gutter_quote' then 'q.id' else 'q' end||',p_payload);' end;
  execute replace(definition,needle,'/* installation_duration_v1 */ '||addition||chr(10)||needle);
 end loop;
end $$;

create or replace function crm_private.set_quote_installation_duration(p_quote uuid,p_minutes integer) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=public.current_company_id();old_value integer;begin
 if auth.uid() is null or c is null or not public.has_table_access('quotes','update') then raise exception 'Sem permissão' using errcode='42501';end if;
 perform 1 from public.companies where id=c for update;
 select installation_duration_minutes into old_value from public.quotes where id=p_quote and company_id=c and (seller_id=auth.uid() or public.has_role(array['administrador','gerente']::public.app_role[])) for update;
 if not found then raise exception 'Orçamento não disponível' using errcode='42501';end if;
 perform crm_private.quote_save_installation_duration(p_quote,jsonb_build_object('installation_duration_minutes',p_minutes));
 insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data) values(c,auth.uid(),'quotes',p_quote,'INSTALLATION_DURATION',jsonb_build_object('minutes',old_value),jsonb_build_object('minutes',p_minutes));
end $$;
revoke all on function crm_private.set_quote_installation_duration(uuid,integer) from public,anon;
grant execute on function crm_private.set_quote_installation_duration(uuid,integer) to authenticated;
create or replace function public.set_quote_installation_duration(p_quote uuid,p_minutes integer) returns void language sql security invoker set search_path=pg_catalog,public as $$select crm_private.set_quote_installation_duration(p_quote,p_minutes)$$;
revoke all on function public.set_quote_installation_duration(uuid,integer) from public,anon;
grant execute on function public.set_quote_installation_duration(uuid,integer) to authenticated;

create or replace function crm_private.work_source(p_source text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;c uuid:=public.current_company_id();installation uuid;minutes integer;used boolean;begin
 if p_source='operational_events' then
  select installation_id into installation from public.operational_events where id=p_id and company_id=c;
  if installation is not null then return crm_private.work_source('installations',installation);end if;
  select jsonb_build_object('source',p_source,'id',id,'title',title,'starts_at',starts_at,'status',status,'address',address,'order_id',order_id,'event_type',event_type) into result from public.operational_events where id=p_id and company_id=c and event_type in ('medicao','instalacao');
 elsif p_source='measurements' then
  select jsonb_build_object('source',p_source,'id',m.id,'title','Medição · '||coalesce(cl.name,m.measurement_number),'starts_at',m.scheduled_at,'status',m.status,'address',m.address,'order_id',m.order_id,'event_type','medicao') into result from public.measurements m left join public.clients cl on cl.id=m.client_id and cl.company_id=c where m.id=p_id and m.company_id=c;
 elsif p_source='installations' then
  select jsonb_build_object('source',p_source,'id',i.id,'title','Instalação · '||o.order_number,'starts_at',i.scheduled_at,'status',i.status,'address',i.address,'order_id',i.order_id,'event_type','instalacao') into result from public.installations i join public.orders o on o.id=i.order_id and o.company_id=c where i.id=p_id and i.company_id=c;
 else raise exception 'Tipo de visita inválido';end if;
 if result is null then return null;end if;
 if nullif(result->>'order_id','') is not null and not exists(select 1 from public.orders where id=(result->>'order_id')::uuid and company_id=c and operational_status not in ('cancelado','cancelada')) then return null;end if;
 if result->>'event_type'='instalacao' then
  select q.installation_duration_minutes into minutes from public.orders o join public.quotes q on q.sale_id=o.sale_id and q.company_id=c where o.id=nullif(result->>'order_id','')::uuid and o.company_id=c order by q.created_at desc,q.id limit 1;
 end if;
 select exists(select 1 from public.work_day_jobs j where j.company_id=c and j.active and case p_source when 'installations' then j.installation_id=p_id when 'measurements' then j.measurement_id=p_id else j.event_id=p_id end) into used;
 return result||jsonb_build_object('duration_minutes',minutes,'allocated',used);
end $$;
revoke all on function crm_private.work_source(text,uuid) from public,anon,authenticated;

create or replace function crm_private.work_job_duration_snapshot() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare src jsonb;begin
 if new.duration_from_quote and (tg_op='INSERT' or (old.needs_review and not new.needs_review)) then
  src:=crm_private.work_source(case when new.event_id is not null then 'operational_events' when new.measurement_id is not null then 'measurements' else 'installations' end,coalesce(new.event_id,new.measurement_id,new.installation_id));
  new.duration_minutes:=(src->>'duration_minutes')::integer;
 end if;return new;
end $$;
revoke all on function crm_private.work_job_duration_snapshot() from public,anon,authenticated;
drop trigger if exists work_job_duration_snapshot on public.work_day_jobs;
create trigger work_job_duration_snapshot before insert or update on public.work_day_jobs for each row execute function crm_private.work_job_duration_snapshot();

create or replace function crm_private.work_quote_duration_changed() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform 1 from public.companies where id=new.company_id for update;
 update public.work_day_jobs j set needs_review=true from public.work_days d,public.orders o where j.day_id=d.id and j.order_id=o.id and o.sale_id=new.sale_id and j.company_id=new.company_id and j.active and j.duration_from_quote and d.status in ('planejada','em_andamento') and d.work_date>=(now() at time zone 'America/Sao_Paulo')::date;
 return new;
end $$;
revoke all on function crm_private.work_quote_duration_changed() from public,anon,authenticated;
drop trigger if exists work_quote_duration_changed on public.quotes;
create trigger work_quote_duration_changed after update of installation_duration_minutes on public.quotes for each row when(old.installation_duration_minutes is distinct from new.installation_duration_minutes) execute function crm_private.work_quote_duration_changed();

create or replace function crm_private.work_planning_time(p_action text,p_payload jsonb) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=crm_private.work_actor(true);d public.work_days;j public.work_day_jobs;begin
 if p_action='day_time' then
  select * into d from public.work_days where id=(p_payload->>'id')::uuid and company_id=c for update;
  if not found or d.status<>'planejada' then raise exception 'Ajuste a jornada antes da saída';end if;
  update public.work_days set work_minutes=(p_payload->>'work_minutes')::integer,reserved_minutes=(p_payload->>'reserved_minutes')::integer where id=d.id;
 elsif p_action='job_time' then
  select * into j from public.work_day_jobs where id=(p_payload->>'id')::uuid and company_id=c and active for update;
  if not found then raise exception 'Visita não encontrada';end if;
  select * into d from public.work_days where id=j.day_id and company_id=c for update;
  if d.status<>'planejada' then raise exception 'Ajuste a duração antes da saída';end if;
  update public.work_day_jobs set duration_from_quote=false,duration_minutes=(p_payload->>'duration_minutes')::integer where id=j.id;
 else raise exception 'Ação inválida';end if;
 insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,new_data) values(c,auth.uid(),'work_planning',d.id,upper(p_action),p_payload);
end $$;
revoke all on function crm_private.work_planning_time(text,jsonb) from public,anon;
grant execute on function crm_private.work_planning_time(text,jsonb) to authenticated;
create or replace function public.work_planning_time(p_action text,p_payload jsonb) returns void language sql security invoker set search_path=pg_catalog,public as $$select crm_private.work_planning_time(p_action,p_payload)$$;
revoke all on function public.work_planning_time(text,jsonb) from public,anon;
grant execute on function public.work_planning_time(text,jsonb) to authenticated;

create or replace function crm_private.work_apply_suggestions(p_date date,p_assignments jsonb) returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=crm_private.work_actor(true);a jsonb;src jsonb;d public.work_days;minutes integer;used integer;pos integer;count_done integer:=0;start_at timestamptz;begin
 if p_date<(now() at time zone 'America/Sao_Paulo')::date or jsonb_typeof(p_assignments) is distinct from 'array' or jsonb_array_length(p_assignments) not between 1 and 100 then raise exception 'Sugestão inválida';end if;
 for a in select value from jsonb_array_elements(p_assignments) loop
  select * into d from public.work_days where id=(a->>'day_id')::uuid and company_id=c and work_date=p_date for update;
  if not found or d.status<>'planejada' or d.crew_review_required then raise exception 'A saída mudou. Atualize a sugestão';end if;
  if not exists(select 1 from public.work_teams t join public.profiles p on p.id=t.leader_id where t.id=d.team_id and t.company_id=c and t.active and p.status='ativo') or not exists(select 1 from public.work_vehicles where id=d.vehicle_id and company_id=c and status='disponivel') or not exists(select 1 from public.work_day_members where day_id=d.id and profile_id=d.driver_id and released_at is null) or exists(select 1 from public.work_day_members m join public.profiles p on p.id=m.profile_id where m.day_id=d.id and m.released_at is null and p.status<>'ativo') then raise exception 'Revise equipe, motorista e veículo';end if;
  src:=crm_private.work_source(a->>'source',(a->>'source_id')::uuid);
  if src is null or src->>'event_type'<>'instalacao' or src->>'status' in ('cancelado','cancelada','concluido','concluida','finalizado') or (src->>'allocated')::boolean then raise exception 'Visita indisponível. Atualize a sugestão';end if;
  minutes:=(src->>'duration_minutes')::integer;start_at:=(src->>'starts_at')::timestamptz;
  if minutes is null or start_at is null or (start_at at time zone 'America/Sao_Paulo')::date<>p_date or minutes is distinct from (a->>'duration_minutes')::integer or start_at is distinct from (a->>'starts_at')::timestamptz then raise exception 'Horário ou duração mudaram. Atualize a sugestão';end if;
  if exists(select 1 from public.work_day_jobs where day_id=d.id and active and (duration_minutes is null or needs_review)) then raise exception 'Informe as durações e revise as visitas da saída';end if;
  select coalesce(sum(duration_minutes),0),coalesce(max(position),0)+1 into used,pos from public.work_day_jobs where day_id=d.id and active;
  if used+minutes+d.reserved_minutes>d.work_minutes then raise exception 'Tempo da equipe insuficiente. Atualize a sugestão';end if;
  if pos>100 then raise exception 'Limite de visitas atingido';end if;
  if ((start_at+minutes*interval '1 minute') at time zone 'America/Sao_Paulo')::date<>p_date or exists(select 1 from public.work_day_jobs j where j.day_id=d.id and j.active and tstzrange(j.scheduled_at,j.scheduled_at+j.duration_minutes*interval '1 minute','[)') && tstzrange(start_at,start_at+minutes*interval '1 minute','[)')) then raise exception 'Horários sobrepostos ou serviço ultrapassa o dia';end if;
  perform crm_private.work_manage('job',jsonb_build_object('day_id',d.id,'source',src->>'source','source_id',src->>'id','position',pos));
  count_done:=count_done+1;
 end loop;return count_done;
end $$;
revoke all on function crm_private.work_apply_suggestions(date,jsonb) from public,anon;
grant execute on function crm_private.work_apply_suggestions(date,jsonb) to authenticated;
create or replace function public.work_apply_suggestions(p_date date,p_assignments jsonb) returns integer language sql security invoker set search_path=pg_catalog,public as $$select crm_private.work_apply_suggestions(p_date,p_assignments)$$;
revoke all on function public.work_apply_suggestions(date,jsonb) from public,anon;
grant execute on function public.work_apply_suggestions(date,jsonb) to authenticated;
commit;
