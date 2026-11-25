import { beforeEach, expect, test, vi } from "vitest";

// Compras (25/11): código do produto em cada item e o arquivo lido pela IA ficam na compra.
type Row = Record<string, any>;
const fx = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));
function database() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
    rpc: async (fn: string) => {
      if (fn !== "create_manual_purchase") return { data: null, error: null };
      fx.tables.purchase_order_items = [
        { id: "i1", purchase_order_id: "po1", description: "MARCO SUPERIOR 2 TRILHOS SUPREMA PRETO", material_id: "m1", code: null },
        { id: "i2", purchase_order_id: "po1", description: "Parafuso", material_id: "m2", code: null },
      ];
      return { data: "po1", error: null };
    },
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = []; let update: Row | null = null;
      const run = () => { const rows = (fx.tables[table] ?? []).filter((r) => filters.every((f) => f(r))); if (update) rows.forEach((r) => Object.assign(r, update)); return { data: rows, error: null }; };
      const q: any = {
        select: () => q, order: () => q,
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
        is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
        update: (v: Row) => { update = v; return q; },
        single: async () => ({ data: run().data[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
      };
      return q;
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => database(), getAuthUser: async () => ({ id: "user" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
import { createManualPurchase } from "@/app/(crm)/actions";

beforeEach(() => {
  fx.tables = {
    profiles: [{ id: "user", company_id: "c1" }],
    purchase_orders: [{ id: "po1", company_id: "c1", attachment_path: null }],
    materials: [{ id: "m1", sku: null }, { id: "m2", sku: "JA-TEM" }],
  };
});

const form = (payload: unknown) => { const f = new FormData(); f.set("payload", JSON.stringify(payload)); return f; };

test("salva o código em cada item, preenche o código do material e anexa o arquivo da nota", async () => {
  await expect(createManualPurchase(form({ supplier_id: "s", items: [
    { category: "Perfil", description: "MARCO SUPERIOR 2 TRILHOS SUPREMA PRETO", quantity: 1, unit_price: 174.19, code: "PSU001-PT" },
    { category: "Acessório", description: "Parafuso", quantity: 10, unit_price: 0.5, code: "PAR-01" },
  ], attachment: { path: "c1/abc-orcamento.pdf", name: "orcamento.pdf", type: "application/pdf" } }))).rejects.toThrow("REDIRECT:/compras/po1");
  expect(fx.tables.purchase_order_items.map((i) => i.code)).toEqual(["PSU001-PT", "PAR-01"]);
  expect(fx.tables.materials.map((m) => m.sku)).toEqual(["PSU001-PT", "JA-TEM"]); // não troca código já existente
  expect(fx.tables.purchase_orders[0]).toMatchObject({ attachment_path: "c1/abc-orcamento.pdf", attachment_name: "orcamento.pdf" });
});

test("arquivo de outra empresa não é aceito", async () => {
  await expect(createManualPurchase(form({ supplier_id: "s", items: [], attachment: { path: "outra/x.pdf", name: "x.pdf", type: "application/pdf" } }))).rejects.toThrow("REDIRECT:/compras/po1");
  expect(fx.tables.purchase_orders[0].attachment_path).toBeNull();
});
