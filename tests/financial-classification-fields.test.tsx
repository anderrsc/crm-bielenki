import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinancialClassificationFields } from "@/components/financial-classification-fields";
import { loadFinancialClassifications } from "@/lib/financial-classification";

test("existing inactive selections stay visible; unrelated types and new inactive choices stay hidden", () => {
  const html = renderToStaticMarkup(<FinancialClassificationFields type="pagar" categoryId="old" centerId="old-center" categories={[
    { id: "old", name: "Old", entry_type: "pagar", active: false },
    { id: "unused", name: "Unused", entry_type: "pagar", active: false },
    { id: "revenue", name: "Revenue", entry_type: "receber", active: true },
  ]} centers={[{ id: "old-center", name: "Old center", active: false }]} />);
  expect(html).toContain('value="old" selected=""');
  expect(html).toContain("Old (inativa)");
  expect(html).toContain("Old center (inativo)");
  expect(html).not.toContain("Unused");
  expect(html).not.toContain("Revenue");
});

test("definition loading pages beyond the API cap and propagates failures", async () => {
  const calls: [string, number][] = [];
  const db: any = { from: (table: string) => {
    const q: any = { select: () => q, order: () => q, range: async (start: number) => { calls.push([table, start]); return { data: start === 0 ? Array.from({ length: 200 }, (_, n) => ({ id: `${table}-${n}` })) : [{ id: "last" }] }; } };
    return q;
  } };
  const loaded = await loadFinancialClassifications(db);
  expect(loaded.categories).toHaveLength(201);
  expect(loaded.centers).toHaveLength(201);
  expect(calls).toContainEqual(["financial_categories", 200]);
  db.from = () => { const q: any = { select: () => q, order: () => q, range: async () => ({ error: { message: "denied" } }) }; return q; };
  await expect(loadFinancialClassifications(db)).rejects.toThrow("Não foi possível");
});
