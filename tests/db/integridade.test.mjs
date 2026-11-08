// Testes de integridade do banco: permissoes entre cargos e empresas,
// pagamentos (parcial, total, estorno, parcelas) e salvamento parcial de
// orcamento (tudo ou nada). Rodam com o papel "authenticated" de verdade (RLS
// aplicado) e cada teste e desfeito no fim (rollback).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm";
let db, company;

before(async () => {
  db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  company = (await db.query("select company_id from profiles order by created_at limit 1")).rows[0]?.company_id;
  assert.ok(company, "rode o seed (tests/e2e/start-backend.mjs) antes");
});
after(async () => db?.end());

// Cria funcionario(s) e roda fn como o primeiro, dentro de uma transacao desfeita.
// setup roda como superusuario antes de trocar para "authenticated".
async function as(roles, fn, { companyId, setup } = {}) {
  await db.query("begin");
  try {
    const mk = async (role, cid = companyId ?? company) => {
      const id = (await db.query("insert into auth.users(email) values ('int-' || gen_random_uuid() || '@teste.local') returning id")).rows[0].id;
      await db.query("insert into profiles(id, company_id, full_name, status) values ($1,$2,$3,'ativo') on conflict (id) do update set company_id=excluded.company_id, status='ativo'", [id, cid, `Teste ${role}`]);
      await db.query("delete from user_roles where profile_id=$1", [id]);
      await db.query("insert into user_roles(company_id, profile_id, role) values ($1,$2,$3)", [cid, id, role]);
      return id;
    };
    const [me, ...others] = [];
    const ids = [];
    for (const r of [].concat(roles)) ids.push(await mk(r));
    const ctx = { me: ids[0], ids, mk };
    if (setup) await setup(ctx);
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [ids[0]]);
    void me; void others;
    return await fn(ctx);
  } finally {
    await db.query("rollback");
  }
}
const one = async (sql, args) => (await db.query(sql, args)).rows[0];
const rolesOf = async (id) => (await db.query("select role::text from user_roles where profile_id=$1 order by 1", [id])).rows.map((r) => r.role);
// Recebe uma funcao (nao a promessa): a consulta so pode sair depois do savepoint.
const savepoint = async (fn) => {
  await db.query("savepoint s");
  try { await fn(); await db.query("release savepoint s"); return null; }
  catch (e) { await db.query("rollback to savepoint s"); return e; }
};

async function newClient(cid = company) {
  return (await one("insert into clients(company_id, name, phone) values ($1, 'Cliente Integridade ' || gen_random_uuid(), null) returning id", [cid])).id;
}
const gutterItem = (over = {}) => ({ product: "Calha de Beiral", thickness: "0.50 mm", cut: "200", color: "Aluminio Natural", quantity: 2, meters: 5, unit_price: 10, ...over });
async function newQuote(clientId, payload = {}) {
  return (await one("select create_gutter_quote($1::jsonb) id", [JSON.stringify({ client_id: clientId, discount: 0, freight: 0, notes: "", items: [gutterItem()], ...payload })])).id;
}

// ── Permissoes: cargos ────────────────────────────────────────────────────
test("gerente NAO se promove a administrador", () => as("gerente", async ({ me }) => {
  const e = await savepoint(() => db.query("select replace_user_roles($1, array['administrador']::app_role[])", [me]));
  assert.match(String(e?.message), /Somente administrador/);
  assert.deepEqual(await rolesOf(me), ["gerente"]);
}));

test("gerente NAO mexe nos cargos de um administrador", () => as(["gerente", "administrador"], async ({ ids: [, admin] }) => {
  const e = await savepoint(() => db.query("select replace_user_roles($1, array['vendedor']::app_role[])", [admin]));
  assert.match(String(e?.message), /Somente administrador/);
}));

test("gerente altera cargos de vendedor (uso normal continua)", () => as(["gerente", "vendedor"], async ({ ids: [, vend] }) => {
  await db.query("select replace_user_roles($1, array['vendedor','atendente']::app_role[])", [vend]);
  assert.deepEqual(await rolesOf(vend), ["atendente", "vendedor"]);
}));

test("administrador promove gerente a administrador", () => as(["administrador", "gerente"], async ({ ids: [, ger] }) => {
  await db.query("select replace_user_roles($1, array['administrador']::app_role[])", [ger]);
  assert.deepEqual(await rolesOf(ger), ["administrador"]);
}));

test("empresa nao fica sem administrador", () => as("administrador", async ({ me }) => {
  const e = await savepoint(() => db.query("select replace_user_roles($1, array['gerente']::app_role[])", [me]));
  assert.match(String(e?.message), /ao menos um administrador/);
}, { setup: async ({ me }) => { await db.query("delete from user_roles where company_id=$1 and role='administrador' and profile_id<>$2", [company, me]); } }));

for (const role of ["vendedor", "financeiro", "instalador", "atendente"]) {
  test(`${role} NAO altera cargos de ninguem`, () => as([role, "vendedor"], async ({ ids: [me, outro] }) => {
    for (const alvo of [me, outro]) {
      const e = await savepoint(() => db.query("select replace_user_roles($1, array['administrador']::app_role[])", [alvo]));
      assert.match(String(e?.message), /Sem permissao/);
    }
  }));
}

test("cargos de funcionario de OUTRA empresa: recusado", () => as("administrador", async ({ ids }) => {
  const outro = ids.at(-1);
  const e = await savepoint(() => db.query("select replace_user_roles($1, array['vendedor']::app_role[])", [outro]));
  assert.match(String(e?.message), /Funcionario invalido/);
}, { setup: async (ctx) => {
  const c2 = (await one("insert into companies(name) values ('Empresa B ' || gen_random_uuid()) returning id")).id;
  ctx.ids.push(await ctx.mk("vendedor", c2));
} }));

// ── Permissoes: isolamento entre empresas ─────────────────────────────────
test("administrador da empresa A nao ve nem altera dados da empresa B", () => as("administrador", async ({ b }) => {
  for (const [t, id] of [["clients", b.client], ["quotes", b.quote], ["financial_entries", b.entry]]) {
    assert.equal((await one(`select count(*)::int n from ${t} where id=$1`, [id])).n, 0, `${t} visivel`);
    assert.equal((await db.query(`update ${t} set company_id=company_id where id=$1`, [id])).rowCount, 0, `${t} alteravel`);
    assert.equal((await db.query(`delete from ${t} where id=$1`, [id])).rowCount, 0, `${t} apagavel`);
  }
  const e = await savepoint(() => db.query("select register_payment_with_adjustment($1, 1, current_date, 'pix')", [b.entry]));
  assert.match(String(e?.message), /nao encontrado/);
  const e2 = await savepoint(() => db.query("select approve_quote($1)", [b.quote]));
  assert.match(String(e2?.message), /não encontrado|nao encontrado/);
}, { setup: async (ctx) => {
  const c2 = (await one("insert into companies(name) values ('Empresa B ' || gen_random_uuid()) returning id")).id;
  const client = await newClient(c2);
  const quote = (await one("insert into quotes(company_id, quote_number, client_id, sale_type_id, subtotal) values ($1, 'ORC-B-' || floor(random()*1e6), $2, (select id from sale_types limit 1), 100) returning id", [c2, client])).id;
  const entry = (await one("insert into financial_entries(company_id, entry_type, origin, client_id, description, total_amount) values ($1,'receber','manual',$2,'B',100) returning id", [c2, client])).id;
  ctx.b = { client, quote, entry };
} }));

test("vendedor nao ve o financeiro nem registra pagamento", () => as("vendedor", async ({ entry }) => {
  assert.equal((await one("select count(*)::int n from financial_entries where id=$1", [entry])).n, 0);
  const e = await savepoint(() => db.query("select register_payment_with_adjustment($1, 10, current_date, 'pix')", [entry]));
  assert.ok(e, "vendedor registrou pagamento");
}, { setup: async (ctx) => {
  ctx.entry = (await one("insert into financial_entries(company_id, entry_type, origin, client_id, description, total_amount) values ($1,'receber','manual',$2,'Teste',100) returning id", [company, await newClient()])).id;
} }));

test("PDF guardado do orcamento: so quem edita orcamento grava", async () => {
  const policy = await one("select count(*)::int n from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('company writes own quote pdfs','company updates own quote pdfs') and (coalesce(qual,'') || coalesce(with_check,'')) like '%has_table_access%'");
  assert.equal(policy.n, 2);
  await as("instalador", async () => {
    const e = await savepoint(() => db.query("insert into storage.objects(bucket_id, name) values ('quote-pdfs', current_company_id()::text || '/x-marquinhos-v13.pdf')"));
    assert.ok(e, "instalador gravou PDF de orcamento");
  });
  await as("vendedor", async () => {
    await db.query("insert into storage.objects(bucket_id, name) values ('quote-pdfs', current_company_id()::text || '/x-marquinhos-v13.pdf')");
  });
});

test("logo: bucket nao aceita SVG", async () => {
  const b = await one("select allowed_mime_types from storage.buckets where id='company-assets'");
  if (b && b.allowed_mime_types) assert.ok(!b.allowed_mime_types.includes("image/svg+xml"));
});

// ── Pagamentos ────────────────────────────────────────────────────────────
async function approvedEntry(total = 100) {
  const client = await newClient();
  const q = await newQuote(client, { items: [gutterItem({ quantity: 1, meters: 1, unit_price: total })] });
  const sale = (await one("select approve_quote($1) id", [q])).id;
  const entry = await one("select * from financial_entries where sale_id=$1", [sale]);
  return { q, sale, entry };
}
const entryRow = (id) => one("select total_amount::float t, paid_amount::float p, open_amount::float o, status::text s from financial_entries where id=$1", [id]);
const saleRow = (id) => one("select paid_amount::float p, financial_status::text s from sales where id=$1", [id]);

test("aprovar orcamento gera conta a receber com o total do orcamento", () => as("administrador", async () => {
  const { q, entry } = await approvedEntry(250);
  const quote = await one("select total::float t, status from quotes where id=$1", [q]);
  assert.equal(quote.status, "aprovado");
  assert.equal(Number(entry.total_amount), quote.t);
  assert.equal(entry.status, "aguardando_pagamento");
  // aprovar de novo nao duplica venda nem financeiro
  await db.query("select approve_quote($1)", [q]);
  assert.equal((await one("select count(*)::int n from financial_entries where sale_id=(select sale_id from quotes where id=$1)", [q])).n, 1);
}));

test("pagamento parcial, total e estorno mantem financeiro e venda sincronizados (cargo financeiro)", () => as("financeiro", async ({ sale, entry }) => {
  const p1 = (await one("select register_payment_with_adjustment($1, 30.5, current_date, 'pix') id", [entry.id])).id;
  assert.deepEqual(await entryRow(entry.id), { t: 100, p: 30.5, o: 69.5, s: "parcialmente_pago" });
  assert.deepEqual(await saleRow(sale), { p: 30.5, s: "parcialmente_pago" });

  for (const v of [0, -5, 69.51]) {
    const e = await savepoint(() => db.query("select register_payment_with_adjustment($1, $2, current_date, 'pix')", [entry.id, v]));
    assert.match(String(e?.message), /Valor invalido/, `aceitou ${v}`);
  }
  await db.query("select register_payment_with_adjustment($1, 69.5, current_date, 'dinheiro')", [entry.id]);
  assert.deepEqual(await entryRow(entry.id), { t: 100, p: 100, o: 0, s: "pago" });
  assert.deepEqual(await saleRow(sale), { p: 100, s: "pago" });

  await db.query("select reverse_payment($1, 'teste')", [p1]);
  assert.deepEqual(await entryRow(entry.id), { t: 100, p: 69.5, o: 30.5, s: "parcialmente_pago" });
  assert.deepEqual(await saleRow(sale), { p: 69.5, s: "parcialmente_pago" });
  const e = await savepoint(() => db.query("select reverse_payment($1)", [p1]));
  assert.match(String(e?.message), /ja estornado/);
}, { setup: async (ctx) => {
  // O orcamento e aprovado por um administrador; quem recebe e o financeiro.
  const admin = await ctx.mk("administrador");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [admin]);
  Object.assign(ctx, await approvedEntry(100));
} }));

test("parcelamento em 3x de R$ 100: parcelas somam o total no centavo", () => as("administrador", async () => {
  const { entry } = await approvedEntry(100);
  await db.query("select register_payment_with_adjustment($1, 33.33, current_date, 'cartao', null, 0, 0, 3, current_date)", [entry.id]);
  const parts = (await db.query("select amount::float a, paid_amount::float p, status from financial_installments where financial_entry_id=$1 order by installment_number", [entry.id])).rows;
  assert.equal(parts.length, 3);
  assert.equal(Math.round(parts.reduce((t, x) => t + x.a, 0) * 100), 10000);
  assert.deepEqual(parts.map((x) => x.status), ["paga", "aberta", "aberta"]);
  const e = await savepoint(() => db.query("select register_payment_with_adjustment($1, 10, current_date, 'cartao', null, 0, 0, 2, current_date)", [entry.id]));
  assert.match(String(e?.message), /Parcelamento nao pode mudar/);
}));

test("juros e desconto no recebimento ajustam o total; desconto negativo recusado", () => as("administrador", async () => {
  const { entry } = await approvedEntry(200);
  await db.query("select register_payment_with_adjustment($1, 50, current_date, 'pix', null, 10, 30, 1, current_date)", [entry.id]);
  assert.deepEqual(await entryRow(entry.id), { t: 180, p: 50, o: 130, s: "parcialmente_pago" });
  const e = await savepoint(() => db.query("select register_payment_with_adjustment($1, 1, current_date, 'pix', null, 0, -5, 1, current_date)", [entry.id]));
  assert.match(String(e?.message), /positivos/);
}));

test("dois pagamentos ao mesmo tempo nao passam do saldo (lock da linha)", async () => {
  // Duas conexoes pagando R$ 60 de um lancamento de R$ 100: a segunda tem que falhar.
  const setup = new pg.Client({ connectionString: DATABASE_URL });
  const a = new pg.Client({ connectionString: DATABASE_URL });
  const b = new pg.Client({ connectionString: DATABASE_URL });
  await Promise.all([setup.connect(), a.connect(), b.connect()]);
  const admin = (await setup.query("select p.id from profiles p join user_roles r on r.profile_id=p.id where r.role='administrador' and p.company_id=$1 limit 1", [company])).rows[0].id;
  const client = (await setup.query("insert into clients(company_id,name) values ($1,'Concorrencia '||gen_random_uuid()) returning id", [company])).rows[0].id;
  const entry = (await setup.query("insert into financial_entries(company_id,entry_type,origin,client_id,description,total_amount) values ($1,'receber','manual',$2,'Concorrencia',100) returning id", [company, client])).rows[0].id;
  try {
    for (const c of [a, b]) {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claim.sub',$1,true)", [admin]);
    }
    await a.query("select register_payment_with_adjustment($1,60,current_date,'pix')", [entry]);
    const pb = b.query("select register_payment_with_adjustment($1,60,current_date,'pix')", [entry]).then(() => null, (e) => e);
    await new Promise((r) => setTimeout(r, 300));
    await a.query("commit");
    const err = await pb;
    await b.query("rollback");
    assert.match(String(err?.message), /Valor invalido/);
    const r = (await setup.query("select paid_amount::float p from financial_entries where id=$1", [entry])).rows[0];
    assert.equal(r.p, 60);
  } finally {
    await setup.query("delete from payments where financial_entry_id=$1", [entry]);
    await setup.query("delete from financial_entries where id=$1", [entry]);
    await setup.query("delete from clients where id=$1", [client]);
    await Promise.all([setup.end(), a.end(), b.end()]);
  }
});

// ── Salvamento parcial (tudo ou nada) ─────────────────────────────────────
test("orcamento com item que estoura no meio: nada e gravado", () => as("vendedor", async () => {
  const client = await newClient();
  const before = (await one("select count(*)::int n from quotes")).n;
  const e = await savepoint(() => newQuote(client, { items: [gutterItem(), gutterItem(), gutterItem({ quantity: 1e9, meters: 1e3 })] }));
  assert.ok(e, "aceitou valor gigante");
  assert.equal((await one("select count(*)::int n from quotes")).n, before);
  assert.equal((await one("select count(*)::int n from quote_items qi join quotes q on q.id=qi.quote_id where q.client_id=$1", [client])).n, 0);
}));

test("editar orcamento com erro no meio: itens e totais antigos ficam intactos", () => as("vendedor", async () => {
  const q = await newQuote(await newClient(), { items: [gutterItem({ quantity: 1, meters: 3, unit_price: 50 })] });
  const antes = await one("select subtotal::float s, total::float t, (select count(*)::int from quote_items where quote_id=$1) n from quotes where id=$1", [q]);
  const e = await savepoint(() => db.query("select update_gutter_quote($1,$2::jsonb)", [q, JSON.stringify({ discount: 0, freight: 0, notes: "", items: [gutterItem(), gutterItem({ quantity: 1e9, meters: 1e3 })] })]));
  assert.ok(e);
  assert.deepEqual(await one("select subtotal::float s, total::float t, (select count(*)::int from quote_items where quote_id=$1) n from quotes where id=$1", [q]), antes);
}));

test("desconto ou frete negativos nao entram no banco", () => as("vendedor", async () => {
  const client = await newClient();
  for (const extra of [{ discount: -500 }, { freight: -50 }]) {
    const e = await savepoint(() => newQuote(client, extra));
    assert.ok(e, `aceitou ${JSON.stringify(extra)}`);
  }
}));

test("total do orcamento = subtotal - desconto + frete, no centavo", () => as("vendedor", async () => {
  const q = await newQuote(await newClient(), { discount: 12.34, freight: 7.5, items: [gutterItem({ quantity: 3, meters: 0.1, unit_price: 0.1 }), gutterItem({ quantity: 1, meters: 2.35, unit_price: 47.9 })] });
  const r = await one("select subtotal::numeric s, discount::numeric d, freight::numeric f, total::numeric t, (select sum(round(gi.quantity*gi.meters*gi.unit_price,2)) from gutter_quote_items gi join gutter_quotes g on g.id=gi.gutter_quote_id where g.quote_id=$1)::numeric soma from quotes where id=$1", [q]);
  assert.equal(Number(r.s), Number(r.soma));
  assert.equal(Number(r.t), Math.round((Number(r.s) - Number(r.d) + Number(r.f)) * 100) / 100);
}));

for (const role of ["vendedor", "atendente"]) {
  test(`${role} ve os itens do orcamento que criou (folha/PDF nao sai vazio)`, () => as(role, async () => {
    const q = await newQuote(await newClient(), { items: [gutterItem(), gutterItem({ product: "Rufo convencional" })], special_items: [{ product: "Condutor", item_type: "Condutores", unit: "unidade", quantity: 2, unit_price: 15 }] });
    assert.equal((await one("select count(*)::int n from gutter_quote_items gi join gutter_quotes g on g.id=gi.gutter_quote_id where g.quote_id=$1", [q])).n, 2);
    assert.ok((await one("select count(*)::int n from quote_items where quote_id=$1", [q])).n >= 1);
  }));
}
