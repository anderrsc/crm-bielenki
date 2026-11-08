import { expect, test } from "vitest";
import { diluteTravel } from "@/lib/quote-travel-dilution";

test("deslocamento oculto é diluído nos itens e a soma bate com o subtotal", () => {
  const lines = [
    { total: 300, base: 10, travel: false },
    { total: 100, base: 2, travel: false },
    { total: 50, base: 1, travel: true },
  ];
  const r = diluteTravel(lines)!;
  expect(r[0].total).toBe(337.5);
  expect(r[1].total).toBe(112.5);
  expect(r[2].total).toBe(0);
  expect(r[0].unitPrice).toBe(33.75);
  expect(r[1].unitPrice).toBe(56.25);
  expect(r.reduce((t, l) => t + l.total, 0)).toBe(450);
});

test("arredondamento fecha no centavo", () => {
  const r = diluteTravel([
    { total: 10, base: 1, travel: false },
    { total: 10, base: 1, travel: false },
    { total: 10, base: 1, travel: false },
    { total: 0.1, base: 1, travel: true },
  ])!;
  expect(Math.round(r.reduce((t, l) => t + l.total, 0) * 100)).toBe(3010);
});

test("sem deslocamento ou sem outros itens não mexe em nada", () => {
  expect(diluteTravel([{ total: 100, base: 1, travel: false }])).toBeNull();
  expect(diluteTravel([{ total: 80, base: 1, travel: true }])).toBeNull();
});
