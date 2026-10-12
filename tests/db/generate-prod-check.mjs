// Gera scripts/verificar-banco-producao.sql a partir do banco de testes
// (todas as migrations aplicadas): o script, rodado no SQL Editor do
// Supabase, lista tabelas, colunas, funcoes e triggers que o sistema espera
// e que faltam no banco de producao.
// Uso: DATABASE_URL=... node tests/db/generate-prod-check.mjs
import fs from "node:fs";
import pg from "pg";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm_test" });
await db.connect();
const cols = (await db.query(`select c.table_name, c.column_name from information_schema.columns c
  where c.table_schema = 'public' order by 1, 2`)).rows;
const fns = (await db.query(`select p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1, 2`)).rows;
const trg = (await db.query(`select c.relname tbl, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal order by 1, 2`)).rows;
await db.end();

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = `-- Diagnostico do banco de producao do CRM Bielenki.
-- Rode no SQL Editor do Supabase. Cada linha do resultado e algo que o
-- sistema espera e NAO existe no banco. Resultado vazio = banco em dia.
-- Gerado por tests/db/generate-prod-check.mjs a partir das migrations.

with expected_columns(table_name, column_name) as (values
${cols.map((c) => `  (${q(c.table_name)}, ${q(c.column_name)})`).join(",\n")}
), expected_functions(name, args) as (values
${fns.map((f) => `  (${q(f.proname)}, ${q(f.args)})`).join(",\n")}
), expected_triggers(table_name, trigger_name) as (values
${trg.map((t) => `  (${q(t.tbl)}, ${q(t.tgname)})`).join(",\n")}
)
select 'coluna' as tipo, e.table_name || '.' || e.column_name as faltando
from expected_columns e
where not exists (select 1 from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = e.table_name and c.column_name = e.column_name)
union all
select 'funcao', e.name || '(' || e.args || ')'
from expected_functions e
where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = e.name and pg_get_function_identity_arguments(p.oid) = e.args)
union all
select 'trigger', e.table_name || ': ' || e.trigger_name
from expected_triggers e
where not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = e.table_name and t.tgname = e.trigger_name)
order by 1, 2;
`;
fs.writeFileSync(new URL("../../scripts/verificar-banco-producao.sql", import.meta.url), sql);
console.log(`${cols.length} colunas, ${fns.length} funcoes, ${trg.length} triggers`);
