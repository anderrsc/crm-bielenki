import Link from "next/link";
import { ArrowLeft, CheckCircle2, ClipboardCheck, FileText, Ruler } from "lucide-react";
import { getRequestClient } from "@/lib/supabase/server";
import { loadSaleWorkspace, type SaleWorkspaceData, type SaleEntry } from "@/lib/sales/workspace";
import { money, shortDate } from "@/lib/utils";
import { StatusBadge } from "./status-badge";
import { PaymentDialog } from "./payment-dialog";
import { ConfirmButton } from "./confirm-button";
import { toggleChecklistItem } from "@/app/(crm)/actions";

export async function SaleDetail({ id, error, received }: { id: string; error?: string; received?: boolean }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <MissingSale />;
  const data = await loadSaleWorkspace(await getRequestClient(), id);
  return data ? <SaleWorkspace data={data} error={error} received={received} /> : <MissingSale />;
}

export function SaleWorkspace({ data, error, received }: { data: SaleWorkspaceData; error?: string; received?: boolean }) {
  const { sale, order, quote, entries, checklist, measurements, access, warnings } = data;
  const back = `/vendas/${sale.id}`;
  const pendingEntries = entries.filter(entry => Number(entry.open_amount) > 0 && entry.status !== "cancelado");
  const canPay = access["financial_entries:select"] && access["financial_entries:update"] && access["payments:insert"];
  const measurementStep = checklist.find(item => /medidas?\s+conferid[ao]s?/i.test(item.title));
  const hasMeasurements = Boolean(measurementStep || measurements.length);
  const payment = (entry: SaleEntry, primary = false) => <PaymentDialog entryId={entry.id} openAmount={Number(entry.open_amount)}
    interestAmount={Number(entry.interest_amount ?? 0)} discountAmount={Number(entry.discount_amount ?? 0)}
    installmentCount={Number(entry.installment_count ?? 1)} firstDueDate={entry.first_installment_due_date}
    backHref={back} label="Registrar pagamento" buttonClassName={primary ? "button" : "button-ghost"} />;

  return <div className="mx-auto max-w-6xl space-y-5" data-testid="sale-workspace">
    <Link href="/vendas" className="inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft size={16} /> Voltar às vendas</Link>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {received && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">Pagamento registrado. Os saldos da venda e do pedido foram atualizados.</p>}
    {warnings.map(warning => <p role="alert" key={warning} className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{warning} Atualize a página para tentar novamente.</p>)}
    <section id="topo-venda" className="card scroll-mt-28 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-forest">Venda</p><h1 className="mt-2 text-3xl font-black">{sale.sale_number}</h1><p className="mt-2 font-medium">{sale.client?.name ?? "Cliente"}</p></div><StatusBadge value={sale.financial_status} /></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">{[["Total da venda", sale.total], ["Recebido", sale.paid_amount], ["Em aberto", sale.open_amount]].map(([title, amount]) => <div className="rounded-xl bg-cream/70 p-4" key={String(title)}><p className="text-xs text-ink/55">{title}</p><p className="mt-2 text-2xl font-black num">{money(Number(amount))}</p></div>)}</div>
      <nav aria-label="Ações da venda" className="mt-6 flex flex-wrap gap-3">
        {canPay && pendingEntries.length === 1 && payment(pendingEntries[0], true)}
        {canPay && pendingEntries.length > 1 && <a className="button" href="#contas-da-venda">Registrar pagamento</a>}
        {hasMeasurements && <a className="button-ghost" href="#conferencia-medidas"><Ruler size={16} /> Conferir medidas</a>}
        {order && <Link className="button-ghost" href={`/pedidos/${order.id}`}><ClipboardCheck size={16} /> Abrir pedido</Link>}
        {quote && <Link className="button-ghost" href={`/orcamentos/${quote.id}`}><FileText size={16} /> Abrir orçamento</Link>}
      </nav>
    </section>

    {order && <section className="card p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-ink/55">Pedido vinculado</p><h2 className="mt-1 text-xl font-black">{order.order_number}</h2></div><StatusBadge value={order.operational_status} /></div>
      {order.next_action && <p className="mt-4 text-sm"><b>Próxima ação:</b> {order.next_action}</p>}
      {order.blocked_reason && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{order.blocked_reason}</p>}
      {access["order_checklist_items:select"] && <p className="mt-3 text-sm text-ink/55">{checklist.filter(item => item.status === "concluido").length} de {checklist.length} etapas concluídas</p>}
      <Link href={`/pedidos/${order.id}#checklist-operacional`} className="button-ghost mt-4">Acompanhar etapas do pedido</Link>
    </section>}

    {hasMeasurements && <section id="conferencia-medidas" className="card scroll-mt-28 p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-xl font-black"><Ruler size={20} /> Conferência de medidas</h2>{measurementStep && <StatusBadge value={measurementStep.status} />}</div>
      <p className="mt-3 text-sm text-ink/60">Confira as medidas da obra com o orçamento antes de liberar a produção.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {quote && <Link href={`/orcamentos/${quote.id}`} className="button-ghost">Ver peças e medidas do orçamento</Link>}
        {access["clients:select"] && <Link href={`/clientes/${sale.client_id}/ficha-visita`} className="button-ghost">Emitir ficha de conferência</Link>}
      </div>
      {measurements.length > 0 && <ul className="mt-5 divide-y">{measurements.map(measurement => <li key={measurement.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-semibold">{measurement.measurement_number || "Medição vinculada"}</p><p className="mt-1 text-xs text-ink/55">{measurement.scheduled_at ? shortDate(measurement.scheduled_at) : "Sem agendamento"}</p></div><StatusBadge value={measurement.status} /><Link href={`/medicoes/${measurement.id}`} className="button-ghost">Abrir medição</Link></li>)}</ul>}
      {measurementStep && order && (access["order_checklist_items:update"] ? <form className="mt-5 border-t pt-5">
        <input type="hidden" name="id" value={measurementStep.id} /><input type="hidden" name="order_id" value={order.id} /><input type="hidden" name="status" value={measurementStep.status} /><input type="hidden" name="_back" value={back} />
        <ConfirmButton formAction={toggleChecklistItem} className={measurementStep.status === "concluido" ? "button-ghost" : "button"}
          message={measurementStep.status === "concluido" ? "Reabrir a conferência de medidas deste pedido?" : "Você conferiu as medidas da obra com o orçamento? Confirmar esta etapa do pedido?"}>
          <CheckCircle2 size={16} />{measurementStep.status === "concluido" ? "Reabrir conferência" : "Confirmar medidas conferidas"}
        </ConfirmButton>
      </form> : <p className="mt-5 text-sm text-ink/55">Seu acesso permite consultar esta etapa, mas não alterá-la.</p>)}
    </section>}

    {access["financial_entries:select"] && <section id="contas-da-venda" className="card scroll-mt-28 p-5 sm:p-7"><h2 className="text-xl font-black">Contas a receber desta venda</h2>
      {entries.length ? <div className="mt-5 divide-y">{entries.map(entry => <article key={entry.id} className="flex flex-wrap items-center justify-between gap-4 py-4"><div className="min-w-0"><h3 className="font-semibold">{entry.description}</h3><p className="mt-1 text-sm text-ink/55">Vencimento: {shortDate(entry.due_date)} · Recebido: {money(Number(entry.paid_amount))}</p><p className="mt-1 font-bold">Em aberto: {money(Number(entry.open_amount))}</p></div><StatusBadge value={entry.status} />{canPay && Number(entry.open_amount) > 0 && entry.status !== "cancelado" && (pendingEntries.length === 1 ? <a href="#topo-venda" className="button-ghost">Ir para registrar pagamento</a> : payment(entry))}</article>)}</div> : <p className="mt-4 text-sm text-ink/55">Nenhuma conta a receber disponível para esta venda.</p>}
      {!canPay && pendingEntries.length > 0 && <p className="mt-4 text-sm text-ink/55">Seu acesso não permite registrar pagamentos.</p>}
    </section>}
  </div>;
}
function MissingSale() { return <div className="card mx-auto max-w-2xl p-8"><h1 className="text-2xl font-black">Venda não encontrada</h1><p className="mt-2 text-sm text-ink/55">Verifique o endereço e seu acesso à venda.</p><Link className="button-ghost mt-4" href="/vendas">Voltar às vendas</Link></div>; }
