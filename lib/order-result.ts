// Situacao de uma obra a partir do previsto, comprometido e realizado.
export type OrderResult = {
  order_id: string; order_number: string; sale_id: string | null; client_name: string | null; operational_status: string;
  revenue: number; received: number; expected_cost: number | null; cost_committed: number; cost_realized: number; cost_paid: number;
  margin_expected: number | null; margin_current: number;
};

export function orderResultStatus(r: Pick<OrderResult, "revenue" | "expected_cost" | "cost_committed" | "cost_realized" | "margin_current">) {
  const cents = (n: number | null) => Math.round(Number(n ?? 0) * 100);
  const used = cents(r.cost_realized) + cents(r.cost_committed);
  const noForecast = r.expected_cost === null;
  const expected = cents(r.expected_cost);
  const over = !noForecast && used > expected;
  const usedPct = noForecast ? null : expected === 0 ? (used > 0 ? 100 : 0) : Math.round((used / expected) * 100);
  const revenue = cents(r.revenue);
  const marginPct = revenue ? Math.round((cents(r.margin_current) / revenue) * 1000) / 10 : null;
  const label = noForecast ? "Sem custo previsto" : over ? `Acima do previsto em ${((used - expected) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : "Dentro do previsto";
  return { over, noForecast, usedPct, marginPct, label };
}
