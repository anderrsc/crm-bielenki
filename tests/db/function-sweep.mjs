// Chama todas as funcoes do schema public (com argumentos nulos/exemplo),
// como o usuario logado e dentro de transacao desfeita, e acusa erros de
// schema que o plpgsql so revela em execucao: coluna/tabela/funcao
// inexistente, coluna ambigua, tipo incompativel.
import pg from "pg";

const SCHEMA_ERRORS = new Set(["42703", "42P01", "42883", "42702", "42804", "42P10", "42601", "0A000", "42846", "22P02"]);
const SKIP = new Set(["configure_automation_cron"]); // exige pg_cron/pg_net (so no Supabase)

export async function sweepFunctions(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const user = (await db.query("select id from profiles order by created_at limit 1")).rows[0]?.id;
  const sample = (await db.query(`select
    (select id from quotes order by created_at desc limit 1) quote,
    (select id from financial_entries order by created_at desc limit 1) entry,
    (select id from clients order by created_at desc limit 1) client,
    (select id from companies order by created_at limit 1) company`)).rows[0];
  const fns = (await db.query(`
    select p.oid::regprocedure::text sig, p.proname, pg_get_function_identity_arguments(p.oid) args,
           coalesce(p.proargtypes::regtype[]::text[], '{}') types
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype and p.prorettype <> 'event_trigger'::regtype
    order by p.proname`)).rows;
  const problems = [];
  for (const f of fns) {
    if (SKIP.has(f.proname)) continue;
    const args = f.types.map((t, i) => {
      if (t === "uuid") return /entry/.test(f.args.split(",")[i] ?? "") ? sample.entry : /client/.test(f.args.split(",")[i] ?? "") ? sample.client : /company/.test(f.args.split(",")[i] ?? "") ? sample.company : sample.quote;
      if (t === "text" || t === "character varying") return "teste";
      if (t === "date") return new Date().toISOString().slice(0, 10);
      if (t.startsWith("timestamp")) return new Date().toISOString();
      if (t === "numeric" || t === "integer" || t === "bigint") return 1;
      if (t === "boolean") return true;
      if (t === "jsonb" || t === "json") return "{}";
      if (t.endsWith("[]")) return "{}";
      return null;
    });
    const call = `select ${f.proname}(${args.map((_, i) => `$${i + 1}::${f.types[i]}`).join(",")})`;
    await db.query("begin");
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
      await db.query("set local statement_timeout = '5s'");
      await db.query(call, args);
    } catch (e) {
      if (SCHEMA_ERRORS.has(e.code)) problems.push(`${f.sig}: [${e.code}] ${e.message}`);
    } finally {
      await db.query("rollback");
    }
  }
  // Triggers de UPDATE: um update neutro em uma linha de cada tabela com trigger.
  const tables = (await db.query(`
    select distinct c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal and (t.tgtype & 16) = 16`)).rows.map((r) => r.relname);
  for (const table of tables) {
    await db.query("begin");
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
      await db.query("set local statement_timeout = '5s'");
      await db.query(`update public.${table} set id = id where id = (select id from public.${table} limit 1)`);
    } catch (e) {
      if (SCHEMA_ERRORS.has(e.code)) problems.push(`trigger de update em ${table}: [${e.code}] ${e.message}`);
    } finally {
      await db.query("rollback");
    }
  }
  await db.end();
  return { total: fns.length + tables.length, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { total, problems } = await sweepFunctions(process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm");
  console.log(`${total} funcoes/triggers executados, ${problems.length} com erro de schema`);
  for (const p of problems) console.log("  - " + p);
  process.exit(problems.length ? 1 : 0);
}
