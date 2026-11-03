// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PricingSpreadsheet, type PriceRow } from "@/components/pricing-spreadsheet";

vi.mock("@/app/(crm)/pricing-actions", () => ({ bulkSavePrices: vi.fn() }));
afterEach(cleanup);

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
