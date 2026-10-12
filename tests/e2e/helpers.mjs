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
