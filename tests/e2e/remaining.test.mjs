// Acoes restantes: templates, desativar cliente, excluir fornecedor e
// pintura, editar funcionario/cargos/senha, vendedor e formas de pagamento
// do orcamento, status de evento da agenda e remover logo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { launch, login, BASE, pageProblem } from "./helpers.mjs";

const RUN = Date.now().toString(36);
let browser, page, db, cid, uid;

before(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm" });
  await db.connect();
  ({ company_id: cid, id: uid } = (await db.query("select company_id, id from profiles order by created_at limit 1")).rows[0]);
  browser = await launch();
  page = await browser.newPage();
  page.on("dialog", (d) => d.accept());
  await login(page, process.env.E2E_EMAIL ?? "admin@teste.local", process.env.E2E_PASSWORD ?? "senha-de-teste-123");
});
after(async () => { await browser?.close(); await db?.end(); });

async function noProblem(step) {
  const problem = await pageProblem(page);
  assert.equal(problem, null, `${step}: ${problem} (${page.url()})`);
}
const settle = () => page.waitForNetworkIdle({ idleTime: 700, timeout: 30000 });
async function click(selectorOrText, { within } = {}) {
  await page.evaluate((t, w) => {
    const root = w ? [...document.querySelectorAll("tr, article, details, li, .card")].find((r) => r.innerText.includes(w)) : document;
    if (!root) throw new Error(`bloco "${w}" nao encontrado`);
    const el = [...root.querySelectorAll("button, a, summary")].find((b) => (b.innerText || "").trim().includes(t) || b.title === t || b.getAttribute("aria-label") === t);
    if (!el) throw new Error(`"${t}" nao encontrado${w ? ` em "${w}"` : ""}`);
    el.click();
  }, selectorOrText, within ?? null);
}

test("templates: duplicar e restaurar padroes", async () => {
  const before = (await db.query("select count(*)::int n from document_templates where company_id=$1", [cid])).rows[0].n;
  assert.ok(before > 0, "empresa sem templates (migration 043)");
  await page.goto(`${BASE}/configuracoes/templates`, { waitUntil: "networkidle0" });
  await noProblem("templates");
  await click("Duplicar");
  await settle();
  await noProblem("duplicar template");
  const after = (await db.query("select count(*)::int n from document_templates where company_id=$1", [cid])).rows[0].n;
  assert.equal(after, before + 1);
  await page.goto(`${BASE}/configuracoes/templates`, { waitUntil: "networkidle0" });
  await click("Restaurar");
  await settle();
  await noProblem("restaurar templates");
});

test("cliente: desativar", async () => {
  const c = (await db.query("insert into clients(company_id,name) values($1,$2) returning id", [cid, `Cliente Desativar ${RUN}`])).rows[0];
  await page.goto(`${BASE}/clientes/${c.id}`, { waitUntil: "networkidle0" });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), click("Desativar")]);
  await noProblem("desativar cliente");
  assert.equal((await db.query("select status from clients where id=$1", [c.id])).rows[0].status, "inativo");
});

test("fornecedor: excluir", async () => {
  const name = `Fornecedor Excluir ${RUN}`;
  const s = (await db.query("insert into suppliers(company_id,name) values($1,$2) returning id", [cid, name])).rows[0];
  await page.goto(`${BASE}/fornecedores`, { waitUntil: "networkidle0" });
  // Edicao em linha: o nome esta no value do input, nao no texto.
  await page.evaluate((n) => {
    const form = [...document.querySelectorAll("form")].find((f) => f.querySelector("input[name=name]")?.value === n);
    const details = form.closest("details"); if (details) details.open = true;
    [...form.querySelectorAll("button")].find((b) => /excluir/i.test(b.innerText)).click();
  }, name);
  await settle();
  await noProblem("excluir fornecedor");
  const row = (await db.query("select deleted_at, status from suppliers where id=$1", [s.id])).rows[0];
  assert.ok(!row || row.deleted_at || row.status === "inativo", "fornecedor continua ativo");
});

test("funcionarios: editar dados, cargos e redefinir senha", async () => {
  const email = `edit.${RUN}@teste.local`;
  const user = (await db.query("insert into auth.users(email, encrypted_password, raw_user_meta_data, raw_app_meta_data) values($1,'x',$2,$3) returning id", [email, { full_name: `Editar ${RUN}` }, { company_id: cid, role: "atendente" }])).rows[0];
  await db.query("update profiles set email=$1 where id=$2", [email, user.id]);
  await page.goto(`${BASE}/configuracoes/funcionarios`, { waitUntil: "networkidle0" });
  const openRow = () => page.evaluate((n) => {
    const d = [...document.querySelectorAll("details")].find((x) => x.innerText.includes(n));
    d.open = true;
  }, `Editar ${RUN}`);
  await openRow();
  await page.evaluate((n) => {
    const d = [...document.querySelectorAll("details")].find((x) => x.innerText.includes(n));
    const phone = d.querySelector("input[name=phone]"); phone.value = "47912345678";
    [...d.querySelectorAll("button")].find((b) => b.innerText.includes("Salvar dados")).click();
  }, `Editar ${RUN}`);
  await settle();
  await noProblem("salvar dados do funcionario");
  assert.equal((await db.query("select phone from profiles where id=$1", [user.id])).rows[0].phone, "47912345678");

  await page.goto(`${BASE}/configuracoes/funcionarios`, { waitUntil: "networkidle0" });
  await openRow();
  await page.evaluate((n) => {
    const d = [...document.querySelectorAll("details")].find((x) => x.innerText.includes(n));
    const form = [...d.querySelectorAll("form")].find((f) => f.innerText.includes("Salvar cargos"));
    const fin = [...form.querySelectorAll("input[name=roles]")].find((i) => i.value === "financeiro");
    fin.checked = true;
    [...form.querySelectorAll("button")].find((b) => b.innerText.includes("Salvar cargos")).click();
  }, `Editar ${RUN}`);
  await settle();
  await noProblem("salvar cargos");
  const roles = (await db.query("select array_agg(role::text) r from user_roles where profile_id=$1", [user.id])).rows[0].r;
  assert.ok(roles.includes("financeiro"), `cargos: ${roles}`);

  await page.goto(`${BASE}/configuracoes/funcionarios`, { waitUntil: "networkidle0" });
  await openRow();
  await page.evaluate((n) => {
    const d = [...document.querySelectorAll("details")].find((x) => x.innerText.includes(n));
    [...d.querySelectorAll("button")].find((b) => /Redefinir senha|Enviar e-mail de redefini/.test(b.innerText)).click();
  }, `Editar ${RUN}`);
  await settle();
  await noProblem("redefinir senha");
});

test("orcamento: vendedor e formas de pagamento", async () => {
  const q = (await db.query("select id from quotes where company_id=$1 and status <> 'aprovado' order by created_at desc limit 1", [cid])).rows[0];
  assert.ok(q, "sem orcamento em aberto");
  await page.goto(`${BASE}/orcamentos/${q.id}`, { waitUntil: "networkidle0" });
  await click("Editar vendedor");
  await page.waitForSelector("input[name=seller_name]");
  await page.$eval("input[name=seller_name]", (el) => { el.value = ""; });
  await page.type("input[name=seller_name]", `Vendedor ${RUN}`);
  await page.click(".quote-seller-save");
  await settle();
  assert.equal((await db.query("select seller_name from quotes where id=$1", [q.id])).rows[0].seller_name, `Vendedor ${RUN}`);
  // Desmarca a primeira forma de pagamento.
  await page.goto(`${BASE}/orcamentos/${q.id}`, { waitUntil: "networkidle0" });
  const beforePm = (await db.query("select payment_methods from quotes where id=$1", [q.id])).rows[0].payment_methods;
  await page.evaluate(() => document.querySelector(".quote-pay-item input[type=checkbox]:checked").click());
  await settle();
  const afterPm = (await db.query("select payment_methods from quotes where id=$1", [q.id])).rows[0].payment_methods;
  assert.notDeepEqual(afterPm, beforePm);
  await noProblem("formas de pagamento");
});

test("pintura: cadastrar e excluir", async () => {
  await page.goto(`${BASE}/tabela-calhas?aba=pintura`, { waitUntil: "networkidle0" });
  const color = `Cor ${RUN}`;
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.evaluate((c) => {
    const form = [...document.querySelectorAll("form")].find((f) => f.querySelector("input[name=color]") && !f.querySelector("input[name=id]"));
    form.querySelector("input[name=color]").value = c;
    form.querySelector("input[name=price_per_meter]").value = "12.5";
    form.requestSubmit();
  }, color)]);
  await noProblem("cadastrar pintura");
  const p = (await db.query("select id from pricing_paints where color=$1", [color])).rows[0];
  assert.ok(p, "pintura nao gravada");
  await page.waitForFunction((c) => [...document.querySelectorAll("form input[name=id]")].some((i) => i.form.querySelector("input[name=color]")?.value === c), { timeout: 15000 }, color);
  await page.evaluate((c) => {
    const form = [...document.querySelectorAll("form")].find((f) => f.querySelector("input[name=id]") && f.querySelector("input[name=color]")?.value === c);
    const details = form.closest("details"); if (details) details.open = true;
    // Botao de excluir so com icone (lixeira vermelha).
    form.querySelector("button.text-red-600").click();
  }, color);
  await settle();
  await noProblem("excluir pintura");
  assert.equal((await db.query("select 1 from pricing_paints where id=$1", [p.id])).rowCount, 0, "pintura nao excluida");
});

test("agenda: atualizar status do evento", async () => {
  const title = `Evento Status ${RUN}`;
  const ev = (await db.query("insert into operational_events(company_id,event_type,title,starts_at,status) values($1,'reuniao',$2,now()+interval '1 hour','agendado') returning id", [cid, title])).rows[0];
  await page.goto(`${BASE}/agenda`, { waitUntil: "networkidle0" });
  await click("Dia");
  await settle();
  const opened = await page.evaluate((t) => {
    const el = [...document.querySelectorAll("button, div[role=button], div")].reverse().find((x) => x.innerText?.trim().startsWith(t) || x.innerText?.includes(t));
    el?.click();
    return Boolean(el);
  }, title);
  assert.ok(opened, "evento nao aparece na agenda");
  await new Promise((r) => setTimeout(r, 500));
  const changed = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /confirmar|concluir|concluído|confirmado/i.test(b.innerText));
    btn?.click();
    return btn?.innerText ?? null;
  });
  await settle();
  await noProblem("status do evento");
  if (changed) {
    const st = (await db.query("select status from operational_events where id=$1", [ev.id])).rows[0].status;
    assert.notEqual(st, "agendado", `status nao mudou apos "${changed}"`);
  }
});

test("identidade: remover logo", async () => {
  await db.query("update companies set logo_url='http://localhost:54321/storage/v1/object/public/company-assets/logos/x.png' where id=$1", [cid]);
  await page.goto(`${BASE}/configuracoes/identidade`, { waitUntil: "networkidle0" });
  await click("Remover");
  await settle();
  await noProblem("remover logo");
  assert.equal((await db.query("select logo_url from companies where id=$1", [cid])).rows[0].logo_url, null);
});
