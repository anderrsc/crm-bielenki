import { createClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";
import { PaymentDialog } from "@/components/payment-dialog";
import { ConfirmButton } from "@/components/confirm-button";
import { reversePayment } from "@/app/(crm)/actions";

type Entry = {
  id: string;
  description: string;
  entry_type: string;
  total_amount: number;
  paid_amount: number;
  open_amount: number;
  interest_amount:number;
  discount_amount:number;
  installment_count:number;
  first_installment_due_date:string|null;
  due_date: string | null;
  display_status: string;
  client_name: string | null;
  supplier_name: string | null;
};

type Summary = { open_amount:number;open_count:number;overdue_amount:number;overdue_count:number;due_today_count:number;done_count:number;total_count:number };

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

export async function FinancialPage({ filter, error, received, page=1 }: { filter?: string; error?: string; received?: boolean;page?:number }) {
  const db = await createClient();
  const pageSize=50;const from=(page-1)*pageSize;const q = db.from("v_financial_entries").select("*").order("due_date", { ascending: true }).range(from,from+pageSize-1);
  const [listResult, summaryResult] = await Promise.all([
    filter ? q.eq("entry_type", filter) : q,
    db.rpc("financial_summary", { p_entry_type: filter ?? null }),
  ]);
  const { data } = listResult;
  const entries = (data ?? []) as Entry[];
  const paymentResult=entries.length?await db.from("payments").select("id,financial_entry_id,amount,paid_at").in("financial_entry_id",entries.map(entry=>entry.id)).is("reversed_at",null).order("created_at",{ascending:false}):{data:[]};
  const activePayments=(paymentResult.data??[]) as {id:string;financial_entry_id:string;amount:number;paid_at:string}[];

  const overdue  = entries.filter(e => e.display_status === "vencido" && e.open_amount > 0);
  const dueToday = entries.filter(e => e.display_status === "vence_hoje");
  const done     = entries.filter(e => ["pago","cancelado"].includes(e.display_status));
  const fallback:Summary={open_amount:entries.filter(e=>e.open_amount>0&&e.display_status!=="cancelado").reduce((s,e)=>s+e.open_amount,0),open_count:entries.filter(e=>e.open_amount>0&&e.display_status!=="cancelado").length,overdue_amount:overdue.reduce((s,e)=>s+e.open_amount,0),overdue_count:overdue.length,due_today_count:dueToday.length,done_count:done.length,total_count:entries.length};
  const summary=(summaryResult.data as Summary|null)??fallback;

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

      {(summary.overdue_count > 0 || summary.due_today_count > 0) && (
        <div className="mb-5 flex flex-wrap gap-3">
          {summary.overdue_count > 0 && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700"><AlertCircle className="h-4 w-4" />{summary.overdue_count} vencido(s) &middot; {money(summary.overdue_amount)} em aberto</div>}
          {summary.due_today_count > 0 && <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700"><AlertTriangle className="h-4 w-4" />{summary.due_today_count} vence(m) hoje</div>}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Em aberto</p><p className="mt-2 text-2xl font-black">{money(summary.open_amount)}</p><p className="text-xs text-ink/45">{summary.open_count} lançamento(s)</p></div>
        <div className="card border-red-200 p-5"><p className="text-xs font-bold uppercase tracking-wider text-red-600">Vencidos</p><p className="mt-2 text-2xl font-black text-red-700">{money(summary.overdue_amount)}</p><p className="text-xs text-red-500">{summary.overdue_count} lançamento(s)</p></div>
        <div className="card border-emerald-200 p-5"><p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Quitados</p><p className="mt-2 text-2xl font-black text-emerald-700">{summary.done_count}</p><p className="text-xs text-emerald-500">lançamentos concluídos</p></div>
      </div>

      <div className="card overflow-hidden">
        {summary.total_count>entries.length&&<p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">Exibindo {entries.length} de {summary.total_count} lançamentos. Os totalizadores consideram todos.</p>}
        <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm">
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
                   <td className="px-4 py-3"><div className="flex items-center gap-2">{e.open_amount > 0 && e.display_status !== "cancelado" && <PaymentDialog entryId={e.id} openAmount={e.open_amount} interestAmount={e.interest_amount} discountAmount={e.discount_amount} installmentCount={e.installment_count} firstDueDate={e.first_installment_due_date||e.due_date}/>} {activePayments.find(payment=>payment.financial_entry_id===e.id)&&<form><input type="hidden" name="payment_id" value={activePayments.find(payment=>payment.financial_entry_id===e.id)!.id}/><ConfirmButton formAction={reversePayment} message="Estornar o pagamento mais recente deste lançamento?" className="text-xs font-bold text-red-700">Estornar</ConfirmButton></form>}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {summary.total_count>pageSize&&<div className="flex items-center justify-between border-t p-4 text-sm"><Link className={page<=1?"pointer-events-none text-ink/25":"font-bold text-forest"} href={`/financeiro${filter?`/${filter}`:""}?pagina=${page-1}`}>Anterior</Link><span>Página {page}</span><Link className={from+entries.length>=summary.total_count?"pointer-events-none text-ink/25":"font-bold text-forest"} href={`/financeiro${filter?`/${filter}`:""}?pagina=${page+1}`}>Próxima</Link></div>}
      </div>
    </div>
  );
}
