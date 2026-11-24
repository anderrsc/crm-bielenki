// Contraste mínimo WCAG AA (4.5:1 para texto comum) nos pares de cores do Design System (tema claro).
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(__dirname, "../app/brand-tokens.css"), "utf8");
const vars = new Map<string, string>();
for (const m of css.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars.set(m[1], m[2].trim()); // última definição vence: o tema claro vem depois
function resolve(name: string, depth = 0): string {
  const value = vars.get(name);
  if (!value || depth > 8) throw new Error(`token --${name} não encontrado`);
  const ref = value.match(/^var\(--([\w-]+)\)$/);
  return ref ? resolve(ref[1], depth + 1) : value;
}
const hex = (token: string) => {
  if (token === "brand-text") { // definido como rgb(var(--brand-text-rgb)); o tema claro vem por último
    const [r, g, b] = resolve("brand-text-rgb").split(/\s+/).map(Number);
    return "#" + [r, g, b].map(n => n.toString(16).padStart(2, "0")).join("");
  }
  const v = resolve(token); if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`--${token} não é hexadecimal: ${v}`); return v; };
function lum(h: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("contraste WCAG AA", () => {
  const pairs: Array<[string, string, string]> = [
    ["texto sobre superfície", "text", "surface"],
    ["texto sobre fundo", "text", "bg"],
    ["texto secundário sobre superfície", "text-muted", "surface"],
    ["texto secundário sobre fundo", "text-muted", "bg"],
    ["texto sobre botão de marca", "on-brand", "brand-strong"],
    ["texto de marca sobre superfície", "brand-text", "surface"],
    ["sucesso", "success-text", "success-soft"],
    ["atenção", "warning-text", "warning-soft"],
    ["informação", "info-text", "info-soft"],
    ["erro", "danger-text", "danger-soft"],
  ];
  for (const [label, fg, bg] of pairs) test(label, () => expect(ratio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5));

  test("pares fixos do vidro, do WhatsApp e do botão em degradê", () => {
    expect(ratio("#101828", "#FFFFFF")).toBeGreaterThanOrEqual(7);   // texto forte sobre vidro claro
    expect(ratio("#475467", "#EEEEF2")).toBeGreaterThanOrEqual(4.5); // texto de apoio sobre o fundo mais escuro do vidro
    expect(ratio("#008069", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);  // verde do WhatsApp (texto e botões)
    expect(ratio("#E31616", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);  // início do degradê dos botões vermelhos
  });
});
