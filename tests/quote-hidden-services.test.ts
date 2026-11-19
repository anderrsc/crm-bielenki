import { expect, test } from "vitest";
import { diluteTravel } from "@/lib/quote-travel-dilution";

test("valores ocultos de serviços são diluídos e o total do documento não muda", () => {
  const lines = [
    { total: 1000, base: 10, travel: false },
    { total: 500, base: 5, travel: false },
    { total: 150, base: 1, travel: true },   // deslocamento
    { total: 350, base: 1, travel: true },   // mão de obra
  ];
  const out = diluteTravel(lines)!;
  const soma = out.reduce((t, l) => t + l.total, 0);
  expect(Math.round(soma * 100)).toBe(200000);
  expect(out[2].total).toBe(0);
  expect(out[3].total).toBe(0);
  expect(out[0].total).toBeGreaterThan(1000);
});
