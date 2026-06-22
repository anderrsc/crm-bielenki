"use client";

import { registerPayment } from "@/app/(crm)/actions";
import { localISODate } from "@/lib/utils";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";

export function PaymentDialog({ entryId, openAmount, interestAmount=0, discountAmount=0, installmentCount=1, firstDueDate }: { entryId: string; openAmount: number;interestAmount?:number;discountAmount?:number;installmentCount?:number;firstDueDate?:string|null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", close);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", close); document.body.style.overflow = previous; };
  }, [open]);

  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-forest px-3 py-1 text-xs font-bold text-white transition hover:opacity-80">
      Dar baixa
    </button>
    {open && createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-ink/60 p-4" role="presentation" onMouseDown={() => setOpen(false)}>
        <section role="dialog" aria-modal="true" aria-labelledby={`payment-${entryId}`} className="my-auto w-full max-w-md rounded-2xl border border-sand bg-white p-5 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
          <div className="mb-5 flex items-center justify-between">
            <h2 id={`payment-${entryId}`} className="text-xl font-black">Dar baixa</h2>
            <button type="button" aria-label="Fechar" onClick={() => setOpen(false)} className="button-ghost p-2"><X className="h-4 w-4" /></button>
          </div>
          <form action={registerPayment} className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
            <input type="hidden" name="entry_id" value={entryId} />
            <input type="hidden" name="_back" value="/financeiro" />
            <div><label className="label">Valor pago</label><input className="field" name="amount" type="number" step="0.01" min="0.01" max={openAmount} defaultValue={openAmount} required /></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="label">Juros</label><input className="field" name="interest" type="number" step="0.01" min="0" defaultValue={interestAmount}/></div><div><label className="label">Desconto</label><input className="field" name="discount" type="number" step="0.01" min="0" defaultValue={discountAmount}/></div></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="label">Parcelas</label><input className="field" name="installments" type="number" min="1" max="60" defaultValue={installmentCount}/></div><div><label className="label">1º vencimento</label><input className="field" name="first_due_date" type="date" defaultValue={firstDueDate||localISODate()} required/></div></div>
            <div><label className="label">Método</label><select className="field" name="payment_method">
              <option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="cartao_credito">Cartão de crédito</option>
              <option value="cartao_debito">Cartão de débito</option><option value="transferencia">Transferência</option><option value="boleto">Boleto</option><option value="cheque">Cheque</option>
            </select></div>
            <div><label className="label">Data do pagamento</label><input className="field" name="paid_at" type="date" defaultValue={localISODate()} required /></div>
            <div><label className="label">Observação</label><input className="field" name="notes" type="text" placeholder="Opcional..." /></div>
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
