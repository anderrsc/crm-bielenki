import { beforeEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ fail: false, calls: [] as unknown[][], entries: [] as Record<string, unknown>[], payments: [] as unknown[] }));
vi.mock("@/components/receiving-accounts-manager", () => ({ ReceivingAccountsManager: () => null }));
vi.mock("@/components/payment-dialog", () => ({ PaymentDialog: (props: unknown) => { state.payments.push(props); return null; } }));
vi.mock("@/components/reschedule-dialog", () => ({ RescheduleDialog: () => null }));
vi.mock("@/lib/supabase/server", () => ({ getRequestClient: async () => ({
  from: (table: string) => {
    const q: any = {};
    for (const method of ["select", "order", "range", "eq", "or", "gte", "lte", "gt", "neq"]) q[method] = (...args: unknown[]) => { state.calls.push([table, method, ...args]); return q; };
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === "v_financial_entries" ? state.entries : [], error: state.fail ? { message: "denied" } : null }).then(resolve);
    return q;
  },
  rpc: async (name: string, args: unknown) => {
    state.calls.push([name, args]);
    if (name === "has_table_access") return { data: false };
    return state.fail ? { data: null, error: { message: "unavailable" } } : { data: { pending_total: 12345, pending_count: 100, overdue_total: 0, overdue_count: 0, today_count: 0, done_count: 2, receivable_total: 12345, payable_total: 0, undated_count: 1, projection: [{ days: 7, receivable: 12345, payable: 0 }] } };
  },
}) }));
import { FinancialPage } from "@/components/financial-page";
beforeEach(() => { state.fail = false; state.calls = []; state.entries = []; state.payments = []; });

test("query failures show alerts without presenting empty rows or partial totals as truth", async () => {
  state.fail = true;
  const html = renderToStaticMarkup(await FinancialPage({}));
  expect(html).toContain('role="alert"');
  expect(html).toContain("Totais indisponíveis");
  expect(html).not.toContain("Nenhum lançamento encontrado");
  expect(html).not.toContain("mobile-financial-summary");
  expect(html).not.toContain("Previsão de recebimentos");
});

test("paid filter excludes cancellation, invalid dates are ignored and pagination is stable", async () => {
  const html = renderToStaticMarkup(await FinancialPage({ page: -3, filters: { situacao: "pago", de: "2026-02-30", q: 'A,B"(C)' } }));
  expect(state.calls).toContainEqual(["v_financial_entries", "eq", "display_status", "pago"]);
  expect(state.calls).toContainEqual(["v_financial_entries", "range", 0, 59]);
  expect(state.calls).toContainEqual(["v_financial_entries", "order", "id", { ascending: true }]);
  const rpc = state.calls.find(x => x[0] === "financial_control_totals");
  expect(rpc?.[1]).toMatchObject({ p_from: null, p_status: "pago", p_q: "A B  C" });
  expect(html).toContain("100 lançamento(s)");
  expect(html).toContain("Previsão de recebimentos");
  expect(html).toContain("sem vencimento");
});

test("subsequent payment preserves the existing adjustments and installment schedule", async () => {
  state.entries = [{ id: "entry", description: "Parcelado", entry_type: "receber", total_amount: 110, paid_amount: 10, open_amount: 100, display_status: "parcialmente_pago", due_date: "2026-11-15", interest_amount: 12, discount_amount: 2, installment_count: 3, first_installment_due_date: "2026-11-15" }];
  renderToStaticMarkup(await FinancialPage({}));
  expect(state.payments[0]).toMatchObject({ entryId: "entry", openAmount: 100, interestAmount: 12, discountAmount: 2, installmentCount: 3, firstDueDate: "2026-11-15" });
});
