import Link from "next/link";
import { getRequestClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";
import { friendlyError } from "@/lib/friendly-error";
import { SubmitButton } from "@/components/submit-button";
import { saveOpeningBalance } from "@/app/(crm)/cash-actions";
import { currentBalance, projectScenario, weeklyProjection, SCENARIOS, type CashOverview, type ScenarioKey } from "@/lib/cash-flow";

const HORIZONS = [7, 15, 30, 60, 90];
const keys = Object.keys(SCENARIOS) as ScenarioKey[];

export default async function CashPage({ searchParams }: { searchParams: Promise<{ dias?: string; cenario?: string; erro?: string; salvo?: string }> }) {
  const search = await searchParams;
  const days = Math.min(366, Math.max(1, Number.parseInt(search.dias ?? "30", 10) || 30));
  const scenario: ScenarioKey = keys.includes(search.cenario as ScenarioKey) ? (search.cenario as ScenarioKey) : "provavel";
  const db = await getRequestClient();
  const [{ data, error }, { data: allowed }] = await Promise.all([
    db.rpc("cash_overview", { p_days: days }),
    db.rpc("has_table_access", { resource: "financial_entries", action: "update" }),
  ]);
  const back = <Link href="/financeiro" className="text-sm font-bold text-forest underline">Voltar ao financeiro</Link>;
  if (error || !data) return <div className="mx-auto max-w-5xl space-y-4">{back}<p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">Não foi possível carregar o caixa. Atualize a página.</p></div>;
  const overview = data as CashOverview;
  const balance = currentBalance(overview);
  const results = keys.map((k) => projectScenario(overview, k));
  const chosen = results.find((r) => r.key === scenario)!;
  const weeks = weeklyProjection(overview, scenario);
  const unassigned = Number(overview.unassigned?.inflow ?? 0) - Number(overview.unassigned?.outflow ?? 0);
  const href = (p: Record<string, string | number>) => `/financeiro/caixa?${new URLSearchParams(Object.entries({ dias: days, cenario: scenario, ...p }).map(([k, v]) => [k, String(v)]))}`;
  const tone = (n: number) => (n < 0 ? "text-red-700" : "text-emerald-700");

  return <div className="mx-auto max-w-6xl space-y-5">
    {back}
    <div>
      <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Controle financeiro</p>
      <h1 className="mt-2 text-3xl font-black">Caixa e projeção</h1>
      <p className="mt-1 text-sm text-ink/60">Saldo real das contas (saldo inicial mais as baixas registradas) e o que vence nos próximos dias. Venda ainda não recebida não conta como dinheiro em caixa.</p>
    </div>
    {search.erro && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{friendlyError(search.erro)?.slice(0, 250)}</p>}
    {search.salvo === "1" && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">Saldo inicial salvo.</p>}
    {chosen.negativeOn && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">Risco de faltar caixa: no cenário {SCENARIOS[scenario].label.toLowerCase()} o saldo fica negativo em {shortDate(chosen.negativeOn)} (menor saldo {money(chosen.min)}).</p>}

    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-bold">Saldo das contas</h2>
        <p className="text-right"><span className="block text-xs font-bold uppercase tracking-wider text-ink/45">Saldo hoje</span><span className={`text-2xl font-black ${tone(balance)}`}>{money(balance)}</span></p>
      </div>
      {!overview.accounts.length && <p className="text-sm text-ink/60">Nenhuma conta cadastrada. Cadastre as contas de recebimento na tela do Financeiro para acompanhar o saldo de cada uma.</p>}
      <div className="space-y-2">
        {overview.accounts.map((a) => <div key={a.id} className="rounded-xl border border-sand p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold">{a.name}{a.active ? "" : " (inativa)"}</p>
            <p className={`text-lg font-black ${tone(Number(a.balance))}`}>{money(a.balance)}</p>
          </div>
          <p className="mt-1 text-xs text-ink/60">Inicial {money(a.opening_balance)}{a.opening_date ? ` em ${shortDate(a.opening_date)}` : ""} · entradas {money(a.inflow)} · saídas {money(a.outflow)}</p>
          {allowed === true && <form action={saveOpeningBalance} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="account_id" value={a.id} />
            <label><span className="label">Saldo inicial</span><input className="field w-36" name="opening_balance" inputMode="decimal" defaultValue={Number(a.opening_balance).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} aria-label={`Saldo inicial de ${a.name}`} /></label>
            <label><span className="label">Contar baixas a partir de</span><input className="field" type="date" name="opening_date" max={overview.today} defaultValue={a.opening_date ?? ""} aria-label={`Data inicial de ${a.name}`} /></label>
            <SubmitButton className="button-ghost">Salvar saldo inicial</SubmitButton>
          </form>}
        </div>)}
        {unassigned !== 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>{money(unassigned)}</strong> em baixas sem conta informada (entradas {money(overview.unassigned?.inflow ?? 0)}, saídas {money(overview.unassigned?.outflow ?? 0)}). Entram no saldo de hoje, mas não em nenhuma conta. Informe a conta ao dar baixa para o saldo por conta ficar correto.
        </div>}
      </div>
    </section>

    <section className="card space-y-4 p-5">
      <h2 className="text-xl font-bold">Projeção</h2>
      <div className="flex flex-wrap items-end gap-2 text-sm">
        {HORIZONS.map((d) => <Link key={d} href={href({ dias: d })} className={d === days ? "button" : "button-ghost"}>{d} dias</Link>)}
        <form method="get" className="flex items-end gap-2"><input type="hidden" name="cenario" value={scenario} /><label><span className="label">Outro período (dias)</span><input className="field w-28" type="number" name="dias" min={1} max={366} defaultValue={days} /></label><button className="button-ghost">Aplicar</button></form>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {results.map((r) => <Link key={r.key} href={href({ cenario: r.key })} className={`card block p-4 ${r.key === scenario ? "border-forest ring-1 ring-forest" : ""}`}>
          <p className="text-xs font-bold uppercase tracking-wider text-ink/45">{SCENARIOS[r.key].label}</p>
          <p className={`mt-1 text-2xl font-black ${tone(r.final)}`}>{money(r.final)}</p>
          <p className="text-xs text-ink/60">Saldo em {days} dias · menor saldo {money(r.min)} em {shortDate(r.minDate)}</p>
          <p className="mt-2 text-xs text-ink/55">{SCENARIOS[r.key].hint}</p>
        </Link>)}
      </div>
      <p className="text-sm text-ink/65">Vencido a receber: <strong>{money(overview.overdue_receivable)}</strong> · vencido a pagar: <strong>{money(overview.overdue_payable)}</strong> (considerado pago hoje em todos os cenários){Number(overview.undated) > 0 ? ` · sem vencimento: ${money(overview.undated)} (fora da projeção)` : ""}.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
        <caption className="sr-only">Projeção semanal no cenário {SCENARIOS[scenario].label}</caption>
        <thead><tr className="border-b text-left text-xs font-bold uppercase tracking-wider text-ink/45"><th className="px-3 py-2">Semana</th><th className="px-3 py-2 text-right">A receber</th><th className="px-3 py-2 text-right">A pagar</th><th className="px-3 py-2 text-right">Saldo ao fim</th></tr></thead>
        <tbody className="divide-y">{weeks.map((w) => <tr key={w.start}>
          <td className="px-3 py-2">{shortDate(w.start)} a {shortDate(w.end)}</td>
          <td className="px-3 py-2 text-right">{w.receivable ? money(w.receivable) : "—"}</td>
          <td className="px-3 py-2 text-right">{w.payable ? money(w.payable) : "—"}</td>
          <td className={`px-3 py-2 text-right font-bold ${tone(w.balance)}`}>{money(w.balance)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="text-xs text-ink/55">A projeção usa contas em aberto e parcelas, programações recorrentes ainda não lançadas e compras confirmadas sem conta financeira. Gerar uma competência substitui sua previsão pela conta, sem duplicar valores. Folha agregada depende da permissão específica.</p>
      {overview.forecast_sources&&<p className="text-xs text-ink/60">Previsões ainda sem conta: {overview.forecast_sources.pending_occurrences} competência(s) recorrente(s) e {overview.forecast_sources.unposted_purchases} compra(s). Valores sem vencimento ficam fora dos cenários.</p>}
      {overview.forecast_sources&&(!overview.forecast_sources.recurrences||!overview.forecast_sources.payroll||!overview.forecast_sources.purchases)&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Projeção parcial conforme suas permissões: podem faltar previsões de recorrências, folha ou compras. Consulte um responsável com acesso a essas fontes.</p>}
    </section>
  </div>;
}
