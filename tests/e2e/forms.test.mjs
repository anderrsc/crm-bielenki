// Envia todos os formularios (server actions) das paginas do CRM com dados
// validos e falha se alguma acao devolver erro (?erro=..., mensagem de erro
// na tela ou erro de JavaScript). Acoes destrutivas (excluir, desativar,
// estornar) rodam por ultimo em cada pagina.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { launch, login, BASE, pageProblem } from "./helpers.mjs";

// "{tabela}" na rota vira o id do registro mais recente dessa tabela.
async function resolvePaths(paths) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm" });
  await db.connect();
  const out = [];
  for (const p of paths) {
    const m = p.match(/\{(\w+)\}/);
    if (!m) { out.push(p); continue; }
    const { rows } = await db.query(`select id from public.${m[1]} order by created_at desc limit 1`);
    if (rows[0]) out.push(p.replace(m[0], rows[0].id));
  }
  await db.end();
  return out;
}

const PAGES = (process.env.E2E_FORM_PAGES ?? [
  "/clientes/novo", "/pipeline", "/fornecedores", "/vendas/nova", "/compras/nova", "/orcamentos/esquadrias",
  "/agenda", "/configuracoes", "/configuracoes/funcionarios", "/configuracoes/cargos", "/configuracoes/origens-lead",
  "/configuracoes/identidade", "/configuracoes/templates", "/automacoes", "/automacoes?aba=fluxos", "/automacoes/novo",
  "/agente-ia", "/tabela-calhas?aba=pintura", "/tabela-calhas?aba=pecas-especiais", "/tabela-calhas?aba=servicos",
  "/tabela-calhas?aba=tabelas-comerciais", "/producao", "/instalacoes", "/estoque", "/medicoes",
  "/vendas/{sales}", "/pedidos/{orders}", "/producao/{production_orders}", "/instalacoes/{installations}",
  "/compras/{purchase_orders}", "/medicoes/{measurements}", "/clientes/{clients}", "/financeiro/receber", "/financeiro/pagar",
].join(",")).split(",");

const DESTRUCTIVE = /excluir|remover|desativar|estornar|deletar|apagar|resetar|redefinir|restaurar/i;
const SKIP_BUTTON = /sair|buscar|filtrar|pesquisar/i;

let browser, page;
before(async () => {
  browser = await launch();
  page = await browser.newPage();
  page.on("dialog", (d) => d.accept());
  await login(page, process.env.E2E_EMAIL ?? "admin@teste.local", process.env.E2E_PASSWORD ?? "senha-de-teste-123");
});
after(async () => browser?.close());

// Preenche campos vazios do formulario com valores validos.
async function fillForm(formIndex, seed) {
  await page.evaluate((i, seed) => {
    const form = document.querySelectorAll("form")[i];
    const set = (el, v) => {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const future = new Date(Date.now() + 7 * 864e5);
    for (const el of form.querySelectorAll("input, select, textarea")) {
      if (el.disabled || el.type === "hidden" || el.type === "file" || el.type === "checkbox" || el.type === "radio" || el.type === "submit") continue;
      if (el.tagName === "SELECT") {
        if (!el.value) { const opt = [...el.options].find((o) => o.value); if (opt) set(el, opt.value); }
        continue;
      }
      if (el.value) continue;
      const name = (el.name || el.placeholder || "").toLowerCase();
      let v = `Teste ${seed}`;
      if (el.type === "email" || name.includes("email")) v = `teste.${seed}@teste.local`;
      else if (el.type === "number") v = el.min && Number(el.min) > 0 ? el.min : "10";
      else if (el.type === "date") v = future.toISOString().slice(0, 10);
      else if (el.type === "datetime-local") v = future.toISOString().slice(0, 16);
      else if (el.type === "time") v = "09:00";
      else if (el.type === "tel" || /phone|telefone|whatsapp|celular/.test(name)) v = "47999990000";
      else if (el.type === "password" || name.includes("senha")) v = "senha-teste-123";
      else if (el.type === "color") v = "#d71920";
      else if (el.type === "url" || name.includes("url")) v = "https://exemplo.com.br";
      else if (/cnpj|cpf|tax/.test(name)) v = "00.000.000/0001-00";
      else if (/estado|state|uf/.test(name)) v = "SC";
      else if (!el.required) continue;
      set(el, v);
    }
  }, formIndex, seed);
}

async function listForms() {
  return page.evaluate(() => [...document.querySelectorAll("form")].map((f, i) => {
    const btn = [...f.querySelectorAll("button")].find((b) => b.type !== "button") ?? null;
    return {
      i, label: (btn?.innerText || btn?.title || "").trim(), get: f.method === "get" || [...f.elements].some((e) => e.name === "q"),
      hasButton: Boolean(btn), disabled: Boolean(btn?.disabled),
      sig: [...f.elements].filter((e) => e.name).map((e) => e.name).join(","),
    };
  }));
}

for (const path of await resolvePaths(PAGES)) {
  test(`formularios de ${path}`, { timeout: 5 * 60 * 1000 }, async (t) => {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
    const initialProblem = await pageProblem(page);
    assert.equal(initialProblem, null, `pagina ja abre com erro: ${initialProblem}`);
    const forms = (await listForms()).filter((f) => !f.get && f.hasButton && !SKIP_BUTTON.test(f.label));
    // Uma acao por "tipo" de formulario; destrutivas por ultimo.
    const unique = [...new Map(forms.map((f) => [`${f.sig}|${f.label}`, f])).values()]
      .sort((a, b) => Number(DESTRUCTIVE.test(a.label)) - Number(DESTRUCTIVE.test(b.label)));
    if (!unique.length) t.diagnostic("nenhum formulario de acao nesta pagina");
    for (const f of unique) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
      const current = (await listForms()).find((x) => x.sig === f.sig && x.label === f.label);
      if (!current) continue; // sumiu (ex.: item excluido no passo anterior)
      await fillForm(current.i, Date.now().toString(36));
      const pageErrors = [];
      const onErr = (e) => pageErrors.push(String(e.message || e));
      page.on("pageerror", onErr);
      const before = page.url();
      const nav = page.waitForNavigation({ waitUntil: "networkidle0", timeout: 20000 }).catch(() => null);
      await page.evaluate((i) => {
        const form = document.querySelectorAll("form")[i];
        const btn = [...form.querySelectorAll("button")].find((b) => b.type !== "button");
        if (btn.disabled) btn.disabled = false;
        btn.click();
      }, current.i);
      await nav;
      await new Promise((r) => setTimeout(r, 300));
      page.off("pageerror", onErr);
      const invalid = await page.evaluate(() => [...document.querySelectorAll(":invalid")].filter((e) => e.tagName !== "FORM").map((e) => e.name).join(","));
      const problem = (await pageProblem(page)) ?? (pageErrors[0] ? `pageerror: ${pageErrors[0]}` : null);
      t.diagnostic(`"${f.label}" -> ${new URL(page.url()).pathname}${new URL(page.url()).search} ${problem ?? "ok"}${invalid ? ` (campos invalidos: ${invalid})` : ""}`);
      assert.equal(problem, null, `${path} formulario "${f.label}": ${problem} (antes ${before})`);
    }
  });
}
