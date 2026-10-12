// Acoes das telas interativas (componentes React): funcionarios, agenda,
// pipeline, identidade/logo, agente de IA, construtor de automacoes e matriz.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { launch, login, BASE, pageProblem, setByLabel } from "./helpers.mjs";

const RUN = Date.now().toString(36);
let browser, page, db;

before(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm" });
  await db.connect();
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
const clickText = (t, scope = "body") => page.evaluate((t, s) => {
  const el = [...document.querySelector(s).querySelectorAll("button, a, summary")].find((b) => b.innerText.trim().includes(t));
  if (!el) throw new Error(`"${t}" nao encontrado`);
  el.click();
}, t, scope);
const settle = () => page.waitForNetworkIdle({ idleTime: 700, timeout: 30000 });

test("funcionarios: criar usuario com cargo e editar", async () => {
  await page.goto(`${BASE}/configuracoes/funcionarios`, { waitUntil: "networkidle0" });
  await clickText("Criar usuário");
  await page.waitForSelector("input[name=email]");
  const email = `func.${RUN}@teste.local`;
  await page.type("input[name=full_name]", `Funcionario ${RUN}`);
  await page.type("input[name=email]", email);
  await page.type("input[name=password]", "senha-func-123");
  await page.evaluate(() => {
    const form = document.querySelector("input[name=email]").form;
    const vendedor = [...form.querySelectorAll("label")].find((l) => l.textContent.trim() === "Vendedor")?.querySelector("input") ?? form.querySelector("input[name=roles][value=vendedor]");
    if (vendedor) vendedor.click();
  });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.evaluate(() => document.querySelector("input[name=email]").form.requestSubmit())]);
  await noProblem("criar usuario");
  const prof = (await db.query("select p.id, p.full_name, array_agg(r.role::text) roles from profiles p left join user_roles r on r.profile_id=p.id where p.email=$1 group by p.id", [email])).rows[0];
  assert.ok(prof, "perfil do funcionario nao criado");
  assert.ok(prof.roles.includes("vendedor"), `cargo nao aplicado: ${prof.roles}`);

  // Novo usuario consegue entrar no sistema.
  const ctx = await browser.createBrowserContext();
  const p2 = await ctx.newPage();
  await login(p2, email, "senha-func-123");
  assert.notEqual(new URL(p2.url()).pathname, "/login");
  await ctx.close();
});

test("agenda: criar evento", async () => {
  await page.goto(`${BASE}/agenda`, { waitUntil: "networkidle0" });
  await clickText("Novo evento");
  await page.waitForSelector("input[name=title]");
  const title = `Visita tecnica ${RUN}`;
  await page.type("input[name=title]", title);
  await page.select("select[name=type]", "medicao");
  const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  await page.$eval("input[name=date]", (el, v) => (el.value = v), day);
  await page.$eval("input[name=time]", (el) => (el.value = "14:30"));
  await clickText("Criar evento");
  await settle();
  await noProblem("criar evento");
  const ev = (await db.query("select event_type, status from operational_events where title=$1", [title])).rows[0];
  assert.ok(ev, "evento nao gravado");
  assert.equal(ev.event_type, "medicao");
});

test("pipeline: mover lead de etapa", async () => {
  const cid = (await db.query("select company_id, id from profiles order by created_at limit 1")).rows[0];
  const stages = (await db.query("select id, name from pipeline_stages where company_id=$1 order by sort_order", [cid.company_id])).rows;
  const lead = (await db.query("insert into leads(company_id,name,stage_id,owner_id,status,estimated_value) values($1,$2,$3,$4,'aberto',500) returning id", [cid.company_id, `Lead ${RUN}`, stages[0].id, cid.id])).rows[0];
  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle0" });
  await page.evaluate((name, stageId) => {
    const card = [...document.querySelectorAll("select[aria-label='Mover etapa']")].find((s) => s.closest("article, div")?.innerText.includes(name) || s.parentElement.parentElement.innerText.includes(name));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(card, stageId);
    card.dispatchEvent(new Event("change", { bubbles: true }));
  }, `Lead ${RUN}`, stages[2].id);
  await settle();
  const after = (await db.query("select stage_id from leads where id=$1", [lead.id])).rows[0];
  assert.equal(after.stage_id, stages[2].id);
});

test("identidade: enviar logo e salvar configuracoes", async () => {
  await page.goto(`${BASE}/configuracoes/identidade`, { waitUntil: "networkidle0" });
  const png = path.join(os.tmpdir(), `logo-${RUN}.png`);
  fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const input = await page.$("input[type=file]");
  assert.ok(input, "campo de arquivo do logo nao encontrado");
  // O upload dispara no onChange do campo de arquivo.
  await input.uploadFile(png);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Trocar logo/.test(b.innerText)) || document.querySelector("p.text-red-700, p.text-red-600"), { timeout: 30000 });
  const uploadError = await page.$eval("main", (m) => m.querySelector("p.text-red-700, p.text-red-600")?.textContent ?? null);
  assert.equal(uploadError, null, `erro no upload: ${uploadError}`);
  await noProblem("enviar logo");
  const company = (await db.query("select logo_url from companies c join profiles p on p.company_id=c.id order by p.created_at limit 1")).rows[0];
  assert.ok(company.logo_url, "logo_url nao gravado");
  await clickText("Salvar configurações");
  await settle();
  await noProblem("salvar configuracoes de logo");
});

test("agente de IA: salvar configuracoes", async () => {
  await page.goto(`${BASE}/agente-ia`, { waitUntil: "networkidle0" });
  await clickText("Configurações");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.innerText.includes("Salvar configurações")));
  await clickText("Salvar configurações");
  await settle();
  await noProblem("salvar agente de IA");
});

test("automacoes: salvar fluxo como rascunho", async () => {
  await page.goto(`${BASE}/automacoes/novo`, { waitUntil: "networkidle0" });
  const nameInput = await page.$("input[name=name], input[placeholder*='ome']");
  const wfName = `Fluxo ${RUN}`;
  if (nameInput) { await nameInput.click({ clickCount: 3 }); await nameInput.type(wfName); }
  await clickText("📱 Enviar");
  await clickText("Salvar rascunho");
  await settle();
  await noProblem("salvar fluxo");
  const wf = (await db.query("select status from workflows order by created_at desc limit 1")).rows[0];
  assert.ok(wf, "fluxo nao gravado");
});

test("materia-prima: novo corte na matriz de aluminio", async () => {
  await page.goto(`${BASE}/tabela-calhas?aba=materia-prima`, { waitUntil: "networkidle0" });
  const cut = String(300 + Math.floor(Math.random() * 600));
  await clickText("Corte");
  await page.waitForFunction(() => document.querySelector(".card [title=Salvar]"));
  await page.evaluate((cutValue) => {
    const card = [...document.querySelectorAll(".card")].find((c) => c.querySelector("[title=Salvar]"));
    const rows = card.querySelectorAll("[title=Salvar]");
    const row = rows[rows.length - 1].closest(".group");
    const [cutInput, price] = row.querySelectorAll("input[type=number]");
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(cutInput, cutValue); set(price, "77.5");
  }, cut);
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".card")].find((c) => c.querySelector("[title=Salvar]"));
    const rows = card.querySelectorAll("[title=Salvar]");
    rows[rows.length - 1].click();
  });
  await settle();
  const err = await page.$$eval("svg[aria-label]", (s) => s.map((x) => x.getAttribute("aria-label")));
  assert.deepEqual(err, [], `erro ao salvar matriz: ${err}`);
  const saved = (await db.query("select price_per_meter from aluminum_price_matrix where cut_mm=$1", [Number(cut)])).rows[0];
  assert.ok(saved, "linha da matriz nao gravada");
  assert.equal(Number(saved.price_per_meter), 77.5);
});

test("materia-prima: nova linha na planilha de precos", async () => {
  await page.goto(`${BASE}/tabela-calhas?aba=materia-prima`, { waitUntil: "networkidle0" });
  const before = (await db.query("select count(*)::int n from gutter_prices")).rows[0].n;
  await clickText("Novo");
  await new Promise((r) => setTimeout(r, 300));
  // "Novo" abre a celula de produto da linha nova ja em edicao.
  await page.waitForFunction(() => document.activeElement?.tagName === "INPUT");
  await page.evaluate(() => { document.activeElement.select?.(); });
  await page.keyboard.type(`Rufo Teste ${RUN}`);
  await page.keyboard.press("Enter");
  await clickText("Salvar");
  await settle();
  await noProblem("salvar planilha");
  const after = (await db.query("select count(*)::int n from gutter_prices")).rows[0].n;
  assert.equal(after, before + 1, "linha da planilha nao gravada");
});
