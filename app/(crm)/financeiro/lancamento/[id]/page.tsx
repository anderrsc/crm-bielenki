// Tela da conta (a pagar/receber): dados, baixa, vencimento, classificação, rateio,
// pagamentos registrados e estorno, tudo no mesmo lugar.
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { getRequestClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";
import { PaymentDialog } from "@/components/payment-dialog";
import { RescheduleDialog } from "@/components/reschedule-dialog";
import { ConfirmButton } from "@/components/confirm-button";
import { reversePayment } from "@/app/(crm)/actions";
import { cancelFinancialEntry, editFinancialEntry, resendPaymentReceipt } from "@/app/(crm)/financial-actions";

type Entry = {
  id: string; description: string; entry_type: string; origin: string | null; total_amount: number; paid_amount: number; open_amount: number;
  interest_amount: number; discount_amount: number; installment_count: number; first_installment_due_date: string | null; due_date: string | null;
  display_status: string; status: string; notes: string | null; client_id: string | null; supplier_id: string | null; sale_id: string | null; purchase_order_id: string | null;
  client_name: string | null; supplier_name: string | null; category_name: string | null; cost_center_name: string | null; created_at: string;
};
type Payment = { id: string; amount: number; paid_at: string; payment_method: string | null; receiving_account_name: string | null; notes: string | null; reversed_at: string | null; reversal_notes?: string | null };

type Receipt = { payment_id: string; receipt_number: number; status: string; sent_at: string | null; last_error: string | null; pdf_path: string | null };
const RECEIPT_STATUS: Record<string, [string, string]> = {
  pendente: ["Recibo na fila", "bg-amber-50 text-amber-800"], processando: ["Gerando recibo…", "bg-amber-50 text-amber-800"],
  enviado: ["Recibo enviado no WhatsApp", "bg-emerald-50 text-emerald-700"], sem_whatsapp: ["Recibo gerado · cliente sem WhatsApp", "bg-orange-50 text-orange-700"],
  falhou: ["Recibo não enviado", "bg-red-50 text-red-700"], cancelado: ["Recibo cancelado", "bg-cream text-ink/60"], historico: ["Recibo não enviado (baixa antiga)", "bg-cream text-ink/60"],
};

const STATUS: Record<string, string> = { pago: "Pago", parcialmente_pago: "Parcial", aguardando_pagamento: "Aguardando", vence_hoje: "Vence hoje", vencido: "Vencido", cancelado: "Cancelado" };
const METHOD: Record<string, string> = { credito_fornecedor: "Crédito com fornecedor", cartao_credito: "Cartão de crédito", cartao_debito: "Cartão de débito" };

export default async function FinancialEntryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string; recebido?: string }> }) {
  const { id } = await params;
  const search = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await getRequestClient();
  const { data: entry } = await db.from("v_financial_entries").select("*").eq("id", id).maybeSingle();
  if (!entry) notFound();
  const e = entry as Entry;
  const [{ data: payments }, { data: canPay }, { data: canReverse }, { data: canClassify }, { data: supplierList }, { data: credit }] = await Promise.all([
    db.from("payments").select("*").eq("financial_entry_id", id).order("paid_at", { ascending: false }).order("created_at", { ascending: false }),
    db.rpc("has_table_access", { resource: "payments", action: "insert" }),
    db.rpc("has_table_access", { resource: "payments", action: "update" }),
    db.rpc("has_table_access", { resource: "financial_entries", action: "update" }),
    e.entry_type === "pagar" && !e.sale_id && !e.purchase_order_id ? db.from("suppliers").select("id,name").is("deleted_at", null).order("name") : Promise.resolve({ data: null }),
    e.entry_type === "pagar" && e.supplier_id ? db.from("v_supplier_credit_balance").select("balance").eq("supplier_id", e.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { data: receiptRows } = e.entry_type === "receber"
    ? await db.from("payment_receipts").select("payment_id,receipt_number,status,sent_at,last_error,pdf_path").eq("financial_entry_id", id)
    : { data: null };
  const receipts = new Map(((receiptRows ?? []) as Receipt[]).map((r) => [r.payment_id, r]));
  const self = `/financeiro/lancamento/${id}`;
  const open = Number(e.open_amount) > 0 && e.display_status !== "cancelado";
  const list = (payments ?? []) as Payment[];
  const pagar = e.entry_type === "pagar";
  const person = e.client_name || e.supplier_name;
  const personHref = e.client_id ? `/clientes/${e.client_id}` : null;
  const avulsa = ["manual", "despesa", "ajuste"].includes(e.origin ?? "") && !e.sale_id && !e.purchase_order_id;
  const hasValidPayment = list.some((p) => !p.reversed_at);
  const origin = e.sale_id ? { href: `/vendas/${e.sale_id}`, label: "Abrir venda" } : e.purchase_order_id ? { href: `/compras/${e.purchase_order_id}`, label: "Abrir compra" } : null;

  return <div className="mx-auto max-w-4xl space-y-5">
    <Link href={pagar ? "/financeiro/pagar" : "/financeiro/receber"} className="inline-flex items-center gap-2 text-sm font-semibold text-ink/55"><ArrowLeft className="h-4 w-4" />{pagar ? "Contas a pagar" : "Contas a receber"}</Link>
    {search.erro && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{search.erro.slice(0, 200)}</p>}
    {(search.ok || search.recebido) && <p className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{search.ok ? search.ok.slice(0, 80) : "Pagamento registrado."}</p>}

    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${pagar ? "border-orange-200 bg-orange-50 text-orange-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{pagar ? "A pagar" : "A receber"}</span>
          <h1 className="mt-2 text-2xl font-semibold">{e.description}</h1>
          <p className="mt-1 text-sm text-ink/60">{person ? (personHref ? <Link className="underline" href={personHref}>{person}</Link> : person) : "Sem cliente/fornecedor"} · {e.category_name || "Sem categoria"} · {e.cost_center_name || "Sem centro de custos"}</p>
        </div>
        <span className="rounded-lg border border-sand px-3 py-1 text-sm font-semibold">{STATUS[e.display_status] ?? e.display_status}</span>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Info label="Total" value={money(e.total_amount)} />
        <Info label="Pago" value={money(e.paid_amount)} />
        <Info label="Em aberto" value={money(e.open_amount)} strong={open} />
        <Info label="Vencimento" value={e.due_date ? shortDate(e.due_date) : "—"} />
        {Number(e.interest_amount) > 0 && <Info label="Juros" value={money(e.interest_amount)} />}
        {Number(e.discount_amount) > 0 && <Info label="Desconto" value={money(e.discount_amount)} />}
        {e.installment_count > 1 && <Info label="Parcelas" value={String(e.installment_count)} />}
        {credit && Number((credit as { balance: number }).balance) > 0 && <Info label="Crédito do fornecedor" value={money((credit as { balance: number }).balance)} />}
      </dl>
      {e.notes && <p className="mt-4 rounded-xl bg-cream p-3 text-sm">{e.notes}</p>}
    </section>

    <section className="card p-5">
      <h2 className="mb-3 font-semibold">Ações</h2>
      <div className="flex flex-wrap gap-2">
        {open && canPay === true && <PaymentDialog backHref={self} canOverpay={pagar && !!e.supplier_id} supplierCredit={credit ? Number((credit as { balance: number }).balance) : 0} entryType={e.entry_type} entryId={e.id} openAmount={Number(e.open_amount)} interestAmount={Number(e.interest_amount)} discountAmount={Number(e.discount_amount)} installmentCount={e.installment_count} firstDueDate={e.first_installment_due_date} buttonClassName="button" />}
        {open && <RescheduleDialog entryId={e.id} currentDueDate={e.due_date} backHref={self} label="Mudar vencimento" />}
        {canClassify === true && <Link className="button-ghost border border-sand" href={`/financeiro/classificacoes?lancamento=${e.id}`}>Classificar</Link>}
        {canClassify === true && e.display_status !== "cancelado" && <Link className="button-ghost border border-sand" href={`/financeiro/rateios?conta=${e.id}`}>Ratear</Link>}
        {origin && <Link className="button-ghost border border-sand" href={origin.href}>{origin.label}</Link>}
      </div>
    </section>

    {canClassify === true && e.display_status !== "cancelado" && <section className="card p-5">
      <details><summary className="cursor-pointer font-semibold">Corrigir esta conta</summary>
        <form action={editFinancialEntry} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={e.id} />
          <div className="sm:col-span-2"><label className="label" htmlFor="ed-desc">Descrição</label><input id="ed-desc" className="field" name="description" defaultValue={e.description} required minLength={2} maxLength={300} /></div>
          {avulsa ? <div><label className="label" htmlFor="ed-total">Valor total</label><input id="ed-total" className="field" name="total_amount" type="number" step="0.01" min="0.01" defaultValue={Number(e.total_amount)} required /></div>
            : <p className="self-end text-xs text-ink/55">O valor desta conta vem da {e.sale_id ? "venda" : "compra"}; corrija por lá.</p>}
          <div><label className="label" htmlFor="ed-venc">Vencimento</label><input id="ed-venc" className="field" name="due_date" type="date" defaultValue={e.due_date ?? ""} /></div>
          {avulsa && supplierList && <div className="sm:col-span-2"><label className="label" htmlFor="ed-forn">Fornecedor</label><select id="ed-forn" className="field" name="party_id" defaultValue={e.supplier_id ?? ""}><option value="">Sem fornecedor</option>{(supplierList as { id: string; name: string }[]).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>}
          <div className="sm:col-span-2"><label className="label" htmlFor="ed-obs">Observação</label><textarea id="ed-obs" className="field min-h-16" name="notes" defaultValue={e.notes ?? ""} maxLength={2000} /></div>
          <button className="button sm:col-span-2">Salvar correção</button>
        </form>
        {avulsa && !hasValidPayment && <form action={cancelFinancialEntry} className="mt-4 flex flex-wrap items-end gap-2 border-t border-sand pt-4">
          <input type="hidden" name="id" value={e.id} />
          <input className="field flex-1" name="reason" aria-label="Motivo do cancelamento" placeholder="Motivo do cancelamento (lançada errada, duplicada…)" required minLength={3} maxLength={500} />
          <ConfirmButton formAction={cancelFinancialEntry} className="button-ghost text-red-700" message="Cancelar esta conta? Ela some dos totais e fica no histórico.">Cancelar conta</ConfirmButton>
        </form>}
      </details>
    </section>}

    <section className="card p-5">
      <h2 className="mb-3 font-semibold">Pagamentos</h2>
      {!list.length && <p className="text-sm text-ink/50">Nenhum pagamento registrado.</p>}
      <div className="space-y-3">{list.map((p) => <div key={p.id} className={`rounded-xl border p-4 ${p.reversed_at ? "border-sand bg-cream/60 opacity-70" : "border-sand"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">{money(p.amount)} · {shortDate(p.paid_at)}</p>
          {p.reversed_at ? <span className="rounded-lg bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">Estornado em {shortDate(p.reversed_at)}</span> : <span className="rounded-lg bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Válido</span>}
        </div>
        <p className="text-sm text-ink/60">{METHOD[p.payment_method ?? ""] ?? (p.payment_method ?? "—").replaceAll("_", " ")}{p.receiving_account_name ? ` · ${p.receiving_account_name}` : ""}{p.notes ? ` · ${p.notes}` : ""}</p>
        {(() => { const r = receipts.get(p.id); if (!r) return null; const [label, cls] = RECEIPT_STATUS[r.status] ?? [r.status, "bg-cream"];
          return <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${cls}`}>Nº {String(r.receipt_number).padStart(6, "0")} · {label}{r.status === "enviado" && r.sent_at ? ` em ${new Date(r.sent_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}</span>
            {r.pdf_path && <a className="font-semibold underline" href={`/api/recibos/${p.id}`} target="_blank" rel="noopener noreferrer">Abrir recibo</a>}
            {!p.reversed_at && canPay === true && r.status !== "processando" && r.status !== "cancelado" && <form action={resendPaymentReceipt}><input type="hidden" name="payment_id" value={p.id} /><input type="hidden" name="_back" value={self} /><button className="font-semibold text-forest underline">{r.status === "enviado" ? "Reenviar ao cliente" : "Enviar ao cliente"}</button></form>}
            {r.last_error && r.status !== "historico" && r.status !== "enviado" && <span className="w-full text-xs text-ink/50">{r.last_error}</span>}
          </div>; })()}
        {!p.reversed_at && canReverse === true && <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold text-red-700">Estornar este pagamento</summary>
          <form action={reversePayment} className="mt-2">
            <input type="hidden" name="payment_id" value={p.id} /><input type="hidden" name="_back" value={self} />
            <label className="block text-sm">Motivo do estorno<input className="field mt-1" name="notes" required minLength={3} maxLength={500} placeholder="Ex.: valor da baixa incorreto" /></label>
            <ConfirmButton formAction={reversePayment} className="button-ghost mt-2 text-red-700" message={`Estornar a baixa de ${money(p.amount)}? A conta volta a ficar em aberto e o histórico é preservado.`}>Confirmar estorno</ConfirmButton>
          </form>
        </details>}
      </div>)}</div>
    </section>
  </div>;
}

function Info({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div><dt className="text-xs font-semibold text-ink/45">{label}</dt><dd className={`mt-1 text-lg font-semibold ${strong ? "text-red-700" : ""}`}>{value}</dd></div>;
}
