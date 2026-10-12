import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

// Real PostgreSQL engine, isolated in memory. Only Supabase platform services
// (Auth and Storage) are represented locally; business functions are unmodified.
export async function createTestDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
  `);
  for (const file of readdirSync('supabase/migrations').sort()) {
    // pg_cron/pg_net require hosted Supabase; cleanup is production-specific.
    if (file.startsWith('006_') || file.startsWith('039_')) continue;
    let sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
    try { await db.exec(sql); }
    catch (error) { await db.close(); throw new Error(`Migration ${file}: ${String(error)}`); }
  }
  return db;
}
