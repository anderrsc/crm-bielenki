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

// Todas a partir da 040, em ordem (como o workflow de migrations): reaplicar
// uma so (ex.: a 048, que regrava todas as funcoes) desfaria as posteriores.
const REAPLICAVEIS = fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql") && f >= "040").sort();
for (const file of REAPLICAVEIS) {
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

test("044 aplica com itens repetidos sem espessura/corte (como no banco de producao)", async () => {
  const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/044_gutter_prices_unique_with_color.sql"), "utf8").replace(/^\s*(begin|commit);\s*$/gim, "");
  await db.query("begin");
  try {
    await db.query("drop index if exists gutter_prices_unique_item_color");
    for (const price of [10, 12]) {
      await db.query("insert into gutter_prices(company_id,product,thickness,cut_mm,unit_price) values($1,'Condutor Duplicado',null,null,$2)", [company, price]);
    }
    await db.query(sql);
    const idx = (await db.query("select 1 from pg_indexes where indexname='gutter_prices_unique_item_color'")).rowCount;
    assert.equal(idx, 1, "indice deveria ser criado mesmo com repetidos sem espessura/corte");
  } finally { await db.query("rollback"); }
});

test("verificacao do banco de producao volta vazia no banco com todas as migrations", async () => {
  const sql = fs.readFileSync(path.join(ROOT, "scripts/verificar-banco-producao.sql"), "utf8");
  const { rows } = await db.query(sql);
  assert.deepEqual(rows, []);
});


test("RLS: funcoes de sessao avaliadas uma vez por consulta (envolvidas em select)", async () => {
  const { rows } = await db.query(`select c.relname || '.' || p.polname nome from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relnamespace = 'public'::regnamespace
      and (coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), ''))
        ~ '(?<!SELECT )(current_company_id|has_table_access|has_role)\\(|(?<!SELECT )auth\\.uid\\('`);
  assert.deepEqual(rows.map((r) => r.nome), [], "policy nova sem (select ...): rode a logica da migration 20261103000000");
});

test("toda chave estrangeira tem indice", async () => {
  const { rows } = await db.query(`select co.conrelid::regclass || '.' || co.conname nome from pg_constraint co
    where co.contype = 'f' and co.connamespace = 'public'::regnamespace
      and not exists (select 1 from pg_index i where i.indrelid = co.conrelid and (i.indkey::int2[])[0] = co.conkey[1])`);
  assert.deepEqual(rows.map((r) => r.nome), []);
});

test("session_access devolve status, cargos e acesso numa consulta", () => asUser(async () => {
  const r = (await db.query("select session_access('clients') a")).rows[0].a;
  assert.equal(r.status, "ativo");
  assert.ok(Array.isArray(r.roles) && r.roles.length > 0);
  assert.equal(typeof r.allowed, "boolean");
}));

// ── Seguranca (auditoria de 02/11/2026) ─────────────────────────────────────
// Cria um usuario de teste com o cargo informado e executa fn como ele, com o
// papel "authenticated" de verdade (RLS aplicado). Tudo e desfeito no fim.
async function asNewUser(role, fn, { status = "ativo" } = {}) {
  await db.query("begin");
  try {
    const id = (await db.query("insert into auth.users(email) values ('seg-' || gen_random_uuid() || '@teste.local') returning id")).rows[0].id;
    await db.query("insert into profiles(id, company_id, full_name, status) values ($1, $2, 'Teste Seguranca', $3) on conflict (id) do update set company_id = excluded.company_id, status = excluded.status", [id, company, status]);
    await db.query("delete from user_roles where profile_id = $1", [id]);
    await db.query("insert into user_roles(company_id, profile_id, role) values ($1, $2, $3)", [company, id, role]);
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
    return await fn(id);
  } finally {
    await db.query("rollback");
  }
}

test("A02: nenhuma funcao privilegiada (SECURITY DEFINER) executavel sem login", async () => {
  const { rows } = await db.query(`select proname from pg_proc p where pronamespace = 'public'::regnamespace and prosecdef
    and has_function_privilege('anon', p.oid, 'execute')`);
  assert.deepEqual(rows.map((r) => r.proname), []);
});

test("A02: rotinas internas so pelo servidor", async () => {
  for (const fn of ["enqueue_due_automations()", "bootstrap_company(text,text,uuid)", "trigger_workflow_event(uuid,text,jsonb)", "seed_gutter_products(uuid)"]) {
    const ok = (await db.query("select to_regprocedure($1) p", [`public.${fn}`])).rows[0].p;
    if (!ok) continue;
    const { rows } = await db.query("select has_function_privilege('authenticated', $1::regprocedure, 'execute') pode", [`public.${fn}`]);
    assert.equal(rows[0].pode, false, `${fn} executavel por usuario logado`);
  }
});

test("A02: funcoes chamadas pelo aplicativo continuam liberadas para usuarios logados", async () => {
  const usadas = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261103020000_security_hardening.sql"), "utf8");
  for (const fn of ["approve_quote", "create_gutter_quote", "pending_center", "session_access", "has_table_access", "current_company_id"]) {
    assert.match(usadas, new RegExp(`'${fn}'`));
    const { rows } = await db.query("select bool_and(has_function_privilege('authenticated', p.oid, 'execute')) pode from pg_proc p where proname = $1 and pronamespace = 'public'::regnamespace", [fn]);
    assert.equal(rows[0].pode, true, fn);
  }
});

for (const tabela of ["ai_agent_config", "triage_sessions", "workflow_executions"]) {
  test(`A01/A04: vendedor nao le nem altera ${tabela}`, () => asNewUser("vendedor", async () => {
    assert.equal((await db.query(`select count(*)::int n from ${tabela}`)).rows[0].n, 0);
    assert.equal((await db.query(`update ${tabela} set company_id = company_id`)).rowCount, 0);
  }));
}

test("A01: gerente le a configuracao do Agente IA", () => asNewUser("gerente", async () => {
  await db.query("select * from ai_agent_config");
}));

test("A03: usuario nao altera o proprio status", () => asNewUser("vendedor", async (id) => {
  await assert.rejects(db.query("update profiles set status = 'inativo' where id = $1", [id]), /proprio status|status ou empresa/);
}));

test("A03: usuario inativo nao ve dados da empresa", () => asNewUser("administrador", async () => {
  assert.equal((await db.query("select count(*)::int n from clients")).rows[0].n, 0);
  assert.equal((await db.query("select current_company_id() c")).rows[0].c, null);
}, { status: "inativo" }));

test("A03: administrador altera o status de outro funcionario", () => asNewUser("administrador", async () => {
  const outro = (await db.query("select id from profiles where id <> auth.uid() and company_id = current_company_id() limit 1")).rows[0];
  if (!outro) return;
  await db.query("update profiles set status = status where id = $1", [outro.id]);
}));

test("A07: eventos do WhatsApp so pelo servidor", () => asNewUser("administrador", async () => {
  await assert.rejects(db.query("select * from whatsapp_webhook_events"), /permission denied/);
}));

test("triagem liga ao cliente existente pelas regras de nome/endereco", async () => {
  await db.query("begin");
  try {
    const ins = async (name, phone, address, city, neighborhood) => (await db.query(
      "insert into clients(company_id,name,phone,address,city,neighborhood) values($1,$2,$3,$4,$5,$6) returning id",
      [company, name, phone, address, city, neighborhood])).rows[0].id;
    const m = async (...a) => (await db.query("select crm_private.triage_match_client($1,$2,$3,$4,$5,$6) id", [company, ...a])).rows[0].id;
    const full = await ins("Zéfiro Tavares Teste", null, null, null, null);
    assert.equal(await m("zefiro  tavares teste", null, null, null, null), full, "nome e sobrenome iguais junta");
    const addr = await ins("Contato WhatsApp 4799", null, "Rua das Hortênsias Teste, 99", "Blumenau", null);
    assert.equal(await m("Outro Nome Qualquer", "rua das hortensias teste, 99", null, "Blumenau", null), addr, "mesmo endereco sem nome real junta");
    const first = await ins("Quirino Alves", null, "Rua Primeiro Nome, 1", "Gaspar", "Centro");
    assert.equal(await m("Quirino", null, null, null, null), null, "so o primeiro nome nao junta");
    assert.equal(await m("Quirino", null, "Centro", "Gaspar", null), first, "primeiro nome + bairro e cidade junta");
  } finally { await db.query("rollback"); }
});

test("pedido fechado entra na producao sozinho, sem duplicar a ordem", async () => {
  await db.query("begin");
  try {
    const base = (await db.query("select client_id, sale_type_id from sales where company_id=$1 limit 1", [company])).rows[0];
    const sale = (await db.query("insert into sales(company_id,sale_number,client_id,sale_type_id,total) values($1,'VEN-TST-PROD',$2,$3,10) returning id", [company, base.client_id, base.sale_type_id])).rows[0].id;
    const order = (await db.query("insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,'PED-TST-PROD',$2,$3,$4) returning id", [company, sale, base.client_id, base.sale_type_id])).rows[0].id;
    await db.query("set constraints all immediate");
    const n = async () => (await db.query("select count(*)::int n from production_orders where order_id=$1", [order])).rows[0].n;
    assert.equal(await n(), 1, "ordem de producao criada no fechamento");
    await db.query("set constraints all deferred");
    await db.query("update orders set next_action='x' where id=$1", [order]);
    await db.query("set constraints all immediate");
    assert.equal(await n(), 1, "nao duplica");
  } finally { await db.query("rollback"); }
});
