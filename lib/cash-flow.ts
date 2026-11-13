// Projecao de caixa: parte do saldo real das contas e soma o que vence no periodo.
// Vendas nao recebidas nunca entram como dinheiro disponivel: so como previsao.
export type CashAccount = { id: string; name: string; active: boolean; opening_balance: number; opening_date: string | null; inflow: number; outflow: number; balance: number };
export type CashOverview = {
  today: string; days: number; accounts: CashAccount[]; unassigned: { inflow: number; outflow: number } | null;
  overdue_receivable: number; overdue_payable: number; undated: number;
  flows: { date: string; receivable: number; payable: number }[];
  forecast_sources?: {recurrences:boolean;payroll:boolean;purchases:boolean;pending_occurrences:number;unposted_purchases:number};
};
export type ScenarioKey = "conservador" | "provavel" | "otimista";
/** Quanto do que esta para entrar cada cenario considera (a vencer, ja vencido). Saidas entram sempre inteiras. */
export const SCENARIOS: Record<ScenarioKey, { label: string; due: number; overdue: number; hint: string }> = {
  conservador: { label: "Conservador", due: 0.8, overdue: 0, hint: "Recebe 80% do que vence e nada do que já está vencido" },
  provavel: { label: "Provável", due: 1, overdue: 0.5, hint: "Recebe tudo que vence e metade do que já está vencido" },
  otimista: { label: "Otimista", due: 1, overdue: 1, hint: "Recebe tudo, inclusive o que já está vencido" },
};
export type ScenarioResult = { key: ScenarioKey; final: number; min: number; minDate: string; negativeOn: string | null };
export type WeekRow = { start: string; end: string; receivable: number; payable: number; balance: number };

const c = (n: number) => Math.round(Number(n || 0) * 100);
const addDays = (iso: string, days: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

export function currentBalance(o: CashOverview): number {
  const accounts = o.accounts.reduce((s, a) => s + c(a.balance), 0);
  return (accounts + c(o.unassigned?.inflow ?? 0) - c(o.unassigned?.outflow ?? 0)) / 100;
}

export function projectScenario(o: CashOverview, key: ScenarioKey): ScenarioResult {
  const f = SCENARIOS[key];
  // Dia zero: saldo de hoje, contas a pagar vencidas (inteiras) e a parte esperada dos recebimentos vencidos.
  let balance = c(currentBalance(o)) - c(o.overdue_payable) + Math.round(c(o.overdue_receivable) * f.overdue);
  let min = balance, minDate = o.today, negativeOn: string | null = balance < 0 ? o.today : null;
  for (const flow of [...o.flows].sort((a, b) => a.date.localeCompare(b.date))) {
    balance += Math.round(c(flow.receivable) * f.due) - c(flow.payable);
    if (balance < min) { min = balance; minDate = flow.date; }
    if (balance < 0 && !negativeOn) negativeOn = flow.date;
  }
  return { key, final: balance / 100, min: min / 100, minDate, negativeOn };
}

/** Semana a semana no cenario escolhido, com o saldo ao fim de cada semana. */
export function weeklyProjection(o: CashOverview, key: ScenarioKey): WeekRow[] {
  const f = SCENARIOS[key];
  let balance = c(currentBalance(o)) - c(o.overdue_payable) + Math.round(c(o.overdue_receivable) * f.overdue);
  const rows: WeekRow[] = [];
  const last = addDays(o.today, o.days);
  for (let start = o.today; start <= last; start = addDays(start, 7)) {
    const end = addDays(start, 6) > last ? last : addDays(start, 6);
    const week = o.flows.filter((x) => x.date >= start && x.date <= end);
    const receivable = week.reduce((s, x) => s + Math.round(c(x.receivable) * f.due), 0);
    const payable = week.reduce((s, x) => s + c(x.payable), 0);
    balance += receivable - payable;
    rows.push({ start, end, receivable: receivable / 100, payable: payable / 100, balance: balance / 100 });
  }
  return rows;
}
