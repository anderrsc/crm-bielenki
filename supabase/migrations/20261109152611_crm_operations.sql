-- Autonomous operations; internal helpers are isolated from the Data API.
create schema if not exists crm_private;
revoke all on schema crm_private from public, anon, authenticated;
create table if not exists public.crm_operations_config (
 id boolean primary key default true check(id), cron_secret text not null,
 vapid_public text not null, vapid_private text not null,
 last_run_at timestamptz, last_error text
);
alter table public.crm_operations_config enable row level security;
revoke all on public.crm_operations_config from public, anon, authenticated;
grant all on public.crm_operations_config to service_role;
create policy operations_service on public.crm_operations_config to service_role using(true) with check(true);

create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 profile_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique, subscription jsonb not null, created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant all on public.push_subscriptions to service_role;
create policy push_service on public.push_subscriptions to service_role using(true) with check(true);
create index on public.push_subscriptions(profile_id);
create index on public.push_subscriptions(company_id);

alter table public.notifications add column event_key text, add column push_processed_at timestamptz, add column push_claimed_at timestamptz;
create unique index notifications_event_recipient on public.notifications(profile_id,event_key) where event_key is not null;
create index notifications_push_pending on public.notifications(created_at) where event_key is not null and push_processed_at is null;
alter table public.messages add column media_type text, add column file_name text, add column attachment_quote_id uuid references public.quotes(id) on delete set null;
create index on public.messages(attachment_quote_id);
create table public.whatsapp_health (
 company_id uuid primary key references public.companies(id), state text not null default 'unknown',
 failed_checks integer not null default 0, incident_id uuid, checked_at timestamptz, heartbeat_at timestamptz
);
alter table public.whatsapp_health enable row level security;
revoke all on public.whatsapp_health from anon, authenticated;
grant all on public.whatsapp_health to service_role;
create policy health_service on public.whatsapp_health to service_role using(true) with check(true);

create or replace function crm_private.notify_team(cid uuid, event text, title_text text, body_text text, target text, owner_id uuid default null)
returns void language sql security definer set search_path='' as $$
 insert into public.notifications(company_id,profile_id,event_key,title,body,link)
 select cid,p.id,event,title_text,body_text,target from public.profiles p
 where p.company_id=cid and p.status='ativo' and (
   (owner_id is not null and p.id=owner_id) or
   exists(select 1 from public.user_roles r where r.profile_id=p.id and r.company_id=cid and r.role in ('administrador','gerente')) or
   (owner_id is null and exists(select 1 from public.user_roles r join public.permissions a on a.role=r.role
     where r.profile_id=p.id and r.company_id=cid and a.resource='quotes' and a.can_update))
 ) on conflict (profile_id,event_key) where event_key is not null do nothing;
$$;
revoke all on function crm_private.notify_team(uuid,text,text,text,text,uuid) from public,anon,authenticated;

alter table public.triage_sessions add column quote_id uuid references public.quotes(id) on delete set null;
create unique index triage_quote_once on public.triage_sessions(quote_id) where quote_id is not null;
alter table public.quotes add column triage_session_id uuid references public.triage_sessions(id) on delete set null,
 add column sent_at timestamptz, add column followup_notified_at timestamptz;
create unique index quotes_triage_once on public.quotes(triage_session_id) where triage_session_id is not null;
create index quotes_sent_followup on public.quotes(sent_at) where status='enviado' and followup_notified_at is null;

create or replace function crm_private.triage_draft() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; qid uuid; sale_type uuid; person uuid; data jsonb; product_text text; details text;
        phone_key text; qty numeric:=1; entry jsonb; entries jsonb; linked_lead uuid;
begin
 if new.status <> 'concluida' or new.eh_manutencao or new.quote_id is not null then return new; end if;
 -- Locking the session serializes retries and competing webhooks.
 select id into qid from public.quotes where triage_session_id=new.id;
 if qid is not null then return new; end if;
 data:=coalesce(new.dados_coletados,'{}'::jsonb);
 phone_key:=public.client_phone_key(new.phone);
 if length(phone_key)<10 then raise exception 'Telefone da triagem inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||phone_key,0));
 select id into cid from public.clients where company_id=new.company_id and
   (public.client_phone_key(phone)=phone_key or public.client_phone_key(whatsapp)=phone_key) limit 1;
 if cid is null then
   insert into public.clients(company_id,name,phone,whatsapp,city,neighborhood,address,lead_source)
   values(new.company_id,coalesce(nullif(new.nome,''),nullif(data->>'nome',''),'Contato WhatsApp '||new.phone),new.phone,new.phone,
          coalesce(new.cidade,data->>'cidade'),coalesce(new.bairro,data->>'bairro'),coalesce(new.rua,data->>'rua'),'WhatsApp') returning id into cid;
 end if;
 select assigned_to into person from public.conversations where company_id=new.company_id and
   (id=new.conversation_id or external_id=new.phone) order by (id=new.conversation_id) desc nulls last limit 1;
 if not exists(select 1 from public.profiles where id=person and company_id=new.company_id and status='ativo') then person:=null; end if;
 product_text:=coalesce(nullif(new.produto,''),nullif(data->>'produto',''),nullif(new.tipo_servico,''),'Peça a conferir');
 select id into sale_type from public.sale_types where company_id=new.company_id and active order by
  case when product_text ilike any(array['%calha%','%rufo%','%pingadeira%','%chapa%','%condutor%']) then
    case when name ilike 'Calhas%' then 0 else 1 end
  else case when name ilike 'Esquadrias%' then 0 else 1 end end, name limit 1;
 if sale_type is null then raise exception 'Nenhum tipo de venda ativo para o rascunho'; end if;
 details:=concat_ws(E'\n',new.resumo_executivo,'Dados informados pelo cliente (conferir medidas e unidades):',jsonb_pretty(data));
 if coalesce(data->>'quantidade','') ~ '^\d+([.,]\d+)?$' then
   qty:=greatest(0.001,least(999999,replace(data->>'quantidade',',','.')::numeric));
 end if;
 insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,attendant_id,status,notes,triage_session_id,valid_until)
 values(new.company_id,public.next_number('ORC','public.quotes',new.company_id),cid,sale_type,person,person,'rascunho',details,new.id,
 current_date+coalesce((select default_validity_days from public.companies where id=new.company_id),7)) returning id into qid;
 entries:=data->'itens';
 if jsonb_typeof(entries) is distinct from 'array' or entries='[]'::jsonb then
  entries:=jsonb_build_array(jsonb_build_object('produto',product_text,'medidas',coalesce(data->'medidas',to_jsonb(new.medidas)),'quantidade',qty));
 end if;
 for entry in select value from jsonb_array_elements(entries) limit 100 loop
  qty:=1;
  if coalesce(entry->>'quantidade','') ~ '^\d+([.,]\d+)?$' then qty:=greatest(0.001,least(999999,replace(entry->>'quantidade',',','.')::numeric)); end if;
  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,metadata,item_type)
  values(new.company_id,qid,coalesce(nullif(entry->>'produto',''),product_text),
   concat_ws(E'\n',entry->>'medidas',entry->>'cor',entry->>'linha',details),coalesce(nullif(entry->>'unidade',''),'un'),qty,0,
   jsonb_build_object('triage_data',data,'triage_item',entry,'needs_review',true),'triagem');
 end loop;
 select id into linked_lead from public.leads where company_id=new.company_id and client_id=cid and status='aberto' order by created_at desc limit 1;
 update public.triage_sessions set quote_id=qid,lead_id=coalesce(lead_id,linked_lead) where id=new.id;
 update public.conversations set client_id=cid,ai_paused=true where company_id=new.company_id and (id=new.conversation_id or external_id=new.phone);
 perform crm_private.notify_team(new.company_id,'triage:'||new.id,'Triagem concluída: orçamento rascunho',
  coalesce(new.nome,new.phone)||' · '||product_text||'. Confira medidas e preencha os preços.','/orcamentos/'||qid||'/editar',person);
 return new;
end; $$;
revoke all on function crm_private.triage_draft() from public,anon,authenticated;
create trigger triage_create_draft after insert or update of status on public.triage_sessions for each row execute function crm_private.triage_draft();

create or replace function crm_private.quote_sent_clock() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='enviado' and (tg_op='INSERT' or old.status is distinct from new.status) then
   new.sent_at:=now(); new.followup_notified_at:=null;
 elsif new.status<>'enviado' then new.followup_notified_at:=null;
 end if;
 return new;
end; $$;
revoke all on function crm_private.quote_sent_clock() from public,anon,authenticated;
create trigger quote_sent_clock before insert or update of status on public.quotes for each row execute function crm_private.quote_sent_clock();
-- Historical send times are unknown; start their clock at activation, not quote creation.
update public.quotes set sent_at=now() where status='enviado' and sent_at is null;

create or replace function public.collect_quote_followups() returns integer language plpgsql security invoker set search_path='' as $$
declare q record; n integer:=0;
begin
 for q in select * from public.quotes where status='enviado' and sale_id is null and approved_at is null
  and sent_at<=now()-interval '3 days' and followup_notified_at is null for update skip locked loop
   if not exists(select 1 from public.conversations c join public.messages m on m.conversation_id=c.id
    where c.company_id=q.company_id and c.client_id=q.client_id and m.direction='inbound' and m.sent_at>q.sent_at) then
    perform crm_private.notify_team(q.company_id,'quote-followup:'||q.id||':'||q.sent_at,
     'Orçamento sem resposta há 3 dias',q.quote_number||' · Consulte o cliente para esclarecer dúvidas.','/orcamentos/'||q.id,coalesce(q.attendant_id,q.seller_id));
    n:=n+1;
   end if;
   update public.quotes set followup_notified_at=now() where id=q.id;
 end loop;
 return n;
end; $$;
revoke all on function public.collect_quote_followups() from public,anon,authenticated;
grant execute on function public.collect_quote_followups() to service_role;
grant usage on schema crm_private to service_role;
grant execute on function crm_private.notify_team(uuid,text,text,text,text,uuid) to service_role;

create or replace function public.record_whatsapp_health(p_company_id uuid,p_state text) returns void language plpgsql security invoker set search_path='' as $$
declare h public.whatsapp_health; was_down boolean;
begin
 insert into public.whatsapp_health(company_id) values(p_company_id) on conflict do nothing;
 select * into h from public.whatsapp_health where company_id=p_company_id for update;
 was_down:=h.incident_id is not null;
 if p_state='open' then
  if was_down then perform crm_private.notify_team(p_company_id,'wa-restored:'||h.incident_id,'WhatsApp reconectado','As mensagens voltaram a entrar no Atendimento.','/atendimento'); end if;
  update public.whatsapp_health set state='open',failed_checks=0,incident_id=null,checked_at=now() where company_id=p_company_id;
 else
  h.failed_checks:=h.failed_checks+1;
  -- Two consecutive failed probes (one minute apart) suppress brief restarts.
  if h.failed_checks>=2 and not was_down then
   h.incident_id:=gen_random_uuid();
   perform crm_private.notify_team(p_company_id,'wa-down:'||h.incident_id,'WhatsApp desconectado',
    'As mensagens podem ter parado. Verifique o PC, Docker e a conexão do WhatsApp na Central de IA.','/central-ia');
  end if;
  update public.whatsapp_health set state=left(p_state,40),failed_checks=h.failed_checks,incident_id=h.incident_id,checked_at=now() where company_id=p_company_id;
 end if;
end; $$;
revoke all on function public.record_whatsapp_health(uuid,text) from public,anon,authenticated;
grant execute on function public.record_whatsapp_health(uuid,text) to service_role;

create or replace function public.save_triage_draft(p_quote_id uuid,p_items jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare q public.quotes; i jsonb; item_count integer;
begin
 perform public.require_table_access('quotes','update');
 select * into q from public.quotes where id=p_quote_id and company_id=public.current_company_id() for update;
 if q.id is null or q.status<>'rascunho' or q.triage_session_id is null then raise exception 'Rascunho indisponível'; end if;
 select count(*) into item_count from public.quote_items where quote_id=q.id;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<>item_count then raise exception 'Itens inválidos'; end if;
 if (select count(distinct v->>'id') from jsonb_array_elements(p_items) v)<>item_count then raise exception 'Itens repetidos'; end if;
 for i in select * from jsonb_array_elements(p_items) loop
  if not exists(select 1 from public.quote_items where id=(i->>'id')::uuid and quote_id=q.id and company_id=q.company_id)
   or nullif(trim(i->>'product'),'') is null or (i->>'quantity')::numeric is null or (i->>'quantity')::numeric<=0
   or (i->>'unit_price')::numeric is null or (i->>'unit_price')::numeric<0 then raise exception 'Revise os itens'; end if;
  update public.quote_items set product=left(i->>'product',500),description=left(i->>'description',12000),
    quantity=(i->>'quantity')::numeric,unit_price=(i->>'unit_price')::numeric, metadata=metadata||'{"needs_review":false}'::jsonb where id=(i->>'id')::uuid;
 end loop;
 update public.quotes set subtotal=(select coalesce(sum(quantity*unit_price),0) from public.quote_items where quote_id=q.id) where id=q.id;
end; $$;
revoke all on function public.save_triage_draft(uuid,jsonb) from public,anon;
grant execute on function public.save_triage_draft(uuid,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('atendimento-files','atendimento-files',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp','audio/ogg','audio/mpeg','audio/mp4','audio/aac','audio/wav','audio/webm'])
 on conflict(id) do nothing;
-- Private bucket: all upload URLs and downloads require a scoped server-side check.

create or replace function crm_private.operations_tick() returns bigint language plpgsql security invoker set search_path='' as $$
declare request_id bigint;
begin
 select net.http_post(
  url:='https://crm-bielenki.vercel.app/api/internal/operations',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||cron_secret),
  body:='{}'::jsonb,timeout_milliseconds:=55000
 ) into request_id from public.crm_operations_config where id=true;
 return request_id;
end; $$;
revoke all on function crm_private.operations_tick() from public,anon,authenticated;
