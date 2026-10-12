// Testes do banco (rodam contra um banco com todas as migrations aplicadas).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm";
let db, company, user;

// Executa como o usuario logado (auth.uid()), dentro de uma transacao desfeita no fim.
async function asUser(fn) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

before(async () => {
  db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const r = (await db.query("select id, company_id from profiles order by created_at limit 1")).rows[0];
  assert.ok(r, "rode o seed (tests/e2e/start-backend.mjs) antes");
  ({ id: user, company_id: company } = r);
});
after(async () => db?.end());

for (const file of ["040_quote_pdf_cache.sql", "041_quote_pdf_cache_freshness.sql", "042_fix_pending_center.sql", "043_seed_new_company_defaults.sql", "044_gutter_prices_unique_with_color.sql", "045_fix_dashboard_and_alerts.sql"]) {
  test(`migration ${file} pode ser rodada de novo`, async () => {
    const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations", file), "utf8");
    await db.query(sql.replace(/^\s*(begin|commit);\s*$/gim, "")).catch(async (e) => { await db.query("rollback").catch(() => {}); throw e; });
  });
}

test("marcar pdf_generated_at nao altera updated_at (cache do PDF fica valido)", () => asUser(async () => {
  const q = (await db.query("select id, updated_at from quotes where company_id=$1 limit 1", [company])).rows[0];
  await db.query("update quotes set pdf_generated_at = now() + interval '1 second' where id=$1", [q.id]);
  const after = (await db.query("select updated_at, pdf_generated_at >= updated_at fresh from quotes where id=$1", [q.id])).rows[0];
  assert.equal(after.updated_at.getTime(), q.updated_at.getTime());
  assert.equal(after.fresh, true);
  await db.query("update quotes set notes = coalesce(notes,'') || 'x' where id=$1", [q.id]);
  const edited = (await db.query("select updated_at > $2 changed from quotes where id=$1", [q.id, q.updated_at])).rows[0];
  assert.equal(edited.changed, true, "editar o orcamento deve atualizar updated_at");
}));

test("pending_center retorna todas as categorias sem erro", () => asUser(async () => {
  const rows = (await db.query("select category, link from pending_center()")).rows;
  const cats = new Set(rows.map((r) => r.category.replace(/_.*/, "")));
  for (const c of ["orcamento", "financeiro", "producao", "compra", "instalacao", "medicao"]) assert.ok(cats.has(c), `categoria ${c} ausente (seed-sample.sql)`);
  for (const r of rows) assert.match(r.link, /^\/[a-z]/);
}));

test("pending_center sem usuario logado nao retorna nada", async () => {
  const rows = (await db.query("select * from pending_center()")).rows;
  assert.equal(rows.length, 0);
});

test("empresa nova recebe templates e tabela de calhas", async () => {
  await db.query("begin");
  try {
    const c = (await db.query("insert into companies(name) values('Empresa Nova Teste') returning id")).rows[0].id;
    const t = (await db.query("select count(*)::int n from document_templates where company_id=$1", [c])).rows[0].n;
    const g = (await db.query("select count(*)::int n from gutter_prices where company_id=$1", [c])).rows[0].n;
    assert.ok(t >= 8, `templates: ${t}`);
    assert.ok(g > 0, `precos: ${g}`);
  } finally { await db.query("rollback"); }
});

test("mesma calha pode ter preco por cor, mas nao duplicado", async () => {
  await db.query("begin");
  try {
    const ins = (color) => db.query("insert into gutter_prices(company_id,product,thickness,cut_mm,color,unit_price) values($1,'Calha Teste Cor','0.50 mm',250,$2,10)", [company, color]);
    await ins("Aluminio Natural");
    await ins("Pintura Preto");
    await assert.rejects(ins("Pintura Preto"), /duplicate key/);
  } finally { await db.query("rollback"); }
});

test("bulk_save_prices insere e atualiza", () => asUser(async () => {
  await db.query("select bulk_save_prices($1::jsonb)", [JSON.stringify([{ id: null, product: "Rufo Bulk", category: "Rufos", thickness: "0.5mm", cut_mm: 300, unit: "Metro Linear (m)", color: null, unit_price: 50, active: true }])]);
  const row = (await db.query("select id, unit_price from gutter_prices where product='Rufo Bulk' and company_id=$1", [company])).rows[0];
  assert.ok(row);
  await db.query("select bulk_save_prices($1::jsonb)", [JSON.stringify([{ id: row.id, product: "Rufo Bulk", category: "Rufos", unit_price: 60, active: true }])]);
  assert.equal(Number((await db.query("select unit_price from gutter_prices where id=$1", [row.id])).rows[0].unit_price), 60);
}));

test("busca global e relatorios executam", () => asUser(async () => {
  await db.query("select * from global_search('te')");
  const r = (await db.query("select reporting_summary(current_date - 30, current_date) s")).rows[0].s;
  assert.ok("sales_total" in r);
  await db.query("select dashboard_summary()");
  await db.query("select dashboard_executivo()");
}));

test("todas as funcoes e triggers de update executam sem erro de schema", async () => {
  const { sweepFunctions } = await import("./function-sweep.mjs");
  const { total, problems } = await sweepFunctions(DATABASE_URL);
  assert.ok(total > 50);
  assert.deepEqual(problems, []);
});

test("pedido entrando em producao cria o checklist operacional", async () => {
  await db.query("begin");
  try {
    const o = (await db.query("select id from orders order by created_at limit 1")).rows[0];
    await db.query("update orders set production_status='nao_liberado' where id=$1", [o.id]);
    await db.query("update orders set production_status='em_producao' where id=$1", [o.id]);
    const n = (await db.query("select count(*)::int n from order_checklist_items where order_id=$1 and category='operacional'", [o.id])).rows[0].n;
    assert.ok(n > 0);
  } finally { await db.query("rollback"); }
});
