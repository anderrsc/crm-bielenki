// Corrigir/cancelar venda. Venda de orçamento: orienta a reverter a aprovação.
import Link from "next/link";
import { getRequestClient } from "@/lib/supabase/server";
import { ConfirmButton } from "@/components/confirm-button";
import { SaleEditForm } from "@/components/sale-edit-form";
import { cancelManualSale } from "@/app/(crm)/sale-edit-actions";

export async function SaleCorrection({ saleId }: { saleId: string }) {
  const db = await getRequestClient();
  const [{ data: sale }, { data: quote }, { data: canEdit }] = await Promise.all([
    db.from("sales").select("id,client_id,notes,paid_amount,operational_status").eq("id", saleId).maybeSingle(),
    db.from("quotes").select("id,quote_number").eq("sale_id", saleId).maybeSingle(),
    db.rpc("has_table_access", { resource: "sales", action: "update" }),
  ]);
  if (!sale || canEdit !== true || sale.operational_status === "cancelado") return null;
  if (quote) return <section className="card mx-auto mt-5 max-w-6xl p-5 text-sm"><strong>Lançou algo errado nesta venda?</strong> Ela veio do orçamento {quote.quote_number}: <Link className="font-bold text-forest underline" href={`/orcamentos/${quote.id}`}>abra o orçamento</Link> e use &quot;Reverter aprovação&quot;, corrija e aprove de novo.</section>;
  const [{ data: items }, { data: clients }, { data: entry }, { data: order }] = await Promise.all([
    db.from("sale_items").select("id,description,product,quantity,unit_price").eq("sale_id", saleId).order("id"),
    db.from("clients").select("id,name").order("name").limit(2000),
    db.from("financial_entries").select("due_date").eq("sale_id", saleId).neq("status", "cancelado").limit(1).maybeSingle(),
    db.from("orders").select("id").eq("sale_id", saleId).limit(1).maybeSingle(),
  ]);
  const list = (clients ?? []) as { id: string; name: string }[];
  if (!list.some((c) => c.id === sale.client_id)) list.unshift({ id: sale.client_id, name: "Cliente atual" });
  return <section className="card mx-auto mt-5 max-w-6xl p-5">
    <details><summary className="cursor-pointer font-black">Corrigir esta venda</summary>
      <SaleEditForm id={sale.id} clientId={sale.client_id} clients={list} dueDate={entry?.due_date ?? ""} notes={sale.notes ?? ""}
        items={((items ?? []) as { id: string; description: string | null; product: string | null; quantity: number; unit_price: number }[]).map((i) => ({ id: i.id, description: i.description || i.product || "", quantity: Number(i.quantity), unit_price: Number(i.unit_price) }))} />
      {Number(sale.paid_amount) === 0 && !order && <form action={cancelManualSale} className="mt-4 flex flex-wrap items-end gap-2 border-t border-sand pt-4">
        <input type="hidden" name="id" value={sale.id} />
        <input className="field flex-1" name="reason" aria-label="Motivo do cancelamento" placeholder="Motivo do cancelamento" required minLength={3} maxLength={500} />
        <ConfirmButton formAction={cancelManualSale} className="button-ghost text-red-700" message="Cancelar esta venda? A conta a receber também é cancelada.">Cancelar venda</ConfirmButton>
      </form>}
    </details>
  </section>;
}
