-- Clientes duplicados: junta cadastros repetidos e impede cadastrar o mesmo cliente de novo.
-- Mesmo cliente = mesmo telefone/WhatsApp, mesmo CPF/CNPJ, ou mesmo nome quando um dos dois
-- não tem telefone. Ao juntar, orçamentos, vendas, pedidos, financeiro, leads etc. passam para o
-- cadastro que fica (o que tem mais registros; empate fica o mais antigo). O cadastro apagado
-- fica guardado em crm_admin.client_merges. Pode ser rodada mais de uma vez.

-- (47) 8495-3693, 4798495-3693, +55 47 98495-3693 → 47984953693.
create or replace function public.client_phone_key(raw text)
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(raw, ''), '\D', '', 'g');
begin
  if length(d) in (12, 13) and left(d, 2) = '55' then d := substr(d, 3); end if;
  if length(d) = 10 and substr(d, 3, 1) between '6' and '9' then d := left(d, 2) || '9' || substr(d, 3); end if;
  if length(d) in (10, 11) then return d; end if;
  if length(d) >= 12 then return '+' || d; end if;
  return null; -- sem DDD não dá para saber se é o mesmo número
end $$;

-- "  Fábio  NICOLAS " → "fabio nicolas".
create or replace function public.client_name_key(raw text)
returns text language sql immutable as $$
  select nullif(lower(regexp_replace(trim(translate(coalesce(raw, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '\s+', ' ', 'g')), '')
$$;

create or replace function public.client_doc_key(raw text)
returns text language sql immutable as $$
  select case when length(d) >= 11 then d end from (select regexp_replace(coalesce(raw, ''), '\D', '', 'g') d) s
$$;

create index if not exists clients_phone_key_idx on public.clients (company_id, public.client_phone_key(coalesce(nullif(phone, ''), whatsapp)));
create index if not exists clients_name_key_idx on public.clients (company_id, public.client_name_key(name));

-- Bloqueia cadastro repetido. Só confere o campo que mudou, para que cadastros antigos continuem editáveis.
create or replace function public.clients_block_duplicate()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  other public.clients;
  pk text := public.client_phone_key(coalesce(nullif(new.phone, ''), new.whatsapp));
begin
  if current_setting('crm.merging_clients', true) = 'on' then return new; end if;
  if pk is not null and (tg_op = 'INSERT'
      or pk is distinct from public.client_phone_key(coalesce(nullif(old.phone, ''), old.whatsapp))) then
    select * into other from public.clients c where c.company_id = new.company_id and c.id <> new.id
      and public.client_phone_key(coalesce(nullif(c.phone, ''), c.whatsapp)) = pk limit 1;
    if other.id is not null then
      raise exception 'Cliente já cadastrado com este telefone: %', other.name using errcode = '23505';
    end if;
  end if;
  if public.client_doc_key(new.tax_id) is not null and (tg_op = 'INSERT' or new.tax_id is distinct from old.tax_id) then
    select * into other from public.clients c where c.company_id = new.company_id and c.id <> new.id
      and public.client_doc_key(c.tax_id) = public.client_doc_key(new.tax_id) limit 1;
    if other.id is not null then
      raise exception 'Cliente já cadastrado com este CPF/CNPJ: %', other.name using errcode = '23505';
    end if;
  end if;
  if tg_op = 'INSERT' or new.name is distinct from old.name then
    select * into other from public.clients c where c.company_id = new.company_id and c.id <> new.id
      and public.client_name_key(c.name) = public.client_name_key(new.name)
      and (pk is null or public.client_phone_key(coalesce(nullif(c.phone, ''), c.whatsapp)) is null) limit 1;
    if other.id is not null then
      raise exception 'Cliente já cadastrado com este nome: %. Se for outra pessoa, informe o telefone dos dois.', other.name using errcode = '23505';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists clients_block_duplicate on public.clients;
create trigger clients_block_duplicate before insert or update on public.clients
  for each row execute function public.clients_block_duplicate();

create schema if not exists crm_admin;
revoke all on schema crm_admin from public, anon, authenticated;
create table if not exists crm_admin.client_merges (
  id bigserial primary key,
  keep_id uuid not null,
  dropped jsonb not null,
  merged_at timestamptz not null default now()
);

-- Junta p_drop em p_keep: todas as tabelas que apontam para clients passam para p_keep,
-- campos vazios de p_keep são completados com os de p_drop e p_drop é apagado.
create or replace function public.merge_clients_unchecked(p_keep uuid, p_drop uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  k public.clients; d public.clients; fk record; merged jsonb; cols text;
begin
  if p_keep = p_drop then raise exception 'Escolha dois clientes diferentes'; end if;
  select * into k from public.clients where id = p_keep for update;
  select * into d from public.clients where id = p_drop and company_id = k.company_id for update;
  if k.id is null or d.id is null then raise exception 'Cliente não encontrado'; end if;
  perform set_config('crm.merging_clients', 'on', true);

  for fk in
    select c.conrelid::regclass tbl, a.attname col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.clients'::regclass and array_length(c.conkey, 1) = 1
  loop
    execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using p_keep, p_drop;
  end loop;

  insert into crm_admin.client_merges (keep_id, dropped) values (p_keep, to_jsonb(d));
  delete from public.clients where id = p_drop;

  -- O que está preenchido no cadastro que fica vale; o resto vem do apagado.
  select to_jsonb(d) || coalesce(jsonb_object_agg(key, value), '{}') into merged
    from jsonb_each(to_jsonb(k)) where value <> 'null'::jsonb and value <> '""'::jsonb;
  merged := merged || jsonb_build_object(
    'notes', nullif(concat_ws(E'\n', nullif(k.notes, ''), case when coalesce(d.notes, '') not in ('', coalesce(k.notes, '')) then d.notes end), ''),
    'status', case when d.status::text = 'ativo' then 'ativo' else k.status::text end);
  select string_agg(format('%I = r.%I', attname, attname), ', ') into cols
    from pg_attribute where attrelid = 'public.clients'::regclass and attnum > 0 and not attisdropped
      and attgenerated = '' and attname not in ('id', 'company_id', 'created_at');
  execute format('update public.clients t set %s from jsonb_populate_record(null::public.clients, $1) r where t.id = $2', cols)
    using merged, p_keep;
  perform set_config('crm.merging_clients', 'off', true);
end $$;

create or replace function public.merge_clients(p_keep uuid, p_drop uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.require_table_access('clients', 'delete');
  if (select count(*) from public.clients where id in (p_keep, p_drop) and company_id = public.current_company_id()) < 2 then
    raise exception 'Cliente não encontrado';
  end if;
  perform public.merge_clients_unchecked(p_keep, p_drop);
end $$;

revoke all on function public.merge_clients_unchecked(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_clients_unchecked(uuid, uuid) to service_role;
revoke all on function public.merge_clients(uuid, uuid) from public, anon;
grant execute on function public.merge_clients(uuid, uuid) to authenticated, service_role;

-- Junta os repetidos que já existem, um par por vez, até não sobrar nenhum.
create or replace function crm_admin.merge_duplicate_clients()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare pair record; n integer := 0;
begin
  loop
    with c as (
      select cl.id, cl.company_id, cl.created_at, cl.name,
        public.client_phone_key(coalesce(nullif(cl.phone, ''), cl.whatsapp)) pk,
        public.client_doc_key(cl.tax_id) dk, public.client_name_key(cl.name) nk,
        (select count(*) from public.quotes q where q.client_id = cl.id)
        + (select count(*) from public.sales s where s.client_id = cl.id)
        + (select count(*) from public.leads l where l.client_id = cl.id) uses
      from public.clients cl
    )
    select a.id keep_id, b.id drop_id, a.name keep_name, b.name drop_name into pair
    from c a join c b on a.company_id = b.company_id and a.id <> b.id
      and (a.pk = b.pk or a.dk = b.dk or (a.nk = b.nk and (a.pk is null or b.pk is null)))
    where (a.uses, b.created_at, b.id::text) > (b.uses, a.created_at, a.id::text)
    order by a.company_id, a.nk limit 1;
    exit when pair.keep_id is null;
    raise notice 'Juntado: "%" em "%"', pair.drop_name, pair.keep_name;
    perform public.merge_clients_unchecked(pair.keep_id, pair.drop_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function crm_admin.merge_duplicate_clients() from public, anon, authenticated;

select crm_admin.merge_duplicate_clients() as clientes_juntados;
