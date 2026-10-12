// Navega por todas as paginas do menu e por todos os links internos que
// aparecem nelas (detalhes, edicoes, abas, filtros), logado como admin,
// e falha se alguma pagina responder erro ou mostrar mensagem de erro.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, login, visit } from "./helpers.mjs";

const MENU = [
  "/dashboard", "/pendencias", "/pipeline", "/busca", "/clientes", "/orcamentos", "/tabela-calhas", "/vendas",
  "/pedidos", "/agenda", "/medicoes", "/compras", "/fornecedores", "/estoque", "/producao", "/instalacoes",
  "/financeiro", "/financeiro/receber", "/financeiro/pagar", "/configuracoes/funcionarios", "/configuracoes/cargos",
  "/automacoes", "/agente-ia", "/relatorios", "/auditoria", "/configuracoes",
];
// Links que disparam acoes (download, logout) ou saem do CRM.
const SKIP = [/^\/api\//, /^\/login/, /^\/ficha\//, /\/impressao$/, /^\/logout/];

let browser, page;
before(async () => {
  browser = await launch();
  page = await browser.newPage();
  await login(page, process.env.E2E_EMAIL ?? "admin@teste.local", process.env.E2E_PASSWORD ?? "senha-de-teste-123");
});
after(async () => browser?.close());

test("todas as paginas do menu e links internos abrem sem erro", { timeout: 15 * 60 * 1000 }, async () => {
  const queue = [...MENU];
  const seen = new Set();
  const failures = [];
  const maxPages = Number(process.env.E2E_MAX_PAGES ?? 400);
  while (queue.length && seen.size < maxPages) {
    const path = queue.shift();
    const key = path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").replace(/\?.*$/, (q) => q.replace(/=[^&]*/g, "="));
    if (seen.has(key)) continue;
    seen.add(key);
    const v = await visit(page, path);
    const line = `${path} -> ${v.finalPath} ${v.status} ${v.ms}ms`;
    if (v.status >= 400 || v.error || v.finalPath === "/login") failures.push(`${line} ${v.error ?? ""}`);
    else console.log(`ok ${line}`);
    const links = await page.$$eval("a[href^='/']", (as) => as.map((a) => a.getAttribute("href")));
    for (const href of links) if (href && !SKIP.some((re) => re.test(href))) queue.push(href.split("#")[0]);
  }
  console.log(`${seen.size} paginas visitadas`);
  assert.deepEqual(failures, []);
});
