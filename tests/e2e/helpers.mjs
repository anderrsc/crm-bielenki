import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("Chrome nao encontrado: defina CHROME_PATH");
  return found;
}

export async function launch() {
  return puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"], defaultViewport: { width: 1366, height: 900 } });
}

// Textos que indicam erro na pagina renderizada.
export const ERROR_PATTERNS = [
  /Application error/i, /server-side exception/i, /Unhandled Runtime Error/i, /Internal Server Error/i,
  /does not exist/i, /não existe/i, /permission denied/i, /invalid input syntax/i, /violates/i,
  /Could not find/i, /PGRST\d+/, /column .* of relation/i, /schema cache/i, /RangeError/, /TypeError/,
  /Não foi possível/i, /Erro ao /i, /Orçamento não encontrado/i,
];

export function findError(text) {
  for (const re of ERROR_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const i = Math.max(0, m.index - 80);
      return text.slice(i, m.index + 160).replace(/\s+/g, " ");
    }
  }
  return null;
}

export async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('form button')]);
  if (new URL(page.url()).pathname === "/login") throw new Error("login falhou: " + (await page.evaluate(() => document.body.innerText)).slice(0, 300));
}

// Visita a pagina e devolve { status, error, text, ms }.
export async function visit(page, path) {
  const pageErrors = [];
  const onErr = (e) => pageErrors.push(String(e.message || e));
  page.on("pageerror", onErr);
  const t = Date.now();
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0", timeout: 60000 });
  const ms = Date.now() - t;
  const text = await page.evaluate(() => document.body.innerText);
  page.off("pageerror", onErr);
  const error = findError(text) ?? (pageErrors[0] ? `pageerror: ${pageErrors[0]}` : null);
  return { status: res?.status() ?? 0, finalPath: new URL(page.url()).pathname, error, text, ms };
}

// Erro devolvido por uma server action via ?erro= na URL, ou mensagem na pagina.
export async function pageProblem(page) {
  const url = new URL(page.url());
  const erro = url.searchParams.get("erro");
  if (erro) return `?erro=${erro}`;
  const text = await page.evaluate(() => document.body.innerText);
  return findError(text);
}

// Clica num botao (por texto) e espera a navegacao causada pela server action.
export async function clickAndWait(page, text, { scope = "body" } = {}) {
  const handle = await page.evaluateHandle((t, sc) => {
    const root = document.querySelector(sc) ?? document.body;
    return [...root.querySelectorAll("button, a")].find((el) => el.innerText.trim().toLowerCase().includes(t.toLowerCase()) && !el.disabled) ?? null;
  }, text, scope);
  const el = handle.asElement();
  if (!el) throw new Error(`botao "${text}" nao encontrado em ${page.url()}`);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), el.click()]);
}

export async function selectByText(page, selector, text) {
  const value = await page.$eval(selector, (sel, t) => [...sel.options].find((o) => o.text.includes(t))?.value ?? null, text);
  if (value == null) throw new Error(`opcao "${text}" nao encontrada em ${selector}`);
  await page.select(selector, value);
}

// Preenche o campo (input/select/textarea) que segue o <label> com esse texto.
// Usa o setter nativo + eventos, que e o que componentes React controlados escutam.
export async function setByLabel(page, label, value, nth = 0) {
  const ok = await page.evaluate((l, v, n) => {
    const labels = [...document.querySelectorAll("label")].filter((x) => x.textContent.trim() === l);
    const el = labels[n]?.parentElement.querySelector("input, select, textarea");
    if (!el) return false;
    if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === v)) {
      const opt = [...el.options].find((o) => o.text.includes(v));
      if (!opt) return false;
      v = opt.value;
    }
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, label, String(value), nth);
  if (!ok) throw new Error(`campo "${label}" (${nth}) nao encontrado ou opcao "${value}" inexistente em ${page.url()}`);
}

// Espera as requisicoes do proprio app (server actions, RSC) terminarem.
// Ignora requisicoes de terceiros/do navegador, que no Chrome do CI podem
// ficar abertas e faziam waitForNetworkIdle estourar. Se estourar o tempo,
// avisa quais ficaram pendentes e segue: a asserção seguinte decide.
const inflight = new WeakMap();
export function trackRequests(page) {
  const set = new Set();
  inflight.set(page, set);
  const own = (r) => r.url().startsWith(BASE);
  page.on("request", (r) => { if (own(r)) set.add(r); });
  page.on("requestfinished", (r) => set.delete(r));
  page.on("requestfailed", (r) => set.delete(r));
}
export async function settle(page, { idleTime = 600, timeout = 20000 } = {}) {
  const set = inflight.get(page);
  if (!set) throw new Error("chame trackRequests(page) antes de settle(page)");
  const start = Date.now();
  let idleSince = set.size === 0 ? Date.now() : null;
  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 100));
    if (set.size === 0) { idleSince ??= Date.now(); if (Date.now() - idleSince >= idleTime) return; }
    else idleSince = null;
  }
  console.warn(`settle: ${set.size} requisicao(oes) ainda pendente(s): ${[...set].map((r) => `${r.method()} ${r.url()}`).join(", ")}`);
}
