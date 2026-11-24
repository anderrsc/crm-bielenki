// Bielenki Design System: impede que a interface volte a ter fontes, pesos e capitalização inconsistentes.
// Regras e exceções em DESIGN_SYSTEM.md. Documentos comerciais e de impressão ficam de fora de propósito.
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const DOC_MARKERS = ["print-sheet", "quote-sheet", "measure-sheet", "report-sheet"];
const DOC_FILES = ["components/quote-document.tsx", "components/visit-sheet.tsx", "components/print-sheet.tsx"];

function walk(dir: string, ext: string, out: string[] = []) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, name);
    if (fs.statSync(path.join(root, rel)).isDirectory()) { if (!rel.includes("node_modules") && !rel.startsWith("app/(print)")) walk(rel, ext, out); }
    else if (rel.endsWith(ext)) out.push(rel);
  }
  return out;
}
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const uiFiles = [...walk("app", ".tsx"), ...walk("components", ".tsx")].filter(f => !DOC_FILES.includes(f) && !DOC_MARKERS.some(m => read(f).includes(m)));

const classToken = (name: string) => new RegExp(`(?<![\\w\\-\\[\\]:/.])${name}(?![\\w\\-\\]])`);

describe("tipografia e capitalização na interface (TSX)", () => {
  const forbidden: Array<[string, RegExp]> = [
    ["uppercase", classToken("uppercase")],
    ["capitalize", classToken("capitalize")],
    ["font-bold", classToken("font-bold")],
    ["font-extrabold", classToken("font-extrabold")],
    ["font-black", classToken("font-black")],
    ["tracking largo", /(?<![\w\-\[\]:/.])tracking-(?:wide|wider|widest|\[\.?\d+(?:\.\d+)?em\])(?![\w\-\]])/],
    ["texto menor que 11px", /text-\[(?:[0-9]|10)(?:\.\d+)?px\]/],
  ];
  for (const [label, re] of forbidden) {
    test(`nenhum componente usa ${label}`, () => {
      const hits = uiFiles.filter(f => re.test(read(f)));
      expect(hits, `use os tokens do Design System em vez de ${label}: ${hits.join(", ")}`).toEqual([]);
    });
  }
});

describe("CSS da interface", () => {
  // globals.css mistura folhas de impressão (acima do bloco do WhatsApp) com estilos da interface
  const sources: Array<[string, string]> = ["marquinhos", "mobile", "home", "glass", "typography"].map(n => [`app/${n}.css`, read(`app/${n}.css`)]);
  const globals = read("app/globals.css");
  sources.push(["app/globals.css (interface)", globals.slice(globals.indexOf(".wa-inbox {"))]);

  test("sem font-family fora dos tokens e dos documentos", () => {
    for (const [name, css] of sources) expect(css, name).not.toMatch(/font-family\s*:\s*(?!var\(--font-|inherit)\S/);
  });
  test("pesos só 400, 500, 600 (700 apenas em typography.css)", () => {
    for (const [name, css] of sources) {
      const weights = [...css.matchAll(/font-weight\s*:\s*(\d+)/g)].map(m => Number(m[1]));
      const allowed = name === "app/typography.css" ? [400, 500, 600, 700] : [400, 500, 600];
      expect(weights.filter(w => !allowed.includes(w)), name).toEqual([]);
    }
  });
  test("sem text-transform uppercase/capitalize e sem espaçamento largo entre letras", () => {
    for (const [name, css] of sources) {
      expect(css, name).not.toMatch(/text-transform\s*:\s*(uppercase|capitalize)/);
      expect(css, name).not.toMatch(/letter-spacing\s*:\s*\.?\d+(\.\d+)?(em|px)/);
    }
  });
  test("sem fonte menor que 11px", () => {
    for (const [name, css] of sources) {
      const sizes = [...css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
      expect(sizes.filter(s => s < 11), name).toEqual([]);
    }
  });
  test("a fonte única da interface é a Plus Jakarta Sans", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/localFont/);
    expect(layout).toMatch(/PlusJakartaSans/);
    expect(read("app/brand-tokens.css")).toMatch(/--font-ui:\s*var\(--font-sans\)/);
  });
});

describe("Sentence case no menu", () => {
  const ALLOWED = new Set(["WhatsApp", "LIA", "IA", "Pix", "PDF", "CRM", "ERP", "Jarvis", "Dashboard", "Pipeline"]);
  test("rótulos do menu lateral não usam Title Case", () => {
    const shell = read("components/app-shell.tsx");
    const labels = [...shell.matchAll(/\["([^"]+)",\s*"\//g)].map(m => m[1]);
    expect(labels.length).toBeGreaterThan(20);
    const bad = labels.filter(l => l.split(/\s+/).slice(1).some(w => /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+$/.test(w) && !ALLOWED.has(w)));
    expect(bad).toEqual([]);
  });
});
