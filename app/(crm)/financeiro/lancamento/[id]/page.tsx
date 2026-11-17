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

type Entry = {
  id: string; description: string; entry_type: string; origin: string | null; total_amount: number; paid_amount: number; open_amount: number;
  interest_amount: number; discount_amount: number; installment_count: number; first_installment_due_date: string | null; due_date: string | null;
  display_status: string; notes: string | null; client_id: string | null; supplier_id: string | null; sale_id: string | null; purchase_order_id: string | null;
  client_name: string | null; supplier_name: string | null; category_name: string | null; cost_center_name: string | null; created_at: string;
};
type Payment = { id: string; amount: number; paid_at: string; payment_method: string | null; receiving_account_name: string | null; notes: string | null; reversed_at: string | null; reversal_notes?: string | null };

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
  const [{ data: payments }, { data: canPay }, { data: canReverse }, { data: canClassify }, { data: credit }] = await Promise.all([
    db.from("payments").select("*").eq("financial_entry_id", id).order("paid_at", { ascending: false }).order("created_at", { ascending: false }),
    db.rpc("has_table_access", { resource: "payments", action: "insert" }),
    db.rpc("has_table_access", { resource: "payments", action: "update" }),
    db.rpc("has_table_access", { resource: "financial_entries", action: "update" }),
    e.entry_type === "pagar" && e.supplier_id ? db.from("v_supplier_credit_balance").select("balance").eq("supplier_id", e.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const self = `/financeiro/lancamento/${id}`;
  const open = Number(e.open_amount) > 0 && e.display_status !== "cancelado";
  const list = (payments ?? []) as Payment[];
  const pagar = e.entry_type === "pagar";
  const person = e.client_name || e.supplier_name;
  const personHref = e.client_id ? `/clientes/${e.client_id}` : null;
  const origin = e.sale_id ? { href: `/vendas/${e.sale_id}`, label: "Abrir venda" } : e.purchase_order_id ? { href: `/compras/${e.purchase_order_id}`, label: "Abrir compra" } : null;

  return <div className="mx-auto max-w-4xl space-y-5">
    <Link href={pagar ? "/financeiro/pagar" : "/financeiro/receber"} className="inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft className="h-4 w-4" />{pagar ? "Contas a pagar" : "Contas a receber"}</Link>
    {search.erro && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{search.erro.slice(0, 200)}</p>}
    {(search.ok || search.recebido) && <p className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{search.ok ? search.ok.slice(0, 80) : "Pagamento registrado."}</p>}

    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className={`rounded-lg border px-2 py-0.5 text-xs font-bold ${pagar ? "border-orange-200 bg-orange-50 text-orange-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{pagar ? "A pagar" : "A receber"}</span>
          <h1 className="mt-2 text-2xl font-black">{e.description}</h1>
          <p className="mt-1 text-sm text-ink/60">{person ? (personHref ? <Link className="underline" href={personHref}>{person}</Link> : person) : "Sem cliente/fornecedor"} · {e.category_name || "Sem categoria"} · {e.cost_center_name || "Sem centro de custos"}</p>
        </div>
        <span className="rounded-lg border border-sand px-3 py-1 text-sm font-bold">{STATUS[e.display_status] ?? e.display_status}</span>
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
      <h2 className="mb-3 font-black">Ações</h2>
      <div className="flex flex-wrap gap-2">
        {open && canPay === true && <PaymentDialog backHref={self} canOverpay={pagar && !!e.supplier_id} supplierCredit={credit ? Number((credit as { balance: number }).balance) : 0} entryType={e.entry_type} entryId={e.id} openAmount={Number(e.open_amount)} interestAmount={Number(e.interest_amount)} discountAmount={Number(e.discount_amount)} installmentCount={e.installment_count} firstDueDate={e.first_installment_due_date} buttonClassName="button" />}
        {open && <RescheduleDialog entryId={e.id} currentDueDate={e.due_date} backHref={self} label="Mudar vencimento" />}
        {canClassify === true && <Link className="button-ghost border border-sand" href={`/financeiro/classificacoes?lancamento=${e.id}`}>Classificar</Link>}
        {canClassify === true && e.display_status !== "cancelado" && <Link className="button-ghost border border-sand" href={`/financeiro/rateios?conta=${e.id}`}>Ratear</Link>}
        {origin && <Link className="button-ghost border border-sand" href={origin.href}>{origin.label}</Link>}
      </div>
    </section>

    <section className="card p-5">
      <h2 className="mb-3 font-black">Pagamentos</h2>
      {!list.length && <p className="text-sm text-ink/50">Nenhum pagamento registrado.</p>}
      <div className="space-y-3">{list.map((p) => <div key={p.id} className={`rounded-xl border p-4 ${p.reversed_at ? "border-sand bg-cream/60 opacity-70" : "border-sand"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold">{money(p.amount)} · {shortDate(p.paid_at)}</p>
          {p.reversed_at ? <span className="rounded-lg bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">Estornado em {shortDate(p.reversed_at)}</span> : <span className="rounded-lg bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">Válido</span>}
        </div>
        <p className="text-sm text-ink/60">{METHOD[p.payment_method ?? ""] ?? (p.payment_method ?? "—").replaceAll("_", " ")}{p.receiving_account_name ? ` · ${p.receiving_account_name}` : ""}{p.notes ? ` · ${p.notes}` : ""}</p>
        {!p.reversed_at && canReverse === true && <details className="mt-2"><summary className="cursor-pointer text-sm font-bold text-red-700">Estornar este pagamento</summary>
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
  return <div><dt className="text-xs font-bold uppercase tracking-wider text-ink/45">{label}</dt><dd className={`mt-1 text-lg font-black ${strong ? "text-red-700" : ""}`}>{value}</dd></div>;
}
