import { getRequestClient } from "@/lib/supabase/server";
import { reversePayment } from "@/app/(crm)/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { money, shortDate } from "@/lib/utils";

export async function PaymentReversals({ entryIds }: { entryIds: string[] }) {
  if (!entryIds.length) return null;
  const db = await getRequestClient();
  const { data: allowed } = await db.rpc("has_table_access", { resource: "payments", action: "update" });
  if (allowed !== true) return null;
  const { data: payments, error } = await db.from("payments").select("id,amount,paid_at,payment_method,financial_entry_id,financial_entries(description)").in("financial_entry_id",entryIds).is("reversed_at",null).order("paid_at",{ascending:false});
  if (error) return <p role="alert">Não foi possível consultar os pagamentos para estorno.</p>;
  if (!payments?.length) return null;
  return <details className="card my-5 p-5"><summary className="cursor-pointer font-bold">Pagamentos registrados · estornar baixa</summary>
    <p className="my-3 text-sm text-ink/60">Estorne a baixa incorreta antes de reverter o orçamento. O histórico é preservado. Esta ação não devolve dinheiro pelo banco.</p>
    <div className="space-y-3">{payments.map(payment => <form key={payment.id} className="rounded-xl border p-4" action={reversePayment}>
      <input type="hidden" name="payment_id" value={payment.id}/>
      <p className="font-bold">{money(Number(payment.amount))} · {shortDate(payment.paid_at)}</p>
      <p className="text-sm">{(payment.financial_entries as unknown as {description:string}|null)?.description} · {payment.payment_method?.replaceAll("_"," ")}</p>
      <label className="mt-3 block text-sm">Motivo do estorno<input className="field mt-1" name="notes" required minLength={3} maxLength={500} placeholder="Ex.: valor da baixa incorreto"/></label>
      <ConfirmButton formAction={reversePayment} className="button-ghost mt-3 text-red-700" message={`Estornar a baixa de ${money(Number(payment.amount))}? O saldo será recalculado e o histórico preservado.`}>Estornar pagamento</ConfirmButton>
    </form>)}</div>
  </details>;
}
