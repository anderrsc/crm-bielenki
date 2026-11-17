"use client";

import { registerPayment } from "@/app/(crm)/actions";
import { applySupplierCredit } from "@/app/(crm)/supplier-credit-actions";
import { money } from "@/lib/utils";
import { localISODate } from "@/lib/utils";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ReceivingAccountSelect } from "@/components/receiving-account-select";
import { useFormStatus } from "react-dom";

export function PaymentDialog({ entryId, openAmount, entryType="receber", interestAmount=0, discountAmount=0, installmentCount=1, firstDueDate, backHref, label="Dar baixa", buttonClassName, canOverpay=false, supplierCredit=0 }: { canOverpay?: boolean; supplierCredit?: number; entryId: string; openAmount: number;entryType?:string;interestAmount?:number;discountAmount?:number;installmentCount?:number;firstDueDate?:string|null;backHref?:string;label?:string;buttonClassName?:string }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(openAmount);
  const excess = canOverpay ? Math.round((amount - openAmount) * 100) / 100 : 0;
  const creditUse = Math.min(supplierCredit, openAmount);
  // Sem destino fixo: volta para a mesma pagina/aba em que a baixa foi feita.
  const [here, setHere] = useState("/financeiro");
  useEffect(() => { if (open) setHere(window.location.pathname + window.location.search); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", close);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", close); document.body.style.overflow = previous; };
  }, [open]);

  return <>
    <button type="button" onClick={() => setOpen(true)} className={buttonClassName ?? "rounded-lg bg-brand-strong px-3 py-1 text-xs font-bold text-white transition hover:opacity-80"}>
      {label}
    </button>
    {open && createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-cream/60 p-4" role="presentation" onMouseDown={() => setOpen(false)}>
        <section role="dialog" aria-modal="true" aria-labelledby={`payment-${entryId}`} className="my-auto w-full max-w-md rounded-2xl border border-sand bg-surface p-5 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
          <div className="mb-5 flex items-center justify-between">
            <h2 id={`payment-${entryId}`} className="text-xl font-black">{label}</h2>
            <button type="button" aria-label="Fechar" onClick={() => setOpen(false)} className="button-ghost p-2"><X className="h-4 w-4" /></button>
          </div>
          {supplierCredit > 0 && <form action={applySupplierCredit} className="mb-4 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <input type="hidden" name="entry_id" value={entryId} />
            <input type="hidden" name="_back" value={backHref ?? here} />
            <input type="hidden" name="paid_at" value={localISODate()} />
            <p className="text-sm font-bold text-emerald-800">Fornecedor tem {money(supplierCredit)} de crédito</p>
            <div className="flex gap-2"><input className="field" name="amount" type="number" step="0.01" min="0.01" max={creditUse} defaultValue={creditUse} aria-label="Valor do crédito a usar" required /><button className="button whitespace-nowrap">Usar crédito</button></div>
            <p className="text-xs text-emerald-800/80">Abate desta conta sem sair dinheiro do caixa.</p>
          </form>}
          <form action={registerPayment} className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
            <input type="hidden" name="entry_id" value={entryId} />
            <input type="hidden" name="_back" value={backHref ?? here} />
            <div><label className="label">Valor pago</label><input className="field" name="amount" type="number" step="0.01" min="0.01" max={canOverpay ? undefined : openAmount} value={amount} onChange={event => setAmount(Number(event.target.value))} required />
              {canOverpay && excess <= 0 && <p className="mt-1 text-xs text-ink/55">Pagou a mais? Digite o valor total pago: o que passar de {money(openAmount)} vira crédito com o fornecedor.</p>}
              {excess > 0 && <p className="mt-1 rounded-lg bg-amber-50 p-2 text-xs font-bold text-amber-800">{money(excess)} a mais vira crédito com o fornecedor (abate em contas futuras).</p>}</div>
            <div className="grid grid-cols-2 gap-3"><div><label className="label">Juros</label><input className="field" name="interest" type="number" step="0.01" min="0" defaultValue={interestAmount}/></div><div><label className="label">Desconto</label><input className="field" name="discount" type="number" step="0.01" min="0" defaultValue={discountAmount}/></div></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="label">Parcelas</label><input className="field" name="installments" type="number" min="1" max="60" defaultValue={installmentCount}/></div><div><label className="label">1º vencimento</label><input className="field" name="first_due_date" type="date" defaultValue={firstDueDate||localISODate()} required/></div></div>
            <div><label className="label">Método</label><select className="field" name="payment_method">
              <option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="cartao_credito">Cartão de crédito</option>
              <option value="cartao_debito">Cartão de débito</option><option value="transferencia">Transferência</option><option value="boleto">Boleto</option><option value="cheque">Cheque</option>
            </select></div>
            <div><label className="label">Data do pagamento</label><input className="field" name="paid_at" type="date" defaultValue={localISODate()} required /></div>
            <div><label className="label">{entryType === "pagar" ? "Conta que pagou" : "Conta que recebeu"}</label><ReceivingAccountSelect className="field" /></div>
            <div><label className="label">Observação</label><input className="field" name="notes" type="text" placeholder="Ex.: comprovante no WhatsApp, pago pela esposa…" /></div>
            <SubmitPayment />
          </form>
        </section>
      </div>, document.body,
    )}
  </>;
}

function SubmitPayment() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="button w-full">{pending ? "Registrando..." : "Confirmar baixa"}</button>;
}
