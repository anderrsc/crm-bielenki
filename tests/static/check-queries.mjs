// Confere toda consulta Supabase escrita no codigo contra o banco de verdade:
//   .from("t").select("...")      -> GET no PostgREST com limit=0 (valida colunas e relacoes)
//   .from("t").insert/update/upsert({ chaves }) -> colunas existem na tabela
//   .rpc("fn", { args })          -> funcao existe com esses nomes de parametros
//   .storage.from("bucket")       -> bucket existe
// Uso: DATABASE_URL=... POSTGREST_URL=... SERVICE_ROLE_KEY=... node tests/static/check-queries.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "tests", "supabase"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Valor de string estatico (literal, template sem expressoes, ou concatenacao de literais).
function staticString(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = staticString(node.left), r = staticString(node.right);
    return l != null && r != null ? l + r : null;
  }
  if (ts.isParenthesizedExpression(node)) return staticString(node.expression);
  return null;
}

function objectKeys(node) {
  if (!node) return null;
  if (ts.isArrayLiteralExpression(node)) {
    const all = node.elements.map(objectKeys);
    return all.every(Boolean) ? [...new Set(all.flat())] : null;
  }
  if (!ts.isObjectLiteralExpression(node)) return null;
  const keys = [];
  for (const p of node.properties) {
    if (ts.isSpreadAssignment(p)) continue; // spread: nao da pra saber estaticamente
    const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
    if (name) keys.push(name);
  }
  return keys;
}

// Sobe a cadeia a.b().c() procurando a chamada .from("x") e se e .storage.from.
function findFrom(expr) {
  let cur = expr;
  while (cur) {
    if (ts.isCallExpression(cur)) {
      const callee = cur.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "from") {
        const isStorage = ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === "storage";
        return { name: staticString(cur.arguments[0]), isStorage };
      }
      cur = callee;
    } else if (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    else if (ts.isParenthesizedExpression(cur) || ts.isAwaitExpression(cur)) cur = cur.expression;
    else return null;
  }
  return null;
}

export function extractQueries() {
  const found = [];
  for (const file of walkFiles(ROOT)) {
    const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const rel = path.relative(ROOT, file);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const where = `${rel}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        if (method === "rpc") {
          const fn = staticString(node.arguments[0]);
          if (fn) found.push({ kind: "rpc", fn, args: objectKeys(node.arguments[1]) ?? [], where });
        } else if (["select", "insert", "update", "upsert"].includes(method)) {
          const from = findFrom(node.expression.expression);
          if (from?.name && !from.isStorage) {
            if (method === "select") {
              const cols = node.arguments.length ? staticString(node.arguments[0]) : "*";
              if (cols != null) found.push({ kind: "select", table: from.name, cols, where });
            } else {
              const keys = objectKeys(node.arguments[0]);
              if (keys?.length) found.push({ kind: method, table: from.name, keys, where });
            }
          }
        } else if (method === "from") {
          const from = findFrom(node);
          if (from?.isStorage && from.name) found.push({ kind: "bucket", bucket: from.name, where });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  // Modulos genericos (lib/modules.ts): a consulta e montada a partir de
  // { table, select } de cada modulo.
  const modulesSrc = fs.readFileSync(path.join(ROOT, "lib/modules.ts"), "utf8");
  for (const m of modulesSrc.matchAll(/^\s*([\w-]+):\s*\{[^\n]*?table:\s*"([^"]+)"[^\n]*?select:\s*"([^"]+)"/gm)) {
    found.push({ kind: "select", table: m[2], cols: m[3], where: `lib/modules.ts (${m[1]})` });
  }
  return found;
}

export async function checkQueries({ databaseUrl, postgrestUrl, serviceRoleKey }) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const cols = new Map();
  for (const r of (await db.query("select table_name, column_name from information_schema.columns where table_schema='public'")).rows) {
    if (!cols.has(r.table_name)) cols.set(r.table_name, new Set());
    cols.get(r.table_name).add(r.column_name);
  }
  const fns = new Map();
  for (const r of (await db.query("select p.proname, coalesce(p.proargnames, '{}') argnames, p.proargmodes::text[] argmodes from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")).rows) {
    const inArgs = r.argnames.filter((_, i) => !r.argmodes || ["i", "b", "v"].includes(r.argmodes[i]));
    if (!fns.has(r.proname)) fns.set(r.proname, []);
    fns.get(r.proname).push(inArgs);
  }
  const buckets = new Set((await db.query("select id from storage.buckets")).rows.map((r) => r.id));
  await db.end();

  const problems = [];
  const queries = extractQueries();
  for (const q of queries) {
    if (q.kind === "select") {
      const url = `${postgrestUrl}/${q.table}?select=${encodeURIComponent(q.cols.replace(/\s+/g, ""))}&limit=0`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } });
      if (!res.ok) problems.push(`${q.where} select em ${q.table}("${q.cols}"): ${(await res.json()).message}`);
    } else if (["insert", "update", "upsert"].includes(q.kind)) {
      const tableCols = cols.get(q.table);
      if (!tableCols) problems.push(`${q.where} ${q.kind} em tabela inexistente ${q.table}`);
      else for (const k of q.keys) if (!tableCols.has(k)) problems.push(`${q.where} ${q.kind} em ${q.table}: coluna "${k}" nao existe`);
    } else if (q.kind === "rpc") {
      const overloads = fns.get(q.fn);
      if (!overloads) problems.push(`${q.where} rpc ${q.fn}: funcao nao existe`);
      else if (!overloads.some((names) => q.args.every((a) => names.includes(a))))
        problems.push(`${q.where} rpc ${q.fn}(${q.args.join(",")}): parametros nao batem com ${overloads.map((o) => `(${o.join(",")})`).join(" ou ")}`);
    } else if (q.kind === "bucket" && !buckets.has(q.bucket)) {
      problems.push(`${q.where} storage bucket "${q.bucket}" nao existe`);
    }
  }
  return { total: queries.length, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { total, problems } = await checkQueries({
    databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm",
    postgrestUrl: process.env.POSTGREST_URL ?? "http://localhost:54330",
    serviceRoleKey: process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  console.log(`${total} consultas verificadas, ${problems.length} problemas`);
  for (const p of problems) console.log("  - " + p);
  process.exit(problems.length ? 1 : 0);
}
