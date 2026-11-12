// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PricingSpreadsheet, type PriceRow } from "@/components/pricing-spreadsheet";
import { bulkSavePrices } from "@/app/(crm)/pricing-actions";

vi.mock("@/app/(crm)/pricing-actions", () => ({ bulkSavePrices: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

test("limits rendered price rows and searches across all pages", () => {
  const rows: PriceRow[] = Array.from({ length: 105 }, (_, i) => ({
    id: String(i + 1),
    product: `Peça ${i + 1}`,
    category: "Acessórios",
    thickness: null,
    cut_mm: null,
    unit: "Unidade",
    color: null,
    unit_price: 5,
    labor_price: 0,
    paint_price: 0,
    install_price: 0,
    freight_price: 0,
    min_price: 0,
    margin_pct: 0,
    max_discount_pct: 0,
    notes: null,
    active: true,
  }));
  render(<PricingSpreadsheet initialRows={rows} canManage={false} />);
  expect(screen.getAllByRole("row")).toHaveLength(51);
  expect(screen.queryByText("Peça 51")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
  expect(screen.getByText("Peça 51")).toBeTruthy();
  expect(screen.queryByText("Peça 1")).toBeNull();
  fireEvent.change(screen.getByPlaceholderText("Buscar produto..."), { target: { value: "Peça 105" } });
  expect(screen.getByText("Peça 105")).toBeTruthy();
  expect(screen.getAllByRole("row")).toHaveLength(2);
});

test("celular mostra cartões com campos rotulados e salva o preço editado", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.mocked(bulkSavePrices).mockResolvedValue({ ok: true } as never);
  const row: PriceRow = { id: "price-1", product: "Peça", category: "Acessórios", thickness: null, cut_mm: null, unit: "Unidade", color: null, unit_price: 5, labor_price: 0, paint_price: 0, install_price: 0, freight_price: 0, min_price: 0, margin_pct: 0, max_discount_pct: 0, notes: null, active: true };
  render(<PricingSpreadsheet initialRows={[row]} canManage />);
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByRole("article")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "12.5" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar (1)" })); });
  expect(bulkSavePrices).toHaveBeenCalledWith([expect.objectContaining({ id: "price-1", unit_price: 12.5 })], []);
});
