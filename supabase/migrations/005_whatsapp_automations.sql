-- Automações reais de cobrança, confirmação de pagamento, agenda e chatbot.
alter table public.companies add column if not exists whatsapp_phone_number_id text unique;
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  event text not null check(event in ('payment_reminder','payment_confirmation','appointment_reminder','chatbot_welcome','chatbot_reply')),
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,event,name)
);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  automation_type text not null check(automation_type in ('payment_reminder','payment_confirmation','appointment_reminder')),
  template_id uuid not null references public.message_templates(id),
  enabled boolean not null default true,
  channel text not null default 'whatsapp' check(channel='whatsapp'),
  days_before integer not null default 1 check(days_before between 0 and 30),
  send_time time not null default '09:00',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,automation_type)
);

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid references public.clients(id),
  template_id uuid references public.message_templates(id),
  conversation_id uuid references public.conversations(id),
  automation_type text not null,
  phone text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null default now(),
  status text not null default 'pending' check(status in ('pending','processing','sent','failed','cancelled')),
  attempts integer not null default 0,
  external_id text,
  error_message text,
  dedupe_key text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,dedupe_key)
);

create table public.chatbot_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  phone text not null,
  current_step text not null default 'menu',
  data jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default now()+interval '24 hours',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outbound_ready_idx on public.outbound_messages(status,scheduled_at) where status='pending';
create index automation_rules_company_idx on public.automation_rules(company_id,enabled);

alter table public.message_templates enable row level security;
alter table public.automation_rules enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.chatbot_sessions enable row level security;

create policy automation_templates_company on public.message_templates for all to authenticated using(company_id=public.current_company_id() and public.has_role(array['administrador','gerente','financeiro','atendente']::public.app_role[])) with check(company_id=public.current_company_id());
create policy automation_rules_company on public.automation_rules for all to authenticated using(company_id=public.current_company_id() and public.has_role(array['administrador','gerente','financeiro','atendente']::public.app_role[])) with check(company_id=public.current_company_id());
create policy outbound_messages_company on public.outbound_messages for select to authenticated using(company_id=public.current_company_id() and public.has_role(array['administrador','gerente','financeiro','atendente']::public.app_role[]));
create policy outbound_messages_create on public.outbound_messages for insert to authenticated with check(company_id=public.current_company_id() and public.has_role(array['administrador','gerente','financeiro','atendente']::public.app_role[]));
create policy chatbot_sessions_company on public.chatbot_sessions for select to authenticated using(company_id=public.current_company_id() and public.has_role(array['administrador','gerente','atendente']::public.app_role[]));

create or replace function public.render_message(p_body text,p_values jsonb) returns text language plpgsql immutable as $$
declare result text:=p_body; item record;
begin
  for item in select key,value from jsonb_each_text(p_values) loop result:=replace(result,'{{'||item.key||'}}',item.value); end loop;
  return result;
end $$;

create or replace function public.seed_company_automations(p_company_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare reminder uuid; confirmation uuid; appointment uuid;
begin
  insert into public.message_templates(company_id,name,event,body) values
    (p_company_id,'Lembrete de cobrança','payment_reminder','Olá, {{cliente}}! Aqui é da {{empresa}}. Lembramos que há um valor de {{valor}} com vencimento em {{vencimento}}. Se já realizou o pagamento, desconsidere esta mensagem.'),
    (p_company_id,'Pagamento confirmado','payment_confirmation','Olá, {{cliente}}! Confirmamos o recebimento de {{valor_pago}}. Obrigado! Saldo atual: {{saldo}}.'),
    (p_company_id,'Lembrete de agendamento','appointment_reminder','Olá, {{cliente}}! Sua visita/instalação com a {{empresa}} está agendada para {{data}}. Responda CONFIRMAR para confirmar ou REAGENDAR para falar com nossa equipe.'),
    (p_company_id,'Boas-vindas do chatbot','chatbot_welcome','Olá! Sou o atendimento virtual da {{empresa}}. Digite: 1 Financeiro, 2 Agendamento, 3 Falar com atendente.')
  on conflict do nothing;
  select id into reminder from public.message_templates where company_id=p_company_id and event='payment_reminder' order by created_at limit 1;
  select id into confirmation from public.message_templates where company_id=p_company_id and event='payment_confirmation' order by created_at limit 1;
  select id into appointment from public.message_templates where company_id=p_company_id and event='appointment_reminder' order by created_at limit 1;
  insert into public.automation_rules(company_id,automation_type,template_id,enabled,days_before,send_time) values
    (p_company_id,'payment_reminder',reminder,true,1,'09:00'),
    (p_company_id,'payment_confirmation',confirmation,true,0,'09:00'),
    (p_company_id,'appointment_reminder',appointment,true,1,'09:00')
  on conflict(company_id,automation_type) do nothing;
end $$;

create or replace function public.seed_new_company_automations() returns trigger language plpgsql security definer set search_path=public as $$ begin perform public.seed_company_automations(new.id); return new; end $$;
create trigger company_automation_defaults after insert on public.companies for each row execute function public.seed_new_company_automations();
do $$ declare c uuid; begin for c in select id from public.companies loop perform public.seed_company_automations(c); end loop; end $$;

create or replace function public.queue_payment_confirmation() returns trigger language plpgsql security definer set search_path=public as $$
declare e public.financial_entries; c public.clients; rule public.automation_rules; template public.message_templates; company_name text; remaining numeric;
begin
  select * into e from public.financial_entries where id=new.financial_entry_id;
  if e.entry_type<>'receber' or e.client_id is null then return new; end if;
  select * into rule from public.automation_rules where company_id=e.company_id and automation_type='payment_confirmation' and enabled;
  if rule.id is null then return new; end if;
  select * into c from public.clients where id=e.client_id; select * into template from public.message_templates where id=rule.template_id and active;
  if template.id is null or coalesce(c.whatsapp,c.phone) is null then return new; end if;
  select coalesce(trade_name,name) into company_name from public.companies where id=e.company_id;
  remaining:=greatest(e.total_amount-(e.paid_amount+new.amount),0);
  insert into public.outbound_messages(company_id,client_id,template_id,automation_type,phone,body,payload,dedupe_key)
  values(e.company_id,c.id,template.id,'payment_confirmation',coalesce(c.whatsapp,c.phone),public.render_message(template.body,jsonb_build_object('cliente',c.name,'empresa',company_name,'valor_pago',to_char(new.amount,'FM999G999G990D00'),'saldo',to_char(remaining,'FM999G999G990D00'))),jsonb_build_object('payment_id',new.id),'payment-confirmation-'||new.id::text)
  on conflict do nothing;
  return new;
end $$;
create trigger payment_confirmation_queue after insert on public.payments for each row execute function public.queue_payment_confirmation();

create or replace function public.enqueue_due_automations() returns integer language plpgsql security definer set search_path=public as $$
declare queued integer:=0; row record;
begin
  for row in
    select fe.id entry_id,fe.company_id,fe.open_amount,fe.due_date,c.id client_id,c.name client_name,coalesce(c.whatsapp,c.phone) phone,coalesce(co.trade_name,co.name) company_name,r.id rule_id,r.days_before,r.send_time,t.id template_id,t.body
    from public.financial_entries fe join public.clients c on c.id=fe.client_id join public.companies co on co.id=fe.company_id join public.automation_rules r on r.company_id=fe.company_id and r.automation_type='payment_reminder' and r.enabled join public.message_templates t on t.id=r.template_id and t.active
    where fe.entry_type='receber' and fe.open_amount>0 and fe.status not in ('pago','cancelado') and coalesce(c.whatsapp,c.phone) is not null and fe.due_date<=current_date+r.days_before
  loop
    insert into public.outbound_messages(company_id,client_id,template_id,automation_type,phone,body,payload,scheduled_at,dedupe_key)
    values(row.company_id,row.client_id,row.template_id,'payment_reminder',row.phone,public.render_message(row.body,jsonb_build_object('cliente',row.client_name,'empresa',row.company_name,'valor',to_char(row.open_amount,'FM999G999G990D00'),'vencimento',to_char(row.due_date,'DD/MM/YYYY'))),jsonb_build_object('financial_entry_id',row.entry_id),greatest(now(),(row.due_date+row.send_time-row.days_before*interval '1 day')::timestamptz), 'payment-reminder-'||row.entry_id::text||'-'||current_date::text)
    on conflict do nothing; if found then queued:=queued+1; end if;
  end loop;
  for row in
    select i.id installation_id,i.company_id,i.scheduled_at,c.id client_id,c.name client_name,coalesce(c.whatsapp,c.phone) phone,coalesce(co.trade_name,co.name) company_name,r.days_before,r.send_time,t.id template_id,t.body
    from public.installations i join public.orders o on o.id=i.order_id join public.clients c on c.id=o.client_id join public.companies co on co.id=i.company_id join public.automation_rules r on r.company_id=i.company_id and r.automation_type='appointment_reminder' and r.enabled join public.message_templates t on t.id=r.template_id and t.active
    where i.status not in ('concluida','cancelada') and i.scheduled_at is not null and i.scheduled_at::date<=current_date+r.days_before and coalesce(c.whatsapp,c.phone) is not null
  loop
    insert into public.outbound_messages(company_id,client_id,template_id,automation_type,phone,body,payload,scheduled_at,dedupe_key)
    values(row.company_id,row.client_id,row.template_id,'appointment_reminder',row.phone,public.render_message(row.body,jsonb_build_object('cliente',row.client_name,'empresa',row.company_name,'data',to_char(row.scheduled_at,'DD/MM/YYYY HH24:MI'))),jsonb_build_object('installation_id',row.installation_id),greatest(now(),row.scheduled_at-row.days_before*interval '1 day'),'appointment-reminder-'||row.installation_id::text)
    on conflict do nothing; if found then queued:=queued+1; end if;
  end loop;
  return queued;
end $$;

grant execute on function public.enqueue_due_automations() to service_role;
