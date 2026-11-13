// OFX banking fields: https://financialdataexchange.org/about-fdx/ofx-work-group/
// Parse data only. No network, financial writes or automatic matching.
import { createHash } from "node:crypto";
import { validIsoDate } from "@/lib/valid-date";

export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;
export const MAX_STATEMENT_ROWS = 2000;
export type BankStatementRow = { external_id: string; posted_at: string; amount: string; description: string };
export type BankStatement = { format: "OFX" | "CSV"; rows: BankStatementRow[]; repeated: number; source_key: string | null; account_hint: string | null };
type Locale = "pt-BR" | "en-US";

export function decodeBankStatement(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_STATEMENT_BYTES) throw new Error("Envie um extrato de até 5 MB.");
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}

/** Exact decimal parsing into cents; never guess the decimal convention. */
function amount(raw: string, locale: Locale, ofx = false): string {
  let value = raw.trim(), negative = false;
  if (/^\(.*\)$/.test(value)) { negative = true; value = value.slice(1, -1); }
  if (/^[+-]/.test(value)) { if (negative) throw new Error("Sinal de valor inválido."); negative = value[0] === "-"; value = value.slice(1); }
  if (ofx) {
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) throw new Error("Valor OFX inválido.");
    value = value.replace(",", ".");
  } else {
    const regex = locale === "pt-BR" ? /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/ : /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
    if (!regex.test(value)) throw new Error("Valor inválido para o formato decimal escolhido.");
    value = locale === "pt-BR" ? value.replaceAll(".", "").replace(",", ".") : value.replaceAll(",", "");
  }
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 99999999999999) throw new Error("O valor deve ser diferente de zero e ter até 12 dígitos inteiros.");
  return `${negative ? "-" : ""}${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
function date(raw: string, ofx = false): string {
  let value = raw.trim();
  if (ofx) {
    if (!/^\d{8}(?:\d|\.|\[|$)/.test(value)) throw new Error("Data OFX inválida.");
    value = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) value = `${value.slice(6)}-${value.slice(3, 5)}-${value.slice(0, 2)}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !validIsoDate(value) || value < "1900-01-01" || value > "2100-12-31") throw new Error("Data inválida. Use AAAA-MM-DD ou DD/MM/AAAA.");
  return value;
}
function clean(value: string) { return value.replace(/\s+/g, " ").trim(); }
function entities(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[code.toLowerCase()];
  });
}
function row(id: string, posted: string, rawAmount: string, description: string, locale: Locale, ofx = false): BankStatementRow {
  const external_id = clean(id), label = clean(description);
  if (!external_id || external_id.length > 255) throw new Error("Cada movimentação precisa de identificador estável de até 255 caracteres.");
  if (!label || label.length > 500) throw new Error("A descrição precisa ter de 1 a 500 caracteres.");
  return { external_id, posted_at: date(posted, ofx), amount: amount(rawAmount, locale, ofx), description: label };
}
function unique(rows: BankStatementRow[]) {
  if (!rows.length || rows.length > MAX_STATEMENT_ROWS) throw new Error("Importe de 1 a 2.000 movimentações por arquivo.");
  const map = new Map<string, BankStatementRow>(); let repeated = 0;
  for (const r of rows) {
    const previous = map.get(r.external_id);
    if (previous && (previous.amount !== r.amount || previous.posted_at !== r.posted_at)) throw new Error("Um identificador está repetido com data ou valor diferente. Revise o extrato.");
    if (previous) repeated++; else map.set(r.external_id, r);
  }
  return { rows: [...map.values()], repeated };
}

function parseOfx(text: string): BankStatement {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("Declarações XML externas não são aceitas.");
  const tag = (block: string, name: string) => entities(new RegExp(`<${name}\\s*>([^<]*)`, "i").exec(block)?.[1]?.trim() ?? "");
  const currencies = [...text.matchAll(/<CURDEF\s*>([^<\r\n]+)/gi)].map(x => x[1].trim().toUpperCase());
  if (!currencies.length || currencies.some(c => c !== "BRL")) throw new Error("Esta importação aceita extratos em reais (BRL).");
  const accounts = [...text.matchAll(/<(BANKACCTFROM|CCACCTFROM)\s*>([\s\S]*?)<\/\1\s*>/gi)];
  if (accounts.length !== 1) throw new Error("Envie um extrato OFX de uma única conta.");
  const account = tag(accounts[0][2], "ACCTID");
  if (!account || account.length > 128) throw new Error("Identificação da conta OFX inválida.");
  const reference = JSON.stringify([tag(accounts[0][2], "BANKID"), tag(accounts[0][2], "BRANCHID"), account, tag(accounts[0][2], "ACCTTYPE")]);
  const blocks = [...text.matchAll(/<STMTTRN\s*>([\s\S]*?)<\/STMTTRN\s*>/gi)];
  if (blocks.length !== (text.match(/<STMTTRN\s*>/gi)?.length ?? 0)) throw new Error("Há movimentações OFX incompletas.");
  const parsed = blocks.map((block, index) => {
    if (/<CORRECTFITID|<CORRECTACTION/i.test(block[1])) throw new Error("Extratos com correções de movimentações exigem revisão antes da importação.");
    try {
      const name = tag(block[1], "NAME"), memo = tag(block[1], "MEMO");
      return row(tag(block[1], "FITID"), tag(block[1], "DTPOSTED"), tag(block[1], "TRNAMT"), name && memo && name !== memo ? `${name} — ${memo}` : memo || name || tag(block[1], "TRNTYPE"), "en-US", true);
    } catch (e) { throw new Error(`Movimentação OFX ${index + 1}: ${(e as Error).message}`); }
  });
  return { format: "OFX", ...unique(parsed), source_key: createHash("sha256").update(reference).digest("hex"), account_hint: `Final ${account.slice(-4)}` };
}

function csvRecords(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let fields: string[] = [], cell = "", quoted = false, closed = false;
  const field = () => { fields.push(cell); cell = ""; closed = false; };
  const record = () => { field(); if (fields.some(f => f.trim())) rows.push(fields); fields = []; if (rows.length > MAX_STATEMENT_ROWS + 1) throw new Error("Máximo de 2.000 movimentações por arquivo."); };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === delimiter) field();
    else if (ch === "\r" || ch === "\n") { if (ch === "\r" && text[i + 1] === "\n") i++; record(); }
    else if (ch === '"') { if (cell.trim() || closed) throw new Error("Aspas inválidas no CSV."); cell = ""; quoted = true; }
    else { if (closed && ch.trim()) throw new Error("Conteúdo inválido após aspas no CSV."); if (!closed) cell += ch; }
  }
  if (quoted) throw new Error("Há aspas abertas no CSV.");
  if (cell || fields.length || closed) record();
  return rows;
}
function parseCsv(text: string, locale: Locale): BankStatement {
  text = text.replace(/^sep=[;,\t]\r?\n/i, "");
  const first = text.split(/\r?\n/).find(l => l.trim()) ?? "";
  const candidates = [";", ",", "\t"].map(d => ({ d, n: first.split(d).length }));
  const delimiter = candidates.sort((a, b) => b.n - a.n)[0].d;
  const records = csvRecords(text, delimiter), header = records.shift() ?? [];
  const key = (h: string) => h.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const find = (aliases: string[]) => { const matches = header.map((h, i) => aliases.includes(key(h)) ? i : -1).filter(i => i >= 0); if (matches.length !== 1) throw new Error("CSV precisa das colunas id, data, valor e descricao, sem duplicar cabeçalhos."); return matches[0]; };
  const id = find(["id", "fitid", "identificador", "externalid", "transactionid"]), when = find(["data", "date", "postedat"]), value = find(["valor", "amount", "trnamt"]), desc = find(["descricao", "description", "historico", "memo"]);
  const currency = header.findIndex(h => ["moeda", "currency", "currdef"].includes(key(h)));
  const parsed = records.map((r, i) => {
    try { if (r.length !== header.length) throw new Error("Quantidade de colunas diferente do cabeçalho."); if (currency >= 0 && r[currency].trim().toUpperCase() !== "BRL") throw new Error("Esta importação aceita somente reais (BRL)."); return row(r[id], r[when], r[value], r[desc], locale); }
    catch (e) { throw new Error(`Linha CSV ${i + 2}: ${(e as Error).message}`); }
  });
  return { format: "CSV", ...unique(parsed), source_key: null, account_hint: null };
}

export function parseBankStatement(text: string, locale: Locale = "pt-BR"): BankStatement {
  text = text.replace(/^\uFEFF/, "").trim();
  if (!text || text.length > MAX_STATEMENT_BYTES || text.includes("\0")) throw new Error("Extrato vazio, inválido ou maior que 5 MB.");
  if (locale !== "pt-BR" && locale !== "en-US") throw new Error("Formato decimal inválido.");
  return /<OFX[\s>]/i.test(text) ? parseOfx(text) : parseCsv(text, locale);
}
