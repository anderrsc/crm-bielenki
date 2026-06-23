import { createClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";
import { PaymentDialog } from "@/components/payment-dialog";

type Entry = {
  id: string;
  description: string;
  entry_type: string;
  total_amount: number;
  paid_amount: number;
  open_amount: number;
  due_date: string | null;
  display_status: string;
  client_name: string | null;
  supplier_name: string | null;
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

export async function FinancialPage({ filter, error, received, page = 1 }: { filter?: string; error?: string; received?: boolean; page?: number }) {
  const db = await createClient();
  const q = db.from("v_financial_entries").select("*").order("due_date", { ascending: true }).limit(200);
  const { data } = filter ? await q.eq("entry_type", filter) : await q;
  const entries = (data ?? []) as Entry[];

  const overdue  = entries.filter(e => e.display_status === "vencido" && e.open_amount > 0);
  const dueToday = entries.filter(e => e.display_status === "vence_hoje");
  const pending  = entries.filter(e => ["aguardando_pagamento","parcialmente_pago"].includes(e.display_status));
  const done     = entries.filter(e => ["pago","cancelado"].includes(e.display_status));
  const totalPending = pending.reduce((s, e) => s + e.open_amount, 0);
  const totalOverdue = overdue.reduce((s, e) => s + e.open_amount, 0);

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
              className={`rounded-xl px-4 py-2 text-sm font-semibold border transition ${(filter ?? "") === t.key ? "bg-forest text-white border-forest" : "bg-white border-sand hover:bg-cream"}`}>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {received && <div className="mb-4 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800 font-medium">Pagamento registrado com sucesso.</div>}
      {error && <div className="mb-4 rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>}

      {(overdue.length > 0 || dueToday.length > 0) && (
        <div className="mb-5 flex flex-wrap gap-3">
          {overdue.length > 0 && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700"><AlertCircle className="h-4 w-4" />{overdue.length} vencido(s) &middot; {money(totalOverdue)} em aberto</div>}
          {dueToday.length > 0 && <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700"><AlertTriangle className="h-4 w-4" />{dueToday.length} vence(m) hoje</div>}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Em aberto</p><p className="mt-2 text-2xl font-black">{money(totalPending)}</p><p className="text-xs text-ink/45">{pending.length} lançamento(s)</p></div>
        <div className="card border-red-200 p-5"><p className="text-xs font-bold uppercase tracking-wider text-red-600">Vencidos</p><p className="mt-2 text-2xl font-black text-red-700">{money(totalOverdue)}</p><p className="text-xs text-red-500">{overdue.length} lançamento(s)</p></div>
        <div className="card border-emerald-200 p-5"><p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Quitados</p><p className="mt-2 text-2xl font-black text-emerald-700">{done.length}</p><p className="text-xs text-emerald-500">lançamentos concluídos</p></div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b bg-cream text-left text-xs font-bold uppercase tracking-wider text-ink/40">
              <th className="px-4 py-3">Descrição</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Parte</th>
              <th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Em aberto</th>
              <th className="px-4 py-3">Vencimento</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {entries.length === 0 && <tr><td colSpan={8} className="p-10 text-center text-ink/40">Nenhum lançamento encontrado.</td></tr>}
            {entries.map(e => {
              const s = STATUS[e.display_status] ?? STATUS["aguardando_pagamento"];
              const { Icon } = s;
              const isOverdue = e.display_status === "vencido";
              return (
                <tr key={e.id} className={`hover:bg-cream/50 transition ${isOverdue ? "bg-red-50/30" : ""}`}>
                  <td className="px-4 py-3 font-medium max-w-[200px] truncate">{e.description}</td>
                  <td className="px-4 py-3"><span className={`rounded-lg px-2 py-0.5 text-xs font-bold border ${e.entry_type === "receber" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-orange-700 bg-orange-50 border-orange-200"}`}>{e.entry_type === "receber" ? "Receber" : "Pagar"}</span></td>
                  <td className="px-4 py-3 text-ink/60">{e.client_name || e.supplier_name || "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold">{money(e.total_amount)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${e.open_amount > 0 ? (isOverdue ? "text-red-700" : "text-ink") : "text-emerald-600"}`}>{money(e.open_amount)}</td>
                  <td className={`px-4 py-3 text-sm ${isOverdue ? "text-red-600 font-bold" : "text-ink/60"}`}>{e.due_date ? shortDate(e.due_date) : "—"}</td>
                  <td className="px-4 py-3"><span className={`flex w-fit items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-bold ${s.color}`}><Icon className="h-3 w-3" />{s.label}</span></td>
                  <td className="px-4 py-3">{e.open_amount > 0 && e.display_status !== "cancelado" && <PaymentDialog entryId={e.id} openAmount={e.open_amount} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
