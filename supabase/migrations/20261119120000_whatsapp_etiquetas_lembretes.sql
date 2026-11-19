-- Atendimento: etiquetas por conversa e lembrete automático de cliente sem resposta.
-- Aditiva: nenhuma tabela ou dado existente é alterado.

create table if not exists public.conversation_labels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  color text not null default 'slate' check (color in ('slate','red','amber','green','blue','purple')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists conversation_labels_name_key on public.conversation_labels(company_id, lower(btrim(name)));

create table if not exists public.conversation_label_links (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  label_id uuid not null references public.conversation_labels(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (conversation_id, label_id)
);
create index if not exists conversation_label_links_label on public.conversation_label_links(label_id);
create index if not exists conversation_label_links_company on public.conversation_label_links(company_id);

alter table public.conversation_labels enable row level security;
alter table public.conversation_label_links enable row level security;
revoke all on public.conversation_labels, public.conversation_label_links from public, anon;
grant select, insert, update, delete on public.conversation_labels, public.conversation_label_links to authenticated;

drop policy if exists conversation_labels_select on public.conversation_labels;
create policy conversation_labels_select on public.conversation_labels for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('conversations','select')));
drop policy if exists conversation_labels_write on public.conversation_labels;
create policy conversation_labels_write on public.conversation_labels for all to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('conversations','update')))
  with check (company_id = (select public.current_company_id()) and (select public.has_table_access('conversations','update')));

-- A conversa precisa ser visível para quem etiqueta (respeita o acesso por número de WhatsApp).
drop policy if exists conversation_label_links_select on public.conversation_label_links;
create policy conversation_label_links_select on public.conversation_label_links for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('conversations','select'))
    and exists(select 1 from public.conversations c where c.id = conversation_id));
drop policy if exists conversation_label_links_write on public.conversation_label_links;
create policy conversation_label_links_write on public.conversation_label_links for all to authenticated
  using (company_id = (select public.current_company_id()) and (select public.has_table_access('conversations','update'))
    and exists(select 1 from public.conversations c where c.id = conversation_id))
  with check (company_id = (select public.current_company_id()) and (select public.has_table_access('conversations','update'))
    and exists(select 1 from public.conversations c where c.id = conversation_id)
    and exists(select 1 from public.conversation_labels l where l.id = label_id and l.company_id = conversation_label_links.company_id));

-- Etiquetas iniciais para as empresas que já existem (novas empresas ganham pela tela).
insert into public.conversation_labels(company_id, name, color)
select c.id, v.name, v.color from public.companies c
cross join (values ('Orçamento','blue'),('Pós-venda','green'),('Urgente','red'),('Garantia','amber')) as v(name,color)
on conflict do nothing;

-- Lembrete: cliente falou por último há mais de 2 h e ninguém respondeu.
-- Só dispara dentro do horário de atendimento (seg–qui 07h30–17h30, sex 07h–12h, Brasília).
-- Avisa quem está atribuído; sem atribuído, avisa administrador e gerente. Uma vez por mensagem do cliente.
create or replace function public.collect_unanswered_conversations(p_now timestamptz default now()) returns integer
language plpgsql security invoker set search_path='' as $$
declare dow int := extract(dow from p_now at time zone 'America/Sao_Paulo');
        t time := (p_now at time zone 'America/Sao_Paulo')::time; open_now boolean; c record; n integer := 0; key text;
begin
  open_now := case when dow between 1 and 4 then t >= time '07:30' and t < time '17:30'
                   when dow = 5 then t >= time '07:00' and t < time '12:00' else false end;
  if not open_now then return 0; end if;
  for c in select cv.id, cv.company_id, cv.assigned_to, cv.last_inbound_at, coalesce(nullif(btrim(cv.contact_name),''), cv.phone, 'Cliente') as nome
    from public.conversations cv
    where cv.last_inbound_at is not null and cv.last_inbound_at <= p_now - interval '2 hours' and cv.last_inbound_at > p_now - interval '3 days'
      and cv.last_message_at is not null and cv.last_message_at <= cv.last_inbound_at + interval '2 seconds'
      and cv.archived_at is null and cv.status <> 'resolvida'
      and (cv.assigned_to is not null or cv.ai_paused)
    for update skip locked loop
    key := 'unanswered:' || c.id || ':' || extract(epoch from c.last_inbound_at)::bigint;
    insert into public.notifications(company_id, profile_id, event_key, title, body, link)
    select c.company_id, p.id, key, 'Cliente sem resposta há mais de 2 horas', c.nome || ' está esperando resposta no Atendimento.', '/atendimento?c=' || c.id
    from public.profiles p
    where p.company_id = c.company_id and p.status = 'ativo' and (
      (c.assigned_to is not null and p.id = c.assigned_to)
      or (c.assigned_to is null and exists(select 1 from public.user_roles r where r.profile_id = p.id and r.company_id = c.company_id and r.role in ('administrador','gerente'))))
    on conflict (profile_id, event_key) where event_key is not null do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end; $$;
revoke all on function public.collect_unanswered_conversations(timestamptz) from public, anon, authenticated;
grant execute on function public.collect_unanswered_conversations(timestamptz) to service_role;
