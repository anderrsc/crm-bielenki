import { expect, test } from "vitest";
import { fabricatedMeterPrice } from "@/lib/gutter-quote-pricing";
import type { GutterPrice } from "@/lib/gutters";

const rates = { matrix: [{ thickness: "0.5mm", cut_mm: 300, price_per_meter: 46 }], paints: [] };
const piece = { product: "Rufo convencional", thickness: "0.50 mm", cut: "300 mm", color: "Pintura Preto" };
const beiral = { product: "Calha de beiral", thickness: "0.5mm", cut_mm: 300, color: "Aluminio Natural", unit_price: 80, active: true } as GutterPrice;

test.each(["Rufo convencional", "Calha Moldura", "Pingadeira Dupla"])("%s uses the same matrix price", product => {
  expect(fabricatedMeterPrice([], rates, { ...piece, product })).toBe(46);
});

test("a configured paint rate is added to the matrix price", () => {
  expect(fabricatedMeterPrice([], { ...rates, paints: [{ color: "Preto", price_per_meter: 10 }] }, piece)).toBe(56);
});

test("beiral uses its own rate and never falls back to the shared matrix", () => {
  const item = { ...piece, product: beiral.product };
  expect(fabricatedMeterPrice([beiral], rates, item)).toBe(80);
  expect(fabricatedMeterPrice([], rates, item)).toBeUndefined();
});
