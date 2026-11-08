import { expect, test } from "vitest";
import { parseBRNumber } from "@/lib/br-number";

test("parseBRNumber entende o formato brasileiro", () => {
  expect(parseBRNumber("1.500,00")).toBe(1500);
  expect(parseBRNumber("1.500")).toBe(1500);
  expect(parseBRNumber("R$ 1500")).toBe(1500);
  expect(parseBRNumber("12,5")).toBe(12.5);
  expect(parseBRNumber("0.5")).toBe(0.5);
  expect(parseBRNumber("12.000.000")).toBe(12000000);
  expect(parseBRNumber("")).toBeNull();
  expect(parseBRNumber("abc")).toBeNull();
});
