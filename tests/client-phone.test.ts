import { expect, test } from "vitest";
import { correctClientPhone } from "@/lib/client-phone";

test.each([
  ["41 8818-0487", "(41) 98818-0487"],
  ["+55 (47) 8818-0487", "+55 (47) 98818-0487"],
  ["(41) 98818-0487", "(41) 98818-0487"],
  ["(47) 3371-1234", "(47) 3371-1234"],
  ["+1 305 881 8048", "+1 305 881 8048"],
  ["8818-0487", "8818-0487"],
  ["0800 881 8048", "0800 881 8048"],
])("normalizes %s to %s", (value, expected) => {
  expect(correctClientPhone(value)).toBe(expected);
});
