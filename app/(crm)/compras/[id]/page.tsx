// Tela da compra: itens, pagamento, entrega, pedido, receber material, corrigir e cancelar.
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { getRequestClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";
import { ConfirmButton } from "@/components/confirm-button";
import { PurchaseEditForm } from "@/components/purchase-edit-form";
import { cancelPurchase } from "@/app/(crm)/purchase-edit-actions";

type Po = { id: string; order_number: string; status: string; total: number; paid_amount: number; open_amount: number; ordered_at: string | null; expected_at: string | null; received_at: string | null; notes: string | null; supplier_id: string; order_id: string | null; supplier: { name: string } | null; order: { id: string; order_number: string; client: { name: string } | null } | null };
type Item = { id: string; description: string; category: string | null; unit: string; purchased_quantity: number; received_quantity: number; pending_quantity: number; unit_price: number; total: number };

export default async function PurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const search = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await getRequestClient();
  const { data } = await db.from("purchase_orders").select("id,order_number,status,total,paid_amount,open_amount,ordered_at,expected_at,received_at,notes,supplier_id,order_id,supplier:suppliers(name),order:orders(id,order_number,client:clients(name))").eq("id", id).maybeSingle();
  if (!data) notFound();
  const po = data as unknown as Po;
  const [items, entry, canEdit, suppliers, orders] = await Promise.all([
    db.from("purchase_order_items").select("id,description,category,unit,purchased_quantity,received_quantity,pending_quantity,unit_price,total").eq("purchase_order_id", id).order("id"),
    db.from("financial_entries").select("id,open_amount,paid_amount,due_date,status").eq("purchase_order_id", id).maybeSingle(),
    db.rpc("has_table_access", { resource: "purchase_orders", action: "update" }),
    db.from("suppliers").select("id,name").is("deleted_at", null).order("name"),
    db.from("orders").select("id,order_number,client:clients(name)").not("operational_status", "in", "(finalizado,cancelado)").order("created_at", { ascending: false }).limit(300),
  ]);
  const list = (items.data ?? []) as Item[];
  const fe = entry.data as { id: string; open_amount: number; paid_amount: number; due_date: string | null; status: string } | null;
  const cancelled = ["cancelado", "cancelada"].includes(po.status);
  const received = list.some((i) => Number(i.received_quantity) > 0);
  const pending = list.some((i) => Number(i.pending_quantity) > 0);
  const orderOptions = ((orders.data ?? []) as unknown as { id: string; order_number: string; client: { name: string } | null }[]).map((o) => ({ id: o.id, label: `${o.order_number}${o.client?.name ? ` · ${o.client.name}` : ""}` }));
  if (po.order && !orderOptions.some((o) => o.id === po.order!.id)) orderOptions.unshift({ id: po.order.id, label: `${po.order.order_number}${po.order.client?.name ? ` · ${po.order.client.name}` : ""}` });

  return <div className="mx-auto max-w-4xl space-y-5">
    <Link href="/compras" className="inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft className="h-4 w-4" />Compras</Link>
    {search.erro && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{search.erro.slice(0, 200)}</p>}
    {search.ok && <p className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{search.ok.slice(0, 80)}</p>}
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Compra</p><h1 className="mt-1 text-2xl font-black">{po.order_number}</h1>
          <p className="mt-1 text-sm text-ink/60"><Link className="underline" href={`/fornecedores/${po.supplier_id}`}>{po.supplier?.name ?? "Fornecedor"}</Link> · {po.ordered_at ? shortDate(po.ordered_at) : "—"} · {po.order ? <Link className="underline" href={`/pedidos/${po.order.id}`}>Pedido {po.order.order_number}</Link> : "Estoque"}</p></div>
        <span className={`rounded-lg border px-3 py-1 text-sm font-bold ${cancelled ? "border-red-200 bg-red-50 text-red-700" : "border-sand"}`}>{cancelled ? "Cancelada" : po.received_at || (received && !pending) ? "Recebida" : received ? "Recebida em parte" : po.expected_at ? `Chega ${shortDate(po.expected_at)}` : "A caminho"}</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div><dt className="text-xs font-bold uppercase text-ink/45">Total</dt><dd className="text-lg font-black">{money(po.total)}</dd></div>
        <div><dt className="text-xs font-bold uppercase text-ink/45">Pago</dt><dd className="text-lg font-black">{money(fe?.paid_amount ?? 0)}</dd></div>
        <div><dt className="text-xs font-bold uppercase text-ink/45">Devendo</dt><dd className={`text-lg font-black ${Number(fe?.open_amount ?? 0) > 0 ? "text-red-700" : ""}`}>{money(fe?.open_amount ?? 0)}</dd></div>
        <div><dt className="text-xs font-bold uppercase text-ink/45">Vencimento</dt><dd className="text-lg font-black">{fe?.due_date ? shortDate(fe.due_date) : "—"}</dd></div>
      </dl>
      {po.notes && <p className="mt-3 whitespace-pre-line rounded-xl bg-cream p-3 text-sm">{po.notes}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {fe && <Link className="button" href={`/financeiro/lancamento/${fe.id}`}>{Number(fe.open_amount) > 0 && !cancelled ? "Pagar / ver conta" : "Ver conta"}</Link>}
        {pending && !cancelled && <Link className="button-ghost border border-sand" href="/producao/materiais-do-pedido">Receber material</Link>}
      </div>
    </section>
    <section className="card p-5"><h2 className="mb-3 font-black">Itens</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="text-left text-xs text-ink/50"><th className="py-1">Material</th><th>Tipo</th><th className="text-right">Qtd</th><th className="text-right">Recebido</th><th className="text-right">Unit.</th><th className="text-right">Total</th></tr></thead><tbody>
        {list.map((i) => <tr key={i.id} className="border-t border-sand"><td className="py-2">{i.description}</td><td>{i.category ?? "—"}</td><td className="text-right">{Number(i.purchased_quantity)} {i.unit}</td><td className="text-right">{Number(i.received_quantity)}</td><td className="text-right">{money(i.unit_price)}</td><td className="text-right font-bold">{money(i.total)}</td></tr>)}
      </tbody></table></div>
    </section>
    {canEdit.data === true && !cancelled && <section className="card p-5">
      <details><summary className="cursor-pointer font-black">Corrigir esta compra</summary>
        <PurchaseEditForm id={po.id} supplierId={po.supplier_id} suppliers={(suppliers.data ?? []) as { id: string; name: string }[]} expectedAt={po.expected_at ?? ""} notes={po.notes ?? ""} orderId={po.order_id ?? ""} orders={orderOptions} locked={received}
          items={list.map((i) => ({ id: i.id, description: i.description, category: i.category ?? "Outro", quantity: Number(i.purchased_quantity), unit_price: Number(i.unit_price) }))} />
        {!received && Number(fe?.paid_amount ?? 0) === 0 && <form action={cancelPurchase} className="mt-4 flex flex-wrap items-end gap-2 border-t border-sand pt-4">
          <input type="hidden" name="id" value={po.id} />
          <input className="field flex-1" name="reason" aria-label="Motivo do cancelamento" placeholder="Motivo do cancelamento (lançada errada, duplicada…)" required minLength={3} maxLength={500} />
          <ConfirmButton formAction={cancelPurchase} className="button-ghost text-red-700" message="Cancelar esta compra? A conta a pagar também é cancelada.">Cancelar compra</ConfirmButton>
        </form>}
      </details>
    </section>}
  </div>;
}
