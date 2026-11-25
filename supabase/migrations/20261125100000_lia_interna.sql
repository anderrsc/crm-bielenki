-- Lia Interna: assistente de chat interno no CRM com function calling e auditoria de ações.
begin;

-- ── 1. Sessões de chat ────────────────────────────────────────────────────────
create table if not exists public.lia_chat_sessions (
  id          uuid        primary key default gen_random_uuid(),
  company_id  uuid        not null references public.companies(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists lia_chat_sessions_company_user_idx
  on public.lia_chat_sessions(company_id, user_id, created_at desc);

alter table public.lia_chat_sessions enable row level security;

drop policy if exists lia_sessions_own on public.lia_chat_sessions;
create policy lia_sessions_own on public.lia_chat_sessions
  for all to authenticated
  using (company_id = (select public.current_company_id()) and user_id = auth.uid())
  with check (company_id = (select public.current_company_id()) and user_id = auth.uid());

grant select, insert, update on public.lia_chat_sessions to authenticated;
grant all on public.lia_chat_sessions to service_role;

-- ── 2. Mensagens ──────────────────────────────────────────────────────────────
create table if not exists public.lia_messages (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        not null references public.lia_chat_sessions(id) on delete cascade,
  company_id  uuid        not null references public.companies(id) on delete cascade,
  role        text        not null check (role in ('user','assistant','tool')),
  content     text,
  tool_name   text,
  tool_input  jsonb,
  tool_result jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists lia_messages_session_idx
  on public.lia_messages(session_id, created_at);
create index if not exists lia_messages_company_idx
  on public.lia_messages(company_id);

alter table public.lia_messages enable row level security;

drop policy if exists lia_messages_own on public.lia_messages;
create policy lia_messages_own on public.lia_messages
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

grant select, insert on public.lia_messages to authenticated;
grant all on public.lia_messages to service_role;

-- ── 3. Auditoria de ações ────────────────────────────────────────────────────
create table if not exists public.lia_actions (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        references public.lia_chat_sessions(id) on delete set null,
  company_id  uuid        not null references public.companies(id) on delete cascade,
  user_id     uuid        references auth.users(id) on delete set null,
  tool        text        not null,
  params      jsonb       not null default '{}'::jsonb,
  result      jsonb,
  reversed_at timestamptz,
  reversed_by uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists lia_actions_company_idx
  on public.lia_actions(company_id, created_at desc);
create index if not exists lia_actions_session_idx
  on public.lia_actions(session_id, created_at desc);

alter table public.lia_actions enable row level security;

drop policy if exists lia_actions_own on public.lia_actions;
create policy lia_actions_own on public.lia_actions
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

grant select, insert, update on public.lia_actions to authenticated;
grant all on public.lia_actions to service_role;

-- ── 4. Contatos / apelidos ────────────────────────────────────────────────────
create table if not exists public.lia_contacts (
  id          uuid        primary key default gen_random_uuid(),
  company_id  uuid        not null references public.companies(id) on delete cascade,
  apelido     text        not null check (length(btrim(apelido)) between 1 and 100),
  client_id   uuid        references public.clients(id) on delete cascade,
  supplier_id uuid        references public.suppliers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint lia_contacts_apelido_company unique (company_id, apelido),
  constraint lia_contacts_one_party check (
    (client_id is not null and supplier_id is null) or
    (client_id is null and supplier_id is not null)
  )
);

create index if not exists lia_contacts_company_idx
  on public.lia_contacts(company_id, apelido);

alter table public.lia_contacts enable row level security;

drop policy if exists lia_contacts_select on public.lia_contacts;
create policy lia_contacts_select on public.lia_contacts
  for select to authenticated
  using (company_id = (select public.current_company_id()));

drop policy if exists lia_contacts_modify on public.lia_contacts;
create policy lia_contacts_modify on public.lia_contacts
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

grant select, insert, update, delete on public.lia_contacts to authenticated;
grant all on public.lia_contacts to service_role;

commit;
