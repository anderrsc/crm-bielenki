begin;
-- Contatos novos do WhatsApp chegam como "@lid" (identificador interno), muitas vezes
-- sem o numero de telefone. Antes essas mensagens eram descartadas. Agora a conversa
-- fica com o identificador "NNN@lid" e passa para o telefone quando ele aparecer.
create table if not exists public.whatsapp_lid_map (
  company_id uuid not null references public.companies(id) on delete cascade,
  lid text not null check (lid ~ '^[0-9]{5,25}@lid$'),
  phone text not null check (phone ~ '^[0-9]{10,15}$'),
  updated_at timestamptz not null default now(),
  primary key (company_id, lid)
);
alter table public.whatsapp_lid_map enable row level security;
revoke all on public.whatsapp_lid_map from public, anon, authenticated;
grant select on public.whatsapp_lid_map to authenticated;
drop policy if exists lid_map_select on public.whatsapp_lid_map;
create policy lid_map_select on public.whatsapp_lid_map for select to authenticated
  using (company_id = (select public.current_company_id()));

-- Registra lid -> telefone e junta a conversa que estava so com o lid na do telefone.
-- Chamada pelo webhook (service role) e pela importacao do historico (usuario da empresa).
create or replace function public.link_whatsapp_lid(p_company uuid, p_lid text, p_phone text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare lid_conv uuid; phone_conv uuid;
begin
  if p_lid !~ '^[0-9]{5,25}@lid$' or p_phone !~ '^[0-9]{10,15}$' then return; end if;
  -- Usuario logado so mexe na propria empresa; o service role (sem usuario) mexe em qualquer uma.
  if auth.uid() is not null and p_company is distinct from public.current_company_id() then
    raise exception 'Empresa invalida' using errcode = '42501';
  end if;
  insert into public.whatsapp_lid_map(company_id, lid, phone) values (p_company, p_lid, p_phone)
    on conflict (company_id, lid) do update set phone = excluded.phone, updated_at = now();
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || p_phone, 0));
  select id into lid_conv from public.conversations where company_id = p_company and channel = 'whatsapp' and external_id = p_lid limit 1;
  if lid_conv is null then return; end if;
  select id into phone_conv from public.conversations where company_id = p_company and channel = 'whatsapp' and external_id = p_phone limit 1;
  if phone_conv is null then
    update public.conversations set external_id = p_phone, phone = p_phone where id = lid_conv;
  else
    update public.messages set conversation_id = phone_conv where conversation_id = lid_conv;
    update public.triage_sessions set conversation_id = phone_conv where conversation_id = lid_conv;
    update public.outbound_messages set conversation_id = phone_conv where conversation_id = lid_conv;
    update public.conversations p set
      last_message_at = greatest(p.last_message_at, l.last_message_at),
      last_message_preview = case when l.last_message_at > p.last_message_at then l.last_message_preview else p.last_message_preview end,
      unread_count = coalesce(p.unread_count, 0) + coalesce(l.unread_count, 0),
      contact_name = coalesce(p.contact_name, l.contact_name)
    from public.conversations l where p.id = phone_conv and l.id = lid_conv;
    delete from public.conversations where id = lid_conv;
  end if;
end $$;
revoke all on function public.link_whatsapp_lid(uuid, text, text) from public, anon;
grant execute on function public.link_whatsapp_lid(uuid, text, text) to authenticated, service_role;
commit;
