// Fluxo comercial completo pela interface, como o usuario faz:
// cliente -> orcamento de calhas (preco automatico) -> PDF A4 -> editar ->
// duplicar -> excluir -> aprovar (venda, pedido, financeiro) -> pagamento.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { launch, login, BASE, pageProblem, clickAndWait, selectByText } from "./helpers.mjs";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm";
const RUN = Date.now().toString(36);
const CLIENT = `Cliente Fluxo ${RUN}`;

let browser, page, db;
const state = {};

before(async () => {
  db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  // Preco gravado no formato das migrations ("0.50 mm"); a tela usa "0.5mm".
  await db.query(`
    insert into gutter_prices(company_id, product, category, thickness, cut_mm, color, unit_price, active)
    select company_id, 'Calha de Beiral', 'Calhas', '0.50 mm', 200, 'Aluminio Natural', 95, true
    from profiles order by created_at limit 1
    on conflict do nothing`);
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

async function setNumberByLabel(label, value, nth = 0) {
  const inputs = await page.$$eval("label", (ls, l) => ls.map((x, i) => (x.textContent.trim() === l ? i : -1)).filter((i) => i >= 0), label);
  assert.ok(inputs.length > nth, `campo "${label}" nao encontrado`);
  const handle = await page.evaluateHandle((l, n) => [...document.querySelectorAll("label")].filter((x) => x.textContent.trim() === l)[n].parentElement.querySelector("input"), label, nth);
  // Campo controlado pelo React: troca o valor pelo setter nativo e dispara input.
  await handle.asElement().evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, String(value));
}

async function readNumberByLabel(label, nth = 0) {
  return page.evaluate((l, n) => [...document.querySelectorAll("label")].filter((x) => x.textContent.trim() === l)[n].parentElement.querySelector("input").value, label, nth);
}

test("cadastrar cliente", async () => {
  await page.goto(`${BASE}/clientes/novo`, { waitUntil: "networkidle0" });
  await page.type('input[name="name"]', CLIENT);
  await page.type('input[name="phone"]', "(47) 98888-7777");
  await page.type('input[name="address"]', "Rua das Calhas, 100");
  await page.type('input[name="city"]', "Jaraguá do Sul");
  await page.type('input[name="state"]', "SC");
  await clickAndWait(page, "Salvar cliente");
  await noProblem("cadastrar cliente");
  assert.match(page.url(), /\/clientes\/[0-9a-f-]{36}$/);
  state.clientId = page.url().split("/").pop();
  assert.ok((await page.content()).includes(CLIENT));
});

test("editar cliente", async () => {
  await page.goto(`${BASE}/clientes/${state.clientId}/editar`, { waitUntil: "networkidle0" });
  await page.$eval('input[name="email"]', (el) => (el.value = ""));
  await page.type('input[name="email"]', "cliente@teste.local");
  await clickAndWait(page, "Salvar cliente");
  await noProblem("editar cliente");
  const { rows } = await db.query("select email, address from clients where id=$1", [state.clientId]);
  assert.equal(rows[0].email, "cliente@teste.local");
  assert.equal(rows[0].address, "Rua das Calhas, 100");
});

test("criar orcamento de calhas com preco automatico da tabela", async () => {
  await page.goto(`${BASE}/orcamentos/calhas`, { waitUntil: "networkidle0" });
  await selectByText(page, "select.field", CLIENT);
  assert.equal(Number(await readNumberByLabel("R$/metro")), 95, "preco da tabela nao foi aplicado (espessura 0.5mm x 0.50 mm)");
  await setNumberByLabel("Metros", 10);
  await clickAndWait(page, "Salvar orçamento");
  await noProblem("salvar orcamento");
  assert.match(page.url(), /\/orcamentos\/[0-9a-f-]{36}$/);
  state.quoteId = page.url().split("/").pop();
  const { rows } = await db.query("select total, status from quotes where id=$1", [state.quoteId]);
  assert.equal(Number(rows[0].total), 950);
});

// Clica no botao (confere que a tela nao mostra erro) e baixa o mesmo PDF pela pagina.
async function downloadPdf() {
  const started = Date.now();
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/api/orcamentos/${state.quoteId}/pdf`), { timeout: 90000 }),
    page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Baixar PDF")).click()),
  ]);
  const ms = Date.now() - started;
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].some((b) => b.innerText.includes("Gerando PDF")), { timeout: 90000 });
  const alert = await page.$eval("body", (b) => b.querySelector("[role=alert]")?.textContent ?? null);
  assert.equal(alert, null, `botao mostrou erro: ${alert}`);
  const data = await page.evaluate(async (id) => {
    const r = await fetch(`/api/orcamentos/${id}/pdf`);
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = ""; for (const c of buf) s += String.fromCharCode(c);
    return { type: r.headers.get("content-type"), latin1: s };
  }, state.quoteId);
  return { status: res.status(), type: data.type, body: Buffer.from(data.latin1, "latin1"), ms };
}

test("baixar PDF do orcamento em A4 (e segundo download vem do cache)", { timeout: 180000 }, async () => {
  await page.goto(`${BASE}/orcamentos/${state.quoteId}`, { waitUntil: "networkidle0" });
  const first = await downloadPdf();
  assert.equal(first.status, 200, first.body.toString().slice(0, 200));
  assert.equal(first.type, "application/pdf");
  const pdf = first.body.toString("latin1");
  assert.ok(pdf.startsWith("%PDF"), "nao e PDF: " + pdf.slice(0, 300));
  assert.match(pdf, /MediaBox\s*\[0 0 595\.9\d* 841\.9\d*\]/, "PDF nao esta em A4");
  assert.equal((pdf.match(/\/Type\s*\/Page[^s]/g) || []).length, 1, "orcamento curto deve caber em 1 pagina");
  const { rows } = await db.query("select pdf_generated_at >= updated_at fresh from quotes where id=$1", [state.quoteId]);
  assert.equal(rows[0].fresh, true, "cache do PDF nao ficou valido apos gerar");
  const second = await downloadPdf();
  assert.equal(second.status, 200);
  console.log(`PDF: 1o download ${first.ms}ms, 2o (cache) ${second.ms}ms`);
  assert.ok(second.ms < 1500, `download do cache demorou ${second.ms}ms`);
});

test("editar orcamento recalcula total e invalida o PDF em cache", async () => {
  await page.goto(`${BASE}/orcamentos/${state.quoteId}/editar`, { waitUntil: "networkidle0" });
  await noProblem("abrir edicao");
  await setNumberByLabel("Metros", 12);
  await clickAndWait(page, "Salvar orçamento");
  await noProblem("salvar edicao");
  const { rows } = await db.query("select total, pdf_generated_at >= updated_at fresh from quotes where id=$1", [state.quoteId]);
  assert.equal(Number(rows[0].total), 1140);
  assert.notEqual(rows[0].fresh, true);
});

test("duplicar e excluir orcamento", async () => {
  await page.goto(`${BASE}/orcamentos/${state.quoteId}`, { waitUntil: "networkidle0" });
  await clickAndWait(page, "Duplicar");
  await noProblem("duplicar");
  const dupId = page.url().match(/orcamentos\/([0-9a-f-]{36})/)?.[1];
  assert.ok(dupId && dupId !== state.quoteId, `duplicar nao abriu o novo orcamento: ${page.url()}`);
  const { rows } = await db.query("select total from quotes where id=$1", [dupId]);
  assert.equal(Number(rows[0].total), 1140);
  await page.goto(`${BASE}/orcamentos/${dupId}`, { waitUntil: "networkidle0" });
  await clickAndWait(page, "Excluir");
  await noProblem("excluir");
  assert.equal((await db.query("select 1 from quotes where id=$1", [dupId])).rowCount, 0);
});

test("aprovar orcamento gera venda, pedido e conta a receber", async () => {
  await page.goto(`${BASE}/orcamentos/${state.quoteId}`, { waitUntil: "networkidle0" });
  await clickAndWait(page, "Aprovar orçamento");
  await noProblem("aprovar");
  assert.match(page.url(), /\/vendas\/[0-9a-f-]{36}/);
  state.saleId = page.url().match(/vendas\/([0-9a-f-]{36})/)[1];
  const q = await db.query("select status, sale_id from quotes where id=$1", [state.quoteId]);
  assert.equal(q.rows[0].status, "aprovado");
  assert.equal(q.rows[0].sale_id, state.saleId);
  const s = await db.query("select total from sales where id=$1", [state.saleId]);
  assert.equal(Number(s.rows[0].total), 1140);
  assert.equal((await db.query("select 1 from orders where sale_id=$1", [state.saleId])).rowCount, 1, "pedido nao criado");
  const fe = await db.query("select id, total_amount from financial_entries where sale_id=$1 and entry_type='receber'", [state.saleId]);
  assert.ok(fe.rowCount >= 1, "conta a receber nao criada");
  state.entryId = fe.rows[0].id;
});

test("orcamento aprovado nao mostra Editar nem Excluir", async () => {
  await page.goto(`${BASE}/orcamentos/${state.quoteId}`, { waitUntil: "networkidle0" });
  const buttons = await page.$$eval("a, button", (els) => els.map((e) => e.innerText.trim()));
  assert.ok(!buttons.includes("Editar") && !buttons.includes("Excluir"));
});
