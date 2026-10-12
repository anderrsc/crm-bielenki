-- Stubs minimos do que o Supabase fornece (auth, storage, roles) para
-- aplicar as migrations num Postgres comum durante os testes.
-- auth.uid() le o usuario de "request.jwt.claim.sub", igual ao PostgREST.

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    current_setting('request.jwt.claims', true)::jsonb->>'sub'), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key, name text not null, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table storage.objects enable row level security;
create unique index if not exists objects_bucket_name on storage.objects(bucket_id, name);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- pg_cron / pg_net nao existem no Postgres comum; as funcoes que os usam
-- sao plpgsql (resolvidas so na execucao), entao basta o schema existir.
create schema if not exists cron;
create schema if not exists net;

-- Papel que o PostgREST usa para conectar (troca para anon/authenticated
-- conforme o JWT), e os grants padrao que o Supabase aplica no schema public.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticator') then
    create role authenticator login noinherit password 'authenticator';
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
