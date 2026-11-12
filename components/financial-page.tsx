import { getRequestClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Plus } from "lucide-react";
import Link from "next/link";
import { PaymentDialog } from "@/components/payment-dialog";
import { RescheduleDialog } from "@/components/reschedule-dialog";
import { ReceivingAccountsManager } from "@/components/receiving-accounts-manager";

type Entry = {
  id: string;
  description: string;
  entry_type: string;
  total_amount: number;
  paid_amount: number;
  interest_amount: number;
  discount_amount: number;
  installment_count: number;
  first_installment_due_date: string | null;
  open_amount: number;
  due_date: string | null;
  display_status: string;
  client_name: string | null;
  supplier_name: string | null;
  category_name: string | null;
  cost_center_name: string | null;
};

const STATUS: Record<string, { label: string; color: string; Icon: typeof Clock }> = {
  pago:                { label: "Pago",       color: "text-emerald-700 bg-emerald-50 border-emerald-200", Icon: CheckCircle2 },
  parcialmente_pago:   { label: "Parcial",    color: "text-blue-700 bg-blue-50 border-blue-200",         Icon: Clock },
  aguardando_pagamento:{ label: "Aguardando", color: "text-ink/60 bg-cream border-sand",                 Icon: Clock },
  vence_hoje:          { label: "Vence hoje", color: "text-amber-700 bg-amber-50 border-amber-200",      Icon: AlertTriangle },
  vencido:             { label: "Vencido",    color: "text-red-700 bg-red-50 border-red-200",            Icon: AlertCircle },
  cancelado:           { label: "Cancelado",  color: "text-ink/40 bg-cream border-sand",                 Icon: Clock },
};

const TABS = [
  { href: "/financeiro",         label: "Todos",      key: "" },
  { href: "/financeiro/receber", label: "A Receber",  key: "receber" },
  { href: "/financeiro/pagar",   label: "A Pagar",    key: "pagar" },
];

const PAGE_SIZE = 60;

export type FinancialFilters = { q?: string; de?: string; ate?: string; situacao?: string; servico?: string };
const SITUACOES: Record<string, string> = { aberto: "Em aberto", vencido: "Vencidos", hoje: "Vencem hoje", pago: "Quitados" };

export async function FinancialPage({ filter, error, received, created, notice, page = 1, filters = {} }: { filter?: string; error?: string; received?: boolean; created?: boolean; notice?: string; page?: number; filters?: FinancialFilters }) {
  const db = await getRequestClient();
  page = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  const term = (filters.q ?? "").trim().slice(0, 80);
  const safeTerm = term.replace(/[,.():*%"\\]/g, " ").trim();
  const situacao = filters.situacao && SITUACOES[filters.situacao] ? filters.situacao : undefined;
  const servico = filters.servico && /^[0-9a-f-]{36}$/i.test(filters.servico) ? filters.servico : undefined;
  let q = db.from("v_financial_entries").select("*").order("due_date", { ascending: true }).order("id", { ascending: true }).range(from, to);
  if (filter) q = q.eq("entry_type", filter);
  if (safeTerm) q = q.or(`description.ilike.*${safeTerm}*,client_name.ilike.*${safeTerm}*,supplier_name.ilike.*${safeTerm}*`);
  if (isDate(filters.de)) q = q.gte("due_date", filters.de!);
  if (isDate(filters.ate)) q = q.lte("due_date", filters.ate!);
  if (servico) q = q.eq("sale_type_id", servico);
  if (situacao === "aberto") q = q.gt("open_amount", 0).neq("display_status", "cancelado");
  if (situacao === "vencido") q = q.eq("display_status", "vencido");
  if (situacao === "hoje") q = q.eq("display_status", "vence_hoje");
  if (situacao === "pago") q = q.eq("display_status", "pago");
  const [{ data, error: entriesError }, { data: canCreate }, { data: totalsData, error: totalsError }, { data: saleTypes, error: saleTypesError }, { data: canClassify }] = await Promise.all([
    q,
    db.rpc("has_table_access", { resource: "financial_entries", action: "insert" }),
    // Totais de todos os lancamentos do filtro (antes somava so a pagina).
    db.rpc("financial_control_totals", { p_type: filter ?? null, p_q: safeTerm || null, p_from: isDate(filters.de) ? filters.de : null, p_to: isDate(filters.ate) ? filters.ate : null, p_status: situacao ?? null, p_sale_type: servico ?? null }),
    db.from("sale_types").select("id,name").eq("active", true).order("name"),
    db.rpc("has_table_access", { resource: "financial_entries", action: "update" }),
  ]);
  const entries = (data ?? []) as Entry[];
  const hasNext = entries.length === PAGE_SIZE;
  const t = !totalsError && totalsData ? totalsData as {
    pending_total: number; pending_count: number; overdue_total: number; overdue_count: number;
    today_count: number; done_count: number; receivable_total: number; payable_total: number;
    undated_count: number; projection: { days: number; receivable: number; payable: number }[];
  } : null;
  const overdueCount = t?.overdue_count ?? 0;
  const todayCount = t?.today_count ?? 0;
  const totalPending = t?.pending_total ?? 0;
  const pendingCount = t?.pending_count ?? 0;
  const totalOverdue = t?.overdue_total ?? 0;
  const doneCount = t?.done_count ?? 0;
  const base = filter ? `/financeiro/${filter}` : "/financeiro";
  const keep = new URLSearchParams(Object.entries({ q: term, de: isDate(filters.de) ? filters.de! : "", ate: isDate(filters.ate) ? filters.ate! : "", situacao: situacao ?? "", servico: servico ?? "" }).filter(([, v]) => v));
  const pageHref = (n: number) => { const p = new URLSearchParams(keep); p.set("pagina", String(n)); return `${base}?${p}`; };
  const hasFilters = keep.toString().length > 0;

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Controle financeiro</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">
            {filter === "receber" ? "Contas a Receber" : filter === "pagar" ? "Contas a Pagar" : "Financeiro"}
          </h1>
        </div>
        <nav className="flex gap-2">
          {TABS.map(t => (
            <Link key={t.key} href={t.href}
              className={`rounded-xl px-4 py-2 text-sm font-semibold border transition ${(filter ?? "") === t.key ? "bg-brand-strong text-white border-forest" : "bg-surface border-sand hover:bg-cream"}`}>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {canCreate === true && (
        <div className="mb-5 flex flex-wrap gap-2">
          {(!filter || filter === "pagar") && <Link className="button" href="/financeiro/pagar/novo"><Plus className="h-4 w-4" /> Nova conta a pagar</Link>}
          {(!filter || filter === "receber") && <Link className="button" href="/financeiro/receber/novo"><Plus className="h-4 w-4" /> Nova conta a receber</Link>}
        </div>
      )}
      {filter !== "pagar" && <ReceivingAccountsManager />}
      <Link href="/financeiro/classificacoes" className="mb-5 inline-block text-sm font-bold text-forest underline">Categorias e centros de custos</Link>
      <Link href="/financeiro/rateios" className="mb-5 ml-4 inline-block text-sm font-bold text-forest underline">Rateios e resultado por obra</Link>
      {created && <div role="status" className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">Conta cadastrada com sucesso.</div>}
      {(received || notice) && <div className="mb-4 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800 font-medium">{notice ? `${notice.slice(0, 80)}.` : "Pagamento registrado com sucesso."}</div>}
      {error && <div className="mb-4 rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>}

      {(entriesError || !t || saleTypesError) && <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {entriesError && <p>Não foi possível carregar os lançamentos. Atualize a página para tentar novamente.</p>}
        {!t && <p>Totais indisponíveis. Nenhum valor parcial será apresentado como total.</p>}
        {saleTypesError && <p>Não foi possível carregar os serviços do filtro.</p>}
      </div>}
      <form method="get" action={base} className="mb-5 grid gap-2 rounded-2xl border border-sand bg-surface p-3 text-sm sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
        <div><label className="label">Buscar</label><input className="field" name="q" defaultValue={term} placeholder="Cliente, fornecedor ou descrição" /></div>
        <div><label className="label">Vencimento de</label><input className="field" type="date" name="de" defaultValue={isDate(filters.de) ? filters.de : ""} /></div>
        <div><label className="label">até</label><input className="field" type="date" name="ate" defaultValue={isDate(filters.ate) ? filters.ate : ""} /></div>
        <div><label className="label">Situação</label><select className="field" name="situacao" defaultValue={situacao ?? ""}><option value="">Todas</option>{Object.entries(SITUACOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">Serviço</label><select className="field" name="servico" defaultValue={servico ?? ""}><option value="">Todos</option>{(saleTypes ?? []).map((x: { id: string; name: string }) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div className="flex items-end gap-2"><button className="button">Filtrar</button>{hasFilters && <Link href={base} className="pb-2 font-bold text-ink/55 underline">Limpar</Link>}</div>
      </form>

      {(overdueCount > 0 || todayCount > 0) && (
        <div className="mb-5 flex flex-wrap gap-3">
          {overdueCount > 0 && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700"><AlertCircle className="h-4 w-4" />{overdueCount} vencido(s) &middot; {money(totalOverdue)} em aberto</div>}
          {todayCount > 0 && <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700"><AlertTriangle className="h-4 w-4" />{todayCount} vence(m) hoje</div>}
        </div>
      )}

      {t && <div className="mobile-financial-summary mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Em aberto</p><p className="mt-2 text-2xl font-black">{money(totalPending)}</p><p className="text-xs text-ink/45">{pendingCount} lançamento(s)</p></div>
        <div className="card border-red-200 p-5"><p className="text-xs font-bold uppercase tracking-wider text-red-600">Vencidos</p><p className="mt-2 text-2xl font-black text-red-700">{money(totalOverdue)}</p><p className="text-xs text-red-500">{overdueCount} lançamento(s)</p></div>
        <div className="card border-emerald-200 p-5"><p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Quitados</p><p className="mt-2 text-2xl font-black text-emerald-700">{doneCount}</p><p className="text-xs text-emerald-500">lançamentos concluídos</p></div>
      </div>}
      {t && <details className="card mb-6 p-4">
        <summary className="cursor-pointer font-bold">Previsão de recebimentos e pagamentos</summary>
        <p className="mt-3 text-sm text-ink/60">Lançamentos em aberto dos filtros atuais. Prazos acumulados de hoje até a data indicada; vencidos e contas sem vencimento ficam fora da projeção.</p>
        <div className="my-3 flex flex-wrap gap-4 text-sm"><span>A receber: <strong>{money(t.receivable_total)}</strong></span><span>A pagar: <strong>{money(t.payable_total)}</strong></span></div>
        {t.undated_count > 0 && <p className="mb-3 text-sm text-amber-800">{t.undated_count} lançamento(s) em aberto sem vencimento precisam de uma data.</p>}
        <div className="overflow-x-auto"><table className="w-full min-w-[380px] text-sm"><caption className="sr-only">Projeção financeira acumulada por prazo</caption><thead><tr className="text-left"><th className="py-2">Prazo</th><th className="text-right">A receber</th><th className="text-right">A pagar</th><th className="text-right">Variação prevista</th></tr></thead><tbody>{t.projection.map(h => <tr key={h.days} className="border-t border-sand"><th className="py-3 text-left font-medium">{h.days} dias</th><td className="text-right">{money(h.receivable)}</td><td className="text-right">{money(h.payable)}</td><td className="text-right font-bold">{money(h.receivable - h.payable)}</td></tr>)}</tbody></table></div>
        <p className="mt-3 text-xs text-ink/60">A variação prevista depende da liquidação das contas. O saldo bancário inicial e os custos não registrados não estão incluídos.</p>
      </details>}

      {(page > 1 || hasNext) && (
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm text-ink/50">Página {page}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="flex items-center gap-1 rounded-xl border border-sand bg-surface px-3 py-2 text-sm font-semibold hover:bg-cream">
                <ChevronLeft className="h-4 w-4" /> Anterior
              </Link>
            )}
            {hasNext && (
              <Link href={pageHref(page + 1)} className="flex items-center gap-1 rounded-xl border border-sand bg-surface px-3 py-2 text-sm font-semibold hover:bg-cream">
                Próxima <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="mobile-record-table w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b bg-cream text-left text-xs font-bold uppercase tracking-wider text-ink/40">
              <th className="px-4 py-3">Descrição</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Parte</th>
              <th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Em aberto</th>
              <th className="px-4 py-3">Vencimento</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {!entriesError && entries.length === 0 && <tr><td colSpan={8} className="p-10 text-center text-ink/40">Nenhum lançamento encontrado.</td></tr>}
            {entries.map(e => {
              const s = STATUS[e.display_status] ?? STATUS["aguardando_pagamento"];
              const { Icon } = s;
              const isOverdue = e.display_status === "vencido";
              return (
                <tr key={e.id} className={`hover:bg-cream/50 transition ${isOverdue ? "bg-red-50/30" : ""}`}>
                  <td data-label="Descrição" className="px-4 py-3 font-medium max-w-[200px]"><p className="truncate">{e.description}</p><p className="mt-1 text-xs font-normal text-ink/60">{e.category_name || "Sem categoria"} · {e.cost_center_name || "Sem centro de custos"}</p></td>
                  <td data-label="Tipo" className="px-4 py-3"><span className={`rounded-lg px-2 py-0.5 text-xs font-bold border ${e.entry_type === "receber" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-orange-700 bg-orange-50 border-orange-200"}`}>{e.entry_type === "receber" ? "Receber" : "Pagar"}</span></td>
                  <td data-label="Cliente / fornecedor" className="px-4 py-3 text-ink/60">{e.client_name || e.supplier_name || "—"}</td>
                  <td data-label="Total" className="px-4 py-3 text-right font-semibold">{money(e.total_amount)}</td>
                  <td data-label="Em aberto" className={`px-4 py-3 text-right font-bold ${e.open_amount > 0 ? (isOverdue ? "text-red-700" : "text-ink") : "text-emerald-600"}`}>{money(e.open_amount)}</td>
                  <td data-label="Vencimento" className={`px-4 py-3 text-sm ${isOverdue ? "text-red-600 font-bold" : "text-ink/60"}`}>{e.due_date ? shortDate(e.due_date) : "—"}</td>
                  <td data-label="Status" className="px-4 py-3"><span className={`flex w-fit items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-bold ${s.color}`}><Icon className="h-3 w-3" />{s.label}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {canClassify === true && <Link className="rounded-lg border border-sand px-2 py-1 text-xs font-bold" href={`/financeiro/classificacoes?lancamento=${e.id}`}>Classificar</Link>}
                      {canClassify === true && e.display_status !== "cancelado" && <Link className="rounded-lg border border-sand px-2 py-1 text-xs font-bold" href={`/financeiro/rateios?conta=${e.id}`}>Ratear</Link>}
                      {e.open_amount > 0 && e.display_status !== "cancelado" && <PaymentDialog entryId={e.id} openAmount={e.open_amount} interestAmount={e.interest_amount} discountAmount={e.discount_amount} installmentCount={e.installment_count} firstDueDate={e.first_installment_due_date} />}
                      {e.open_amount > 0 && e.display_status !== "cancelado" && <RescheduleDialog entryId={e.id} currentDueDate={e.due_date} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
