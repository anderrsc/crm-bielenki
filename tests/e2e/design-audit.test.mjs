// Auditoria do Design System no navegador: família única, pesos, tamanhos, capitalização, rolagem horizontal e alvos de toque.
// Roda em várias larguras (320 a 1920) com a mesma conta de teste. Documentos de impressão ficam de fora.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, login, BASE } from "./helpers.mjs";

const WIDTHS = [320, 375, 390, 402, 430, 440, 768, 1024, 1440, 1920];
const ROUTES = ["/dashboard", "/orcamentos", "/agenda", "/atendimento", "/clientes", "/financeiro", "/central-ia", "/pipeline", "/configuracoes", "/orcamentos/calhas", "/orcamentos/esquadrias", "/clientes/novo", "/compras/nova", "/vendas/nova", "/automacoes", "/auditoria", "/fiscal", "/producao", "/pendencias", "/configuracoes/identidade", "/configuracoes/templates", "/financeiro/pagar/novo"];
let browser, page;
before(async () => {
  browser = await launch();
  page = await browser.newPage();
  await login(page, process.env.E2E_EMAIL ?? "admin@teste.local", process.env.E2E_PASSWORD ?? "senha-de-teste-123");
});
after(async () => { await browser?.close(); });

function audit() {
  const DOC = ".print-sheet, .quote-sheet, .measure-sheet, [data-document-preview]";
  const family = getComputedStyle(document.body).fontFamily.split(",")[0].trim();
  const bad = [];
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""}`;
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest(DOC) || ["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH"].includes(el.tagName.toUpperCase())) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").slice(0, 30);
    const issues = [];
    if (cs.fontFamily.split(",")[0].trim() !== family) issues.push(`fonte ${cs.fontFamily.split(",")[0]}`);
    if (parseFloat(cs.fontSize) < 10.99) issues.push(`tamanho ${cs.fontSize}`);
    if (![400, 500, 600, 700].includes(Number(cs.fontWeight))) issues.push(`peso ${cs.fontWeight}`);
    if (cs.textTransform !== "none") issues.push(`transform ${cs.textTransform}`);
    if (issues.length) bad.push(`${label(el)} "${text}": ${issues.join(", ")}`);
  }
  const overflow = document.documentElement.scrollWidth - innerWidth;
  const small = [];
  if (innerWidth < 768) {
    for (const el of document.querySelectorAll(".mobile-bottom-bar a, .mobile-bottom-bar button, .app-topbar button, .app-topbar a")) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.height < 43.5 || r.width < 43.5) && getComputedStyle(el).display !== "none") small.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  return { family, bad, overflow, small };
}

for (const width of WIDTHS) {
  test(`design system a ${width}px: fonte única, pesos, tamanhos, capitalização, sem rolagem horizontal`, { timeout: 420000 }, async () => {
    await page.setViewport({ width, height: width >= 1024 ? 900 : 844, isMobile: width < 768, hasTouch: width < 768 });
    for (const route of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle0", timeout: 90000 });
      const r = await page.evaluate(audit);
      assert.match(r.family, /font|Jakarta/i, `${width}px ${route}: família inesperada ${r.family}`);
      assert.deepEqual(r.bad.slice(0, 8), [], `${width}px ${route}: ${r.bad.length} elementos fora do padrão`);
      assert.ok(r.overflow <= 1, `${width}px ${route}: rolagem horizontal de ${r.overflow}px`);
      assert.deepEqual(r.small, [], `${width}px ${route}: alvos de toque menores que 44px`);
    }
  });
}

test("valores extensos não quebram nem são cortados (Pipeline e Início, 320 px)", { timeout: 120000 }, async () => {
  await page.setViewport({ width: 320, height: 800, isMobile: true, hasTouch: true });
  for (const route of ["/pipeline", "/dashboard", "/orcamentos"]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle0", timeout: 90000 });
    const cut = await page.evaluate(() => [...document.querySelectorAll("[data-fit], .mh-kpi-value strong, .mh-hero-value, .quote-row-total, .num.text-2xl")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.getAttribute("data-fit-wrap") !== "true").map((el) => el.textContent.trim()));
    assert.deepEqual(cut, [], `${route}: valores cortados`);
  }
});
