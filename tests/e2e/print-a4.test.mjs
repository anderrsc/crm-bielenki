// Impressao visual A4 do orcamento: gera o PDF de verdade (mesma rota do botao
// "Baixar PDF") para varios tipos de orcamento e confere tamanho A4, numero de
// paginas, nada cortado na borda, nada vazando na largura e o deslocamento
// oculto diluido. As paginas viram PNG em $TEST_WORK_DIR/a4 para conferencia visual.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import { launch, login, BASE, pageProblem } from "./helpers.mjs";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm";
const OUT = path.join(process.env.TEST_WORK_DIR ?? ".test-work", "a4");
const A4 = [595.28, 841.89];
const A4_PX = 794; // 210 mm a 96 dpi
let db, browser, page, admin;
const quotes = {};

const item = (o = {}) => ({ product: "Calha de Beiral", thickness: "0.50 mm", cut: "200", color: "Aluminio Natural", quantity: 2, meters: 5, unit_price: 95, ...o });

async function createQuote(name, clientName, payload, extra = {}) {
  await db.query("begin");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [admin]);
  const client = (await db.query("insert into clients(company_id,name,address,city,state) values (current_company_id(),$1,'Rua Teste, 123 - Centro','Jaraguá do Sul','SC') returning id", [clientName])).rows[0].id;
  const id = (await db.query("select create_gutter_quote($1::jsonb) id", [JSON.stringify({ client_id: client, discount: 0, freight: 0, notes: "Prazo de entrega: 15 dias úteis.\nGarantia de 1 ano.", items: [item()], ...payload })])).rows[0].id;
  if (payload.special_items?.length) {
    await db.query(`insert into quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,item_type)
      select current_company_id(),$1,x->>'product',x->>'description',coalesce(x->>'unit','unidade'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,'acessorio'
      from jsonb_array_elements($2::jsonb) x
      where not exists (select 1 from quote_items qi where qi.quote_id=$1 and qi.product=x->>'product')`, [id, JSON.stringify(payload.special_items)]);
  }
  for (const [k, v] of Object.entries(extra)) await db.query(`update quotes set ${k}=$2 where id=$1`, [id, v]);
  await db.query("commit");
  quotes[name] = id;
  return id;
}

async function pdfOf(id) {
  const data = await page.evaluate(async (qid) => {
    const r = await fetch(`/api/orcamentos/${qid}/pdf`);
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = ""; for (const c of buf) s += String.fromCharCode(c);
    return { status: r.status, type: r.headers.get("content-type"), latin1: s };
  }, id);
  assert.equal(data.status, 200, data.latin1.slice(0, 200));
  assert.equal(data.type, "application/pdf");
  return Buffer.from(data.latin1, "latin1");
}

// PNG (para olhar) + PGM em cinza (para medir as bordas) de cada pagina.
function rasterize(buf, name) {
  fs.mkdirSync(OUT, { recursive: true });
  const pdfPath = path.join(OUT, `${name}.pdf`);
  fs.writeFileSync(pdfPath, buf);
  execFileSync("pdftoppm", ["-r", "60", "-png", pdfPath, path.join(OUT, name)]);
  execFileSync("pdftoppm", ["-r", "40", "-gray", pdfPath, path.join(OUT, `${name}-g`)]);
  return fs.readdirSync(OUT).filter((f) => f.startsWith(`${name}-g`) && f.endsWith(".pgm")).sort().map((f) => readPgm(path.join(OUT, f)));
}
function readPgm(file) {
  const b = fs.readFileSync(file);
  const header = b.toString("latin1", 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  const [, w, h] = header.map(Number);
  return { w, h, px: b.subarray(header[0].length) };
}
// Fracao de pixels escuros numa faixa de colunas/linhas da pagina.
function inkIn(img, { x0 = 0, x1 = img.w, y0 = 0, y1 = img.h }) {
  let dark = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (img.px[y * img.w + x] < 200) dark++; }
  return dark / n;
}

async function checkPdf(name, { pages }) {
  const buf = await pdfOf(quotes[name]);
  const doc = await PDFDocument.load(buf);
  const sizes = doc.getPages().map((p) => [p.getWidth(), p.getHeight()]);
  for (const [i, [w, h]] of sizes.entries()) {
    assert.ok(Math.abs(w - A4[0]) < 1 && Math.abs(h - A4[1]) < 1, `${name} pag ${i + 1} nao e A4: ${w}x${h}`);
  }
  if (typeof pages === "number") assert.equal(sizes.length, pages, `${name}: ${sizes.length} paginas`);
  else assert.ok(sizes.length >= pages.min, `${name}: so ${sizes.length} paginas`);
  const imgs = rasterize(buf, name);
  for (const [i, img] of imgs.entries()) {
    // Nada encostado/cortado nas bordas (2 px = ~1,3 mm a 40 dpi).
    for (const [side, area] of [["direita", { x0: img.w - 2 }], ["esquerda", { x1: 2 }], ["baixo", { y0: img.h - 2 }]]) {
      assert.ok(inkIn(img, area) < 0.02, `${name} pag ${i + 1}: conteudo cortado na borda ${side}`);
    }
    assert.ok(inkIn(img, {}) > 0.005, `${name} pag ${i + 1}: pagina em branco`);
  }
  return { sizes, buf };
}

before(async () => {
  db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  admin = (await db.query("select p.id from profiles p join user_roles r on r.profile_id=p.id and r.role='administrador' order by p.created_at limit 1")).rows[0].id;
  fs.rmSync(OUT, { recursive: true, force: true });
  const run = Date.now().toString(36);

  await createQuote("curto", `Cliente A4 Curto ${run}`, { items: [item(), item({ product: "Rufo convencional", cut: "300", quantity: 4, meters: 3, unit_price: 52 }), item({ product: "Pingadeira", cut: "150", quantity: 1, meters: 6, unit_price: 38 })] });
  await createQuote("longo", `Cliente A4 Longo ${run}`, {
    items: Array.from({ length: 40 }, (_, i) => item({ product: i % 2 ? "Rufo convencional" : "Calha de Beiral", cut: String(200 + (i % 5) * 50), quantity: 1 + (i % 3), meters: 2.5 + i / 10, unit_price: 60 + i })),
    special_items: [{ product: "Condutor 3 polegadas", quantity: 6, unit_price: 45 }, { product: "Suporte viga U", quantity: 20, unit_price: 25 }],
  });
  await createQuote("nomes-longos", `Construtora e Incorporadora Exemplo de Nome Extremamente Comprido Para Testar Quebra de Linha LTDA ${run}`, {
    items: [item({ product: "Calha de Beiral com acabamento especial em pintura eletrostática e reforço interno nas emendas a cada 3 metros conforme projeto" }), item({ product: "Rufo", color: "Preto Fosco Texturizado", quantity: 12, meters: 123.456, unit_price: 99999.99 })],
  });
  await createQuote("deslocamento-oculto", `Cliente A4 Deslocamento ${run}`, {
    items: [item({ quantity: 1, meters: 10, unit_price: 30 }), item({ product: "Rufo convencional", quantity: 1, meters: 10, unit_price: 10 })],
    special_items: [{ product: "Deslocamento", quantity: 1, unit_price: 87.5 }],
  }, { hide_travel_price: true });
  await createQuote("sem-unitario", `Cliente A4 Sem Unitario ${run}`, { items: [item(), item({ product: "Rufo convencional" })] }, { hide_unit_prices: true });

  browser = await launch();
  page = await browser.newPage();
  await login(page, process.env.E2E_EMAIL ?? "admin@teste.local", process.env.E2E_PASSWORD ?? "senha-de-teste-123");
});
after(async () => { await browser?.close(); await db?.end(); });

test("orcamento curto: 1 pagina A4, nada cortado", { timeout: 120000 }, async () => {
  await checkPdf("curto", { pages: 1 });
});

test("orcamento longo (40 itens): varias paginas, todas A4, nada cortado", { timeout: 120000 }, async () => {
  const { sizes } = await checkPdf("longo", { pages: { min: 2 } });
  console.log(`orcamento longo: ${sizes.length} paginas`);
});

test("nomes e descricoes enormes: cabe em A4 sem vazar na largura", { timeout: 120000 }, async () => {
  await checkPdf("nomes-longos", { pages: 1 });
  await page.setViewport({ width: A4_PX, height: 1123 });
  await page.goto(`${BASE}/orcamentos/${quotes["nomes-longos"]}/impressao`, { waitUntil: "networkidle0" });
  await page.emulateMediaType("print");
  assert.equal(await pageProblem(page), null);
  const overflow = await page.evaluate((max) => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > max + 1) out.push(`${el.tagName}.${el.className}`.slice(0, 80) + ` right=${Math.round(r.right)}`);
    }
    return { scroll: document.documentElement.scrollWidth, out: out.slice(0, 5) };
  }, A4_PX);
  assert.ok(overflow.scroll <= A4_PX + 1, `pagina mais larga que A4: ${overflow.scroll}px`);
  assert.deepEqual(overflow.out, []);
  await page.emulateMediaType(null);
  await page.setViewport({ width: 1366, height: 900 });
});

test("linhas da tabela nao se partem entre paginas", async () => {
  await page.goto(`${BASE}/orcamentos/${quotes.longo}/impressao`, { waitUntil: "networkidle0" });
  await page.emulateMediaType("print");
  const rules = await page.evaluate(() => {
    const tr = document.querySelector(".quote-table tbody tr");
    const s = tr && getComputedStyle(tr);
    return s ? [s.breakInside, s.pageBreakInside] : null;
  });
  await page.emulateMediaType(null);
  assert.ok(rules && rules.some((v) => v === "avoid"), `tr sem break-inside: avoid (${rules})`);
});

test("deslocamento oculto: aparece como Incluso, valor diluido e soma das linhas = subtotal", { timeout: 120000 }, async () => {
  await checkPdf("deslocamento-oculto", { pages: 1 });
  await page.goto(`${BASE}/orcamentos/${quotes["deslocamento-oculto"]}/impressao`, { waitUntil: "networkidle0" });
  const r = await page.evaluate(() => {
    const num = (t) => Number(t.replace(/[^\d,]/g, "").replace(",", "."));
    const rows = [...document.querySelectorAll(".quote-table tbody tr")].map((tr) => ({ text: tr.innerText, total: tr.querySelector(".quote-td-total")?.innerText ?? "" }));
    const fin = Object.fromEntries([...document.querySelectorAll(".quote-fin-row, .quote-fin-total")].map((x) => [x.children[0].innerText.trim(), num(x.children[1].innerText)]));
    return { rows, fin, body: document.body.innerText };
  });
  const travel = r.rows.find((x) => /deslocamento/i.test(x.text));
  assert.ok(travel, "linha do deslocamento sumiu");
  assert.match(travel.total, /Incluso/);
  const sum = r.rows.filter((x) => x !== travel).reduce((t, x) => t + Number(x.total.replace(/[^\d,]/g, "").replace(",", ".")), 0);
  assert.equal(Math.round(sum * 100), Math.round(r.fin.SUBTOTAL * 100), `linhas somam ${sum}, subtotal ${r.fin.SUBTOTAL}`);
  assert.equal(r.fin.SUBTOTAL, 487.5);
  assert.ok(!/(^|[^\d.])87,50/.test(r.body), "valor do deslocamento aparece no documento");
  // 300 + 100 originais; 87,50 rateado 75% / 25%
  assert.deepEqual(r.rows.filter((x) => x !== travel).map((x) => x.total.replace(/\s/g, "")), ["R$365,63", "R$121,87"]);
});

test("ocultar valores unitarios: coluna UNIT. some e o resto continua em A4", { timeout: 120000 }, async () => {
  await checkPdf("sem-unitario", { pages: 1 });
  await page.goto(`${BASE}/orcamentos/${quotes["sem-unitario"]}/impressao`, { waitUntil: "networkidle0" });
  const heads = await page.$$eval(".quote-table thead th", (ths) => ths.map((t) => t.innerText.trim()));
  assert.ok(!heads.includes("UNIT."), `coluna UNIT. apareceu: ${heads}`);
  assert.ok(heads.includes("TOTAL"));
});
