import { expect, test } from "vitest";
import { automaticPaintItems, fabricatedMeterPrice } from "@/lib/gutter-quote-pricing";
import type { GutterPrice } from "@/lib/gutters";

const rates = { matrix: [{ thickness: "0.5mm", cut_mm: 300, price_per_meter: 46 }], paints: [] };
const piece = { product: "Rufo convencional", thickness: "0.50 mm", cut: "300 mm", color: "Pintura Preto" };
const beiral = { product: "Calha de beiral", thickness: "0.5mm", cut_mm: 300, color: "Aluminio Natural", unit_price: 80, active: true } as GutterPrice;

test.each(["Rufo convencional", "Calha Moldura", "Pingadeira Dupla"])("%s uses the same matrix price", product => {
  expect(fabricatedMeterPrice([], rates, { ...piece, product })).toBe(46);
});

test("a configured paint rate is separate from the matrix price", () => {
  expect(fabricatedMeterPrice([], { ...rates, paints: [{ color: "Preto", price_per_meter: 10 }] }, piece)).toBe(46);
});

test("beiral uses its own rate and never falls back to the shared matrix", () => {
  const item = { ...piece, product: beiral.product };
  expect(fabricatedMeterPrice([beiral], rates, item)).toBe(80);
  expect(fabricatedMeterPrice([], rates, item)).toBeUndefined();
});

test("painting groups quantities by color, skips natural and marks missing tariffs", () => {
  const items = [
    { color: "Pintura Preto", quantity: 2, meters: 5 },
    { color: "Preto", quantity: 1, meters: 3 },
    { color: "Alumínio Natural", quantity: 1, meters: 10 },
    { color: "Pintura Branco", quantity: 1, meters: 2 },
  ];
  expect(automaticPaintItems(items, { ...rates, paints: [{ color: "Preto", price_per_meter: 10 }] })).toMatchObject([
    { product: "Mão de obra e materiais necessários para pintura na cor Preto", quantity: 13, unit_price: 10, rateMissing: false },
    { product: "Mão de obra e materiais necessários para pintura na cor Branco", quantity: 2, unit_price: 0, rateMissing: true },
  ]);
  expect(automaticPaintItems(items.slice(2, 3), rates)).toEqual([]);
});
