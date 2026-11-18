begin;
-- Fase 2: varios numeros de WhatsApp por empresa. Aditivo: a conexao atual vira o
-- canal padrao e as conversas existentes passam a apontar para ele. Nada e apagado;
-- o indice unico antigo (empresa+contato) e substituido por empresa+canal+contato.
create table if not exists public.whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  provider text not null check (provider in ('evolution','meta')),
  instance text check (instance is null or instance ~ '^[A-Za-z0-9_-]{2,40}$'),
  phone_number_id text,
  phone_display text,
  -- Credenciais proprias (criptografadas pelo app). Nulas = usa a conexao da empresa (ai_agent_config).
  api_url text, api_key text, meta_token text, webhook_secret text,
  is_default boolean not null default false,
  -- Dono (quem conectou lendo o QR). shared = toda a equipe ve (canal da empresa).
  owner_id uuid default auth.uid() references public.profiles(id),
  shared boolean not null default false,
  active boolean not null default true,
  status text,
  last_event_at timestamptz, last_sync_at timestamptz, last_sent_at timestamptz,
  failed_events integer not null default 0,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((provider = 'evolution' and instance is not null) or (provider = 'meta' and phone_number_id is not null))
);
create unique index if not exists whatsapp_channels_instance_key on public.whatsapp_channels(provider, instance) where instance is not null and deleted_at is null;
create unique index if not exists whatsapp_channels_phone_id_key on public.whatsapp_channels(provider, phone_number_id) where phone_number_id is not null and deleted_at is null;
create unique index if not exists whatsapp_channels_one_default on public.whatsapp_channels(company_id) where is_default and deleted_at is null;
create index if not exists whatsapp_channels_company_idx on public.whatsapp_channels(company_id);
create index if not exists whatsapp_channels_created_by_idx on public.whatsapp_channels(created_by);
create index if not exists whatsapp_channels_owner_idx on public.whatsapp_channels(owner_id);
alter table public.whatsapp_channels enable row level security;
revoke all on public.whatsapp_channels from public, anon, authenticated;
-- Equipe ve os canais da empresa, nunca as credenciais (colunas de segredo sem grant).
grant select (id, company_id, name, provider, instance, phone_number_id, phone_display, is_default, owner_id, shared, active, status,
  last_event_at, last_sync_at, last_sent_at, failed_events, created_at, updated_at, deleted_at) on public.whatsapp_channels to authenticated;
drop policy if exists whatsapp_channels_select on public.whatsapp_channels;
create policy whatsapp_channels_select on public.whatsapp_channels for select to authenticated
  using (company_id = (select public.current_company_id()));

-- Canal padrao a partir da conexao atual de cada empresa.
insert into public.whatsapp_channels(company_id, name, provider, instance, phone_number_id, is_default, status, shared, owner_id)
select c.company_id, 'WhatsApp principal',
  case when coalesce(c.wpp_provider, case when c.evolution_api_url is not null then 'evolution' else 'meta' end) = 'evolution' then 'evolution' else 'meta' end,
  case when coalesce(c.wpp_provider, case when c.evolution_api_url is not null then 'evolution' else 'meta' end) = 'evolution' then coalesce(nullif(c.evolution_instance,''), 'crm') end,
  case when coalesce(c.wpp_provider, case when c.evolution_api_url is not null then 'evolution' else 'meta' end) <> 'evolution' then coalesce(nullif(c.whatsapp_number_id,''), nullif(co.whatsapp_phone_number_id,'')) end,
  true, 'migrado', true, null
from public.ai_agent_config c join public.companies co on co.id = c.company_id
where (coalesce(c.wpp_provider,'') = 'evolution' or c.evolution_api_url is not null or nullif(c.whatsapp_number_id,'') is not null or nullif(co.whatsapp_phone_number_id,'') is not null)
  and not exists (select 1 from public.whatsapp_channels w where w.company_id = c.company_id and w.is_default and w.deleted_at is null)
  and (case when coalesce(c.wpp_provider, case when c.evolution_api_url is not null then 'evolution' else 'meta' end) = 'evolution' then true
       else coalesce(nullif(c.whatsapp_number_id,''), nullif(co.whatsapp_phone_number_id,'')) is not null end)
on conflict do nothing;

alter table public.conversations add column if not exists channel_id uuid references public.whatsapp_channels(id);
create index if not exists conversations_channel_idx on public.conversations(channel_id);
update public.conversations c set channel_id = w.id
  from public.whatsapp_channels w
  where c.channel = 'whatsapp' and c.channel_id is null and w.company_id = c.company_id and w.is_default and w.deleted_at is null;

-- Conversa = empresa + canal + contato. O mesmo cliente pode falar com dois numeros.
create unique index if not exists conversations_contact_per_channel on public.conversations(company_id, channel_id, external_id)
  where external_id is not null and channel_id is not null;
create unique index if not exists conversations_contact_legacy on public.conversations(company_id, channel, external_id)
  where external_id is not null and channel_id is null;
drop index if exists public.conversations_one_per_contact;

-- Conversa nova de WhatsApp sem canal informado vai para o canal padrao (codigo antigo continua seguro).
create or replace function crm_private.conversation_default_channel() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.channel = 'whatsapp' and new.channel_id is null then
    select id into new.channel_id from public.whatsapp_channels where company_id = new.company_id and is_default and deleted_at is null limit 1;
  end if;
  if new.channel_id is not null and not exists(select 1 from public.whatsapp_channels where id = new.channel_id and company_id = new.company_id) then
    raise exception 'Canal de WhatsApp invalido para esta empresa';
  end if;
  return new;
end $$;
revoke all on function crm_private.conversation_default_channel() from public, anon, authenticated;
drop trigger if exists conversations_default_channel on public.conversations;
create trigger conversations_default_channel before insert or update of channel_id, company_id on public.conversations
  for each row execute function crm_private.conversation_default_channel();

-- Juntar conversa "@lid" com a do telefone so dentro do mesmo canal.
create or replace function public.link_whatsapp_lid(p_company uuid, p_lid text, p_phone text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare lid_conv record; phone_conv uuid;
begin
  if p_lid !~ '^[0-9]{5,25}@lid$' or p_phone !~ '^[0-9]{10,15}$' then return; end if;
  if auth.uid() is not null and p_company is distinct from public.current_company_id() then
    raise exception 'Empresa invalida' using errcode = '42501';
  end if;
  insert into public.whatsapp_lid_map(company_id, lid, phone) values (p_company, p_lid, p_phone)
    on conflict (company_id, lid) do update set phone = excluded.phone, updated_at = now();
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || p_phone, 0));
  for lid_conv in select id, channel_id from public.conversations where company_id = p_company and channel = 'whatsapp' and external_id = p_lid loop
    select id into phone_conv from public.conversations where company_id = p_company and channel = 'whatsapp' and external_id = p_phone
      and channel_id is not distinct from lid_conv.channel_id limit 1;
    if phone_conv is null then
      update public.conversations set external_id = p_phone, phone = p_phone where id = lid_conv.id;
    else
      update public.messages set conversation_id = phone_conv where conversation_id = lid_conv.id;
      update public.triage_sessions set conversation_id = phone_conv where conversation_id = lid_conv.id;
      update public.outbound_messages set conversation_id = phone_conv where conversation_id = lid_conv.id;
      update public.conversations p set
        last_message_at = greatest(p.last_message_at, l.last_message_at),
        last_message_preview = case when l.last_message_at > p.last_message_at then l.last_message_preview else p.last_message_preview end,
        unread_count = coalesce(p.unread_count, 0) + coalesce(l.unread_count, 0),
        contact_name = coalesce(p.contact_name, l.contact_name)
      from public.conversations l where p.id = phone_conv and l.id = lid_conv.id;
      delete from public.conversations where id = lid_conv.id;
    end if;
  end loop;
end $$;
revoke all on function public.link_whatsapp_lid(uuid, text, text) from public, anon;
grant execute on function public.link_whatsapp_lid(uuid, text, text) to authenticated, service_role;

-- Quem pode ver as conversas de cada numero: dono, autorizados, gerencia; canal da empresa (shared) = todos.
create table if not exists public.whatsapp_channel_members (
  channel_id uuid not null references public.whatsapp_channels(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  granted_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (channel_id, profile_id)
);
create index if not exists whatsapp_channel_members_profile_idx on public.whatsapp_channel_members(profile_id);
create index if not exists whatsapp_channel_members_company_idx on public.whatsapp_channel_members(company_id);
create index if not exists whatsapp_channel_members_granted_idx on public.whatsapp_channel_members(granted_by);
alter table public.whatsapp_channel_members enable row level security;
revoke all on public.whatsapp_channel_members from public, anon, authenticated;
grant select on public.whatsapp_channel_members to authenticated;
drop policy if exists whatsapp_channel_members_select on public.whatsapp_channel_members;
create policy whatsapp_channel_members_select on public.whatsapp_channel_members for select to authenticated
  using (company_id = (select public.current_company_id()));

-- Canais que o usuario logado pode ver (uma vez por consulta, nao por linha).
create or replace function public.my_whatsapp_channels() returns uuid[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(w.id), array[]::uuid[]) from public.whatsapp_channels w
  where w.company_id = public.current_company_id() and w.deleted_at is null and (
    w.shared or w.owner_id = auth.uid()
    or exists(select 1 from public.whatsapp_channel_members m where m.channel_id = w.id and m.profile_id = auth.uid())
    or exists(select 1 from unnest(public.current_user_roles()) r where r::text in ('administrador','gerente')))
$$;
revoke all on function public.my_whatsapp_channels() from public, anon;
grant execute on function public.my_whatsapp_channels() to authenticated;

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('conversations','select'))
    and (channel_id is null or (select public.my_whatsapp_channels()) @> array[channel_id]));
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('conversations','update'))
    and (channel_id is null or (select public.my_whatsapp_channels()) @> array[channel_id]));
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('messages','select'))
    and exists(select 1 from public.conversations c where c.id = messages.conversation_id
      and (c.channel_id is null or (select public.my_whatsapp_channels()) @> array[c.channel_id])));

-- Dono do numero (ou gerencia) autoriza/retira o acesso de outro usuario. Auditado.
create or replace function public.set_whatsapp_channel_access(p_channel uuid, p_profile uuid, p_allow boolean)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare w public.whatsapp_channels; c uuid := public.current_company_id();
begin
  select * into w from public.whatsapp_channels where id = p_channel and company_id = c and deleted_at is null;
  if w.id is null then raise exception 'Canal nao encontrado'; end if;
  if w.owner_id is distinct from auth.uid() and not exists(select 1 from unnest(public.current_user_roles()) r where r::text in ('administrador','gerente')) then
    raise exception 'Somente quem conectou o numero ou a gerencia autoriza acesso' using errcode = '42501'; end if;
  if not exists(select 1 from public.profiles where id = p_profile and company_id = c) then raise exception 'Usuario invalido'; end if;
  if p_allow then
    insert into public.whatsapp_channel_members(channel_id, profile_id, company_id) values (w.id, p_profile, c) on conflict do nothing;
  else
    delete from public.whatsapp_channel_members where channel_id = w.id and profile_id = p_profile;
  end if;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'whatsapp_channels', w.id, case when p_allow then 'GRANT' else 'REVOKE' end, null, jsonb_build_object('usuario', p_profile));
end $$;
revoke all on function public.set_whatsapp_channel_access(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_whatsapp_channel_access(uuid,uuid,boolean) to authenticated;
commit;
