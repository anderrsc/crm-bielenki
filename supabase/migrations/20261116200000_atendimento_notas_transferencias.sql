-- Atendimento: notas internas, transferência entre atendentes e setores, e status da
-- conversa, tudo com histórico. Nada disso vai para o cliente nem para a Lia.
alter table public.conversations
  add column if not exists department text,
  add column if not exists status_changed_at timestamptz;

create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  kind text not null check (kind in ('nota','transferencia','status')),
  body text,
  to_profile uuid references public.profiles(id) on delete set null,
  department text,
  status text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists conversation_events_conv_idx on public.conversation_events(conversation_id, created_at);

alter table public.conversation_events enable row level security;
drop policy if exists conversation_events_select on public.conversation_events;
create policy conversation_events_select on public.conversation_events for select to authenticated
  using (company_id = public.current_company_id());
revoke insert, update, delete on public.conversation_events from authenticated, anon;
grant select on public.conversation_events to authenticated;
grant all on public.conversation_events to service_role;

create or replace function crm_private.inbox_conversation(p_conversation uuid) returns public.conversations
language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  if auth.uid() is null then raise exception 'Sessão expirada.'; end if;
  select * into c from public.conversations where id = p_conversation and company_id = public.current_company_id() for update;
  if c.id is null then raise exception 'Conversa não encontrada.'; end if;
  return c;
end $$;
revoke all on function crm_private.inbox_conversation(uuid) from public, anon, authenticated;

create or replace function public.conversation_add_note(p_conversation uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.conversations; v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  c := crm_private.inbox_conversation(p_conversation);
  if length(v_body) < 1 or length(v_body) > 2000 then raise exception 'A nota precisa ter de 1 a 2000 caracteres.'; end if;
  insert into public.conversation_events(company_id, conversation_id, kind, body, created_by)
  values (c.company_id, c.id, 'nota', v_body, auth.uid()) returning id into v_id;
  update public.conversations set updated_at = now() where id = c.id;
  return v_id;
end $$;

-- Transfere para uma pessoa e/ou setor. Com pessoa, a Lia para de responder e ela é avisada.
create or replace function public.conversation_transfer(p_conversation uuid, p_to_profile uuid, p_department text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.conversations; v_id uuid; v_dep text := nullif(btrim(coalesce(p_department, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_from text; v_contact text;
begin
  c := crm_private.inbox_conversation(p_conversation);
  if p_to_profile is null and v_dep is null then raise exception 'Escolha uma pessoa ou um setor.'; end if;
  if v_dep is not null and v_dep not in ('comercial','pos_venda','financeiro','producao') then raise exception 'Setor inválido.'; end if;
  if v_note is not null and length(v_note) > 1000 then raise exception 'Observação muito longa.'; end if;
  if p_to_profile is not null and not exists (
    select 1 from public.profiles where id = p_to_profile and company_id = c.company_id and status = 'ativo'
  ) then raise exception 'Atendente não encontrado.'; end if;
  update public.conversations set
    assigned_to = coalesce(p_to_profile, assigned_to),
    department = coalesce(v_dep, department),
    ai_paused = case when p_to_profile is not null then true else ai_paused end,
    ai_generation_id = case when p_to_profile is not null then null else ai_generation_id end,
    updated_at = now()
  where id = c.id;
  insert into public.conversation_events(company_id, conversation_id, kind, body, to_profile, department, created_by)
  values (c.company_id, c.id, 'transferencia', v_note, p_to_profile, v_dep, auth.uid()) returning id into v_id;
  if p_to_profile is not null and p_to_profile <> auth.uid() then
    select full_name into v_from from public.profiles where id = auth.uid();
    v_contact := coalesce(nullif(c.contact_name, ''), c.phone, 'cliente');
    insert into public.notifications(company_id, profile_id, title, body, link)
    values (c.company_id, p_to_profile, 'Conversa transferida para você',
      coalesce(split_part(v_from, ' ', 1), 'Equipe') || ': ' || v_contact || coalesce(' — ' || v_note, ''), '/atendimento?c=' || c.id);
  end if;
  return v_id;
end $$;

create or replace function public.conversation_set_status(p_conversation uuid, p_status text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.conversations; v_id uuid;
begin
  c := crm_private.inbox_conversation(p_conversation);
  if p_status not in ('aberta','aguardando_cliente','resolvida') then raise exception 'Status inválido.'; end if;
  if c.status = p_status then return null; end if;
  update public.conversations set status = p_status, status_changed_at = now(), updated_at = now() where id = c.id;
  insert into public.conversation_events(company_id, conversation_id, kind, status, created_by)
  values (c.company_id, c.id, 'status', p_status, auth.uid()) returning id into v_id;
  return v_id;
end $$;

revoke all on function public.conversation_add_note(uuid, text) from public, anon;
revoke all on function public.conversation_transfer(uuid, uuid, text, text) from public, anon;
revoke all on function public.conversation_set_status(uuid, text) from public, anon;
grant execute on function public.conversation_add_note(uuid, text) to authenticated;
grant execute on function public.conversation_transfer(uuid, uuid, text, text) to authenticated;
grant execute on function public.conversation_set_status(uuid, text) to authenticated;

-- Cliente escreveu de novo numa conversa resolvida ou aguardando: ela volta a ficar aberta.
create or replace function crm_private.conversation_reopen_on_inbound() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'inbound' then
    update public.conversations set status = 'aberta', status_changed_at = now()
    where id = new.conversation_id and status in ('resolvida','aguardando_cliente')
      and (status_changed_at is null or coalesce(new.sent_at, now()) > status_changed_at);
  end if;
  return new;
end $$;
revoke all on function crm_private.conversation_reopen_on_inbound() from public, anon, authenticated;
drop trigger if exists messages_reopen_conversation on public.messages;
create trigger messages_reopen_conversation after insert on public.messages
  for each row execute function crm_private.conversation_reopen_on_inbound();
