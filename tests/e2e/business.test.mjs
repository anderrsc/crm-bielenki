// Fluxos operacionais pela interface: venda avulsa, compra avulsa,
// orcamento de esquadrias, baixa parcial e renegociacao no financeiro.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { launch, login, BASE, pageProblem, clickAndWait, setByLabel, settle as settleRequests, trackRequests } from "./helpers.mjs";

const RUN = Date.now().toString(36);
let browser, page, db;
const state = {};

before(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm" });
  await db.connect();
  const cid = (await db.query("select company_id from profiles order by created_at limit 1")).rows[0].company_id;
  state.client = (await db.query("insert into clients(company_id,name,city) values($1,$2,'Joinville') returning id,name", [cid, `Cliente Negocio ${RUN}`])).rows[0];
  state.supplier = (await db.query("insert into suppliers(company_id,name) values($1,$2) returning id,name", [cid, `Fornecedor Negocio ${RUN}`])).rows[0];
  browser = await launch();
  page = await browser.newPage();
  trackRequests(page);
  page.on("dialog", (d) => d.accept());
  await login(page, process.env.E2E_EMAIL ?? "admin@teste.local", process.env.E2E_PASSWORD ?? "senha-de-teste-123");
});
after(async () => { await browser?.close(); await db?.end(); });

async function noProblem(step) {
  const problem = await pageProblem(page);
  assert.equal(problem, null, `${step}: ${problem} (${page.url()})`);
}

test("venda avulsa com pagamento parcial", async () => {
  await page.goto(`${BASE}/vendas/nova`, { waitUntil: "networkidle0" });
  await setByLabel(page, "Cliente", state.client.name);
  await setByLabel(page, "Tipo de venda", "Venda avulsa de acessórios");
  await setByLabel(page, "Produto / serviço", "Kit de rebites");
  await setByLabel(page, "Descrição", "Rebites 4mm");
  await setByLabel(page, "Quantidade", 4);
  await setByLabel(page, "Valor unitário", 25);
  await setByLabel(page, "Valor já recebido", 40);
  await clickAndWait(page, "Cadastrar venda");
  await noProblem("venda avulsa");
  const saleId = page.url().match(/vendas\/([0-9a-f-]{36})/)?.[1];
  assert.ok(saleId, `nao abriu a venda: ${page.url()}`);
  const s = (await db.query("select total, paid_amount from sales where id=$1", [saleId])).rows[0];
  assert.equal(Number(s.total), 100);
  assert.equal(Number(s.paid_amount), 40);
  const fe = (await db.query("select id, open_amount from financial_entries where sale_id=$1 and entry_type='receber'", [saleId])).rows;
  assert.equal(fe.reduce((t, r) => t + Number(r.open_amount), 0), 60, "saldo a receber deveria ser 60");
  state.saleEntry = fe.find((r) => Number(r.open_amount) > 0).id;
});

test("compra avulsa e recebimento do material", async () => {
  await page.goto(`${BASE}/compras/nova`, { waitUntil: "networkidle0" });
  await setByLabel(page, "Fornecedor", state.supplier.name);
  await setByLabel(page, "Descrição do material", `Bobina aluminio ${RUN}`);
  await setByLabel(page, "Quantidade", 2);
  await setByLabel(page, "Valor unitário", 300);
  await clickAndWait(page, "Cadastrar compra");
  await noProblem("compra avulsa");
  const poId = page.url().match(/compras\/([0-9a-f-]{36})/)?.[1];
  assert.ok(poId, `nao abriu a compra: ${page.url()}`);
  const po = (await db.query("select total from purchase_orders where id=$1", [poId])).rows[0];
  assert.equal(Number(po.total), 600);
  const pay = (await db.query("select sum(open_amount) open from financial_entries where purchase_order_id=$1 and entry_type='pagar'", [poId])).rows[0];
  assert.equal(Number(pay.open), 600, "conta a pagar da compra");
  // Receber o item na tela da compra (se a tela oferecer o recebimento).
  await page.goto(`${BASE}/compras/${poId}`, { waitUntil: "networkidle0" });
  await noProblem("detalhe da compra");
  const hasReceive = await page.$$eval("button", (bs) => bs.some((b) => /receber/i.test(b.innerText)));
  if (hasReceive) {
    await clickAndWait(page, "Receber");
    await noProblem("receber item");
    const st = (await db.query("select status from purchase_orders where id=$1", [poId])).rows[0].status;
    assert.notEqual(st, "solicitacao_criada");
  }
  state.poId = poId;
});

test("orcamento de esquadrias", async () => {
  await page.goto(`${BASE}/orcamentos/esquadrias`, { waitUntil: "networkidle0" });
  await setByLabel(page, "Cliente", state.client.name);
  await setByLabel(page, "Medidas (L x A)", "1200 x 1000");
  await setByLabel(page, "Vidro", "Temperado 6mm");
  await setByLabel(page, "Quantidade", 2);
  await setByLabel(page, "Valor unitário", 850);
  await clickAndWait(page, "Salvar orçamento");
  await noProblem("orcamento esquadrias");
  const quoteId = page.url().match(/orcamentos\/([0-9a-f-]{36})/)?.[1];
  assert.ok(quoteId, `nao abriu o orcamento: ${page.url()}`);
  const q = (await db.query("select total from quotes where id=$1", [quoteId])).rows[0];
  assert.equal(Number(q.total), 1700);
  const items = (await db.query("select count(*)::int n from quote_items where quote_id=$1", [quoteId])).rows[0].n;
  assert.equal(items, 1);
  // Sem tela de edicao para esquadrias: o botao Editar nao deve aparecer.
  const labels = await page.$$eval("a", (as) => as.map((a) => a.innerText.trim()));
  assert.ok(!labels.includes("Editar"));
});

test("financeiro: baixa parcial e renegociacao de vencimento", async () => {
  await page.goto(`${BASE}/financeiro/receber`, { waitUntil: "networkidle0" });
  await noProblem("financeiro");
  const before = (await db.query("select open_amount, due_date from financial_entries where id=$1", [state.saleEntry])).rows[0];
  // Abre o "Dar baixa" da linha do lancamento da venda avulsa.
  const opened = await page.evaluate((client) => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(client) && r.innerText.includes("Dar baixa"));
    const btn = row && [...row.querySelectorAll("button")].find((b) => b.innerText.includes("Dar baixa"));
    btn?.click();
    return Boolean(btn);
  }, state.client.name);
  assert.ok(opened, "linha do lancamento com 'Dar baixa' nao encontrada");
  await page.waitForSelector("[role=dialog] input[name=amount]");
  await page.$eval("[role=dialog] input[name=amount]", (el) => (el.value = "10"));
  await clickAndWait(page, "Confirmar baixa", { scope: "[role=dialog]" });
  await noProblem("dar baixa");
  const after1 = (await db.query("select open_amount, paid_amount from financial_entries where id=$1", [state.saleEntry])).rows[0];
  assert.equal(Number(after1.open_amount), Number(before.open_amount) - 10);

  await page.goto(`${BASE}/financeiro/receber`, { waitUntil: "networkidle0" });
  const openedR = await page.evaluate((client) => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(client) && r.querySelector("[title='Renegociar vencimento']"));
    row?.querySelector("[title='Renegociar vencimento']").click();
    return Boolean(row);
  }, state.client.name);
  assert.ok(openedR, "botao de renegociar nao encontrado");
  await page.waitForSelector("input[name=new_due_date]");
  const newDue = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  await page.$eval("input[name=new_due_date]", (el, v) => (el.value = v), newDue);
  const reason = await page.$("textarea[name=reason], input[name=reason]");
  if (reason) await reason.type("Cliente pediu mais prazo");
  await page.evaluate(() => document.querySelector("input[name=new_due_date]").form.requestSubmit());
  await settleRequests(page);
  await noProblem("renegociar");
  const after2 = (await db.query("select to_char(due_date,'YYYY-MM-DD') due from financial_entries where id=$1", [state.saleEntry])).rows[0];
  assert.equal(after2.due, newDue);
});

test("receber material da compra no estoque (Materiais do pedido)", async () => {
  await page.goto(`${BASE}/producao/materiais-do-pedido`, { waitUntil: "networkidle0" });
  await noProblem("materiais do pedido");
  const card = await page.evaluateHandle((name) => [...document.querySelectorAll("article")].find((a) => a.innerText.includes(name)), `Bobina aluminio ${RUN}`);
  assert.ok(card.asElement(), "material da compra avulsa nao aparece em Materiais do pedido");
  await card.asElement().$eval("summary", (s) => s.click());
  const btn = await card.asElement().$("form button");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), btn.click()]);
  await noProblem("receber material");
  const st = (await db.query("select status from purchase_orders where id=$1", [state.poId])).rows[0].status;
  assert.equal(st, "recebido_completo");
  const mov = (await db.query("select count(*)::int n from stock_movements m join purchase_order_items i on i.id=m.purchase_order_item_id where i.purchase_order_id=$1", [state.poId])).rows[0].n;
  assert.ok(mov >= 1, "entrada no estoque nao registrada");
});
