// Tela do fornecedor: contato, resumo financeiro, crédito, contas, pagamentos e compras.
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { getRequestClient } from "@/lib/supabase/server";
import { localISODate, money, shortDate } from "@/lib/utils";
import { addSupplierCredit } from "@/app/(crm)/supplier-credit-actions";
import { ReceivingAccountSelect } from "@/components/receiving-account-select";

type Supplier = { id: string; name: string; tax_id: string | null; phone: string | null; whatsapp: string | null; email: string | null; city: string | null; state: string | null; payment_terms: string | null; notes: string | null; status: string };
type Entry = { id: string; description: string; total_amount: number; paid_amount: number; open_amount: number; due_date: string | null; display_status: string };
type Purchase = { id: string; order_number: string; total: number; paid_amount: number; open_amount: number; status: string; ordered_at: string | null; expected_at: string | null; received_at: string | null; order: { order_number: string } | null };
type Pay = { id: string; amount: number; paid_at: string; payment_method: string | null; receiving_account_name: string | null; entry: { id: string; description: string } | null };
type Move = { id: string; amount: number; kind: string; moved_at: string; notes: string | null };

const KIND: Record<string, string> = { excedente: "Pago a mais", adiantamento: "Adiantamento", abatimento: "Abatimento/devolução", uso: "Usado em conta", estorno_uso: "Uso estornado", ajuste: "Ajuste" };
const STATUS: Record<string, string> = { pago: "Pago", parcialmente_pago: "Parcial", aguardando_pagamento: "Aguardando", vence_hoje: "Vence hoje", vencido: "Vencido", cancelado: "Cancelado" };
const PO_STATUS: Record<string, string> = { pedido_enviado_ao_fornecedor: "A caminho", recebido_completo: "Recebido", recebido_parcial: "Recebido em parte", cancelado: "Cancelada", cancelada: "Cancelada" };

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const search = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await getRequestClient();
  const { data: supplier } = await db.from("suppliers").select("id,name,tax_id,phone,whatsapp,email,city,state,payment_terms,notes,status").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!supplier) notFound();
  const s = supplier as Supplier;
  const [entries, purchases, pays, moves, credit, financeAccess, creditAccess] = await Promise.all([
    db.from("v_financial_entries").select("id,description,total_amount,paid_amount,open_amount,due_date,display_status").eq("supplier_id", id).neq("display_status", "cancelado").order("due_date", { ascending: false, nullsFirst: true }).limit(30),
    db.from("purchase_orders").select("id,order_number,total,paid_amount,open_amount,status,ordered_at,expected_at,received_at,order:orders(order_number)").eq("supplier_id", id).order("created_at", { ascending: false }).limit(30),
    db.from("payments").select("id,amount,paid_at,payment_method,receiving_account_name,entry:financial_entries!inner(id,description,supplier_id)").eq("entry.supplier_id", id).is("reversed_at", null).order("paid_at", { ascending: false }).limit(20),
    db.from("supplier_credits").select("id,amount,kind,moved_at,notes").eq("supplier_id", id).order("created_at", { ascending: false }).limit(20),
    db.from("v_supplier_credit_balance").select("balance").eq("supplier_id", id).maybeSingle(),
    db.rpc("has_table_access", { resource: "financial_entries", action: "select" }),
    db.rpc("has_table_access", { resource: "financial_entries", action: "update" }),
  ]);
  const canFinance = financeAccess.data, canCredit = creditAccess.data;
  const list = (entries.data ?? []) as Entry[];
  const pos = (purchases.data ?? []) as unknown as Purchase[];
  const balance = Number((credit.data as { balance?: number } | null)?.balance ?? 0);
  const openTotal = list.reduce((t, e) => t + Number(e.open_amount), 0);
  const paidTotal = list.reduce((t, e) => t + Number(e.paid_amount), 0);
  const late = list.filter((e) => e.display_status === "vencido").length;
  const self = `/fornecedores/${id}`;
  const contact = [s.phone, s.whatsapp, s.email].filter(Boolean).join(" · ");

  return <div className="mx-auto max-w-5xl space-y-5">
    <Link href="/fornecedores" className="inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft className="h-4 w-4" />Fornecedores</Link>
    {search.erro && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{search.erro.slice(0, 200)}</p>}
    {search.ok && <p className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{search.ok.slice(0, 80)}</p>}

    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Fornecedor</p>
          <h1 className="mt-1 text-2xl font-black">{s.name}</h1>
          <p className="mt-1 text-sm text-ink/60">{[s.city, s.state].filter(Boolean).join(" – ") || "Sem localização"}{s.tax_id ? ` · ${s.tax_id}` : ""}{s.status !== "ativo" ? " · Inativo" : ""}</p>
          {contact && <p className="text-sm text-ink/60">{contact}</p>}
          {s.payment_terms && <p className="text-sm text-ink/60">Condição: {s.payment_terms}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="button" href="/compras/nova">Nova compra</Link>
          <Link className="button-ghost border border-sand" href="/fornecedores">Editar cadastro</Link>
        </div>
      </div>
      {s.notes && <p className="mt-3 rounded-xl bg-cream p-3 text-sm">{s.notes}</p>}
    </section>

    {canFinance === true && <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Kpi label="Em aberto" value={money(openTotal)} tone={openTotal > 0 ? "text-red-700" : ""} />
      <Kpi label="Já pago" value={money(paidTotal)} />
      <Kpi label="Crédito" value={money(balance)} tone={balance > 0 ? "text-emerald-700" : ""} />
      <Kpi label="Contas vencidas" value={String(late)} tone={late ? "text-red-700" : ""} />
    </section>}

    {canFinance === true && <section className="card p-5">
      <h2 className="mb-3 font-black">Contas a pagar</h2>
      {!list.length ? <p className="text-sm text-ink/50">Nenhuma conta deste fornecedor.</p> :
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="text-left text-xs text-ink/50"><th className="py-1">Conta</th><th>Vencimento</th><th className="text-right">Total</th><th className="text-right">Em aberto</th><th>Status</th></tr></thead><tbody>
          {list.map((e) => <tr key={e.id} className="border-t border-sand"><td className="py-2"><Link className="font-bold hover:underline" href={`/financeiro/lancamento/${e.id}`}>{e.description}</Link></td><td>{e.due_date ? shortDate(e.due_date) : "—"}</td><td className="text-right">{money(e.total_amount)}</td><td className={`text-right font-bold ${Number(e.open_amount) > 0 ? "text-red-700" : "text-emerald-700"}`}>{money(e.open_amount)}</td><td>{STATUS[e.display_status] ?? e.display_status}</td></tr>)}
        </tbody></table></div>}
    </section>}

    {canFinance === true && <section className="card p-5">
      <h2 className="mb-3 font-black">Pagamentos feitos</h2>
      {!(pays.data ?? []).length ? <p className="text-sm text-ink/50">Nenhum pagamento registrado.</p> :
        <ul className="divide-y divide-sand text-sm">{((pays.data ?? []) as unknown as Pay[]).map((p) => <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
          <span>{shortDate(p.paid_at)} · {p.entry ? <Link className="hover:underline" href={`/financeiro/lancamento/${p.entry.id}`}>{p.entry.description}</Link> : "—"}<span className="text-ink/50"> · {(p.payment_method ?? "").replaceAll("_", " ")}{p.receiving_account_name ? ` · ${p.receiving_account_name}` : ""}</span></span>
          <strong>{money(p.amount)}</strong></li>)}</ul>}
    </section>}

    {canFinance === true && <section className="card p-5">
      <h2 className="mb-1 font-black">Crédito com o fornecedor <span className={balance > 0 ? "text-emerald-700" : "text-ink/50"}>{money(balance)}</span></h2>
      <p className="mb-3 text-sm text-ink/60">Pago a mais, adiantamentos e abatimentos. É usado no &quot;Dar baixa&quot; das contas deste fornecedor ou na Nova compra.</p>
      {!!(moves.data ?? []).length && <ul className="mb-4 divide-y divide-sand text-sm">{((moves.data ?? []) as Move[]).map((m) => <li key={m.id} className="flex justify-between gap-2 py-2"><span>{shortDate(m.moved_at)} · {KIND[m.kind] ?? m.kind}{m.notes ? <span className="text-ink/50"> · {m.notes}</span> : null}</span><strong className={m.amount < 0 ? "text-ink/60" : "text-emerald-700"}>{money(m.amount)}</strong></li>)}</ul>}
      {canCredit === true && <details><summary className="cursor-pointer text-sm font-bold text-forest">Lançar crédito</summary>
        <form action={addSupplierCredit} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="_back" value={self} /><input type="hidden" name="supplier_id" value={id} />
          <div><label className="label" htmlFor="cred-tipo">Tipo</label><select id="cred-tipo" className="field" name="kind"><option value="abatimento">Abatimento / devolução (sem dinheiro)</option><option value="adiantamento">Adiantamento (saiu dinheiro)</option><option value="ajuste">Ajuste (gerência; negativo reduz)</option></select></div>
          <div><label className="label" htmlFor="cred-valor">Valor</label><input id="cred-valor" className="field" name="amount" type="number" step="0.01" required /></div>
          <div><label className="label" htmlFor="cred-data">Data</label><input id="cred-data" className="field" name="moved_at" type="date" defaultValue={localISODate()} required /></div>
          <div><label className="label">Conta de onde saiu (adiantamento)</label><ReceivingAccountSelect name="account_id" className="field" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="cred-motivo">Motivo</label><input id="cred-motivo" className="field" name="notes" required minLength={3} maxLength={500} /></div>
          <button className="button sm:col-span-2">Lançar crédito</button>
        </form>
      </details>}
    </section>}

    <section className="card p-5">
      <h2 className="mb-3 font-black">Compras</h2>
      {!pos.length ? <p className="text-sm text-ink/50">Nenhuma compra deste fornecedor.</p> :
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="text-left text-xs text-ink/50"><th className="py-1">Compra</th><th>Data</th><th>Entrega</th><th>Pedido</th><th className="text-right">Total</th><th className="text-right">Em aberto</th></tr></thead><tbody>
          {pos.map((p) => <tr key={p.id} className="border-t border-sand"><td className="py-2"><Link className="font-bold hover:underline" href={`/compras/${p.id}`}>{p.order_number}</Link><span className="ml-2 text-xs text-ink/50">{PO_STATUS[p.status] ?? p.status.replaceAll("_", " ")}</span></td><td>{p.ordered_at ? shortDate(p.ordered_at) : "—"}</td><td>{p.received_at ? `Chegou ${shortDate(p.received_at)}` : p.expected_at ? `Previsto ${shortDate(p.expected_at)}` : "—"}</td><td>{p.order?.order_number ?? "Estoque"}</td><td className="text-right">{money(p.total)}</td><td className={`text-right font-bold ${Number(p.open_amount) > 0 ? "text-red-700" : ""}`}>{money(p.open_amount)}</td></tr>)}
        </tbody></table></div>}
    </section>
  </div>;
}

function Kpi({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className="card p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/45">{label}</p><p className={`mt-1 text-xl font-black ${tone}`}>{value}</p></div>;
}
