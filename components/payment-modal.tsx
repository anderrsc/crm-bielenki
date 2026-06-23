"use client";

import { useState } from "react";
import { registerPayment } from "@/app/(crm)/actions";
import { X } from "lucide-react";

export function PaymentModal({ entryId, openAmount }: { entryId: string; openAmount: number }) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().split("T")[0];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-forest px-3 py-1 text-xs font-bold text-white hover:opacity-80 transition"
      >
        Dar baixa
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-black text-ink">Registrar pagamento</h3>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 hover:bg-cream">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form action={registerPayment} className="space-y-3" onSubmit={() => setOpen(false)}>
              <input type="hidden" name="entry_id" value={entryId} />
              <input type="hidden" name="_back" value="/financeiro" />
              <div>
                <label className="label">Valor pago</label>
                <input className="field" name="amount" type="number" step="0.01" min="0.01"
                  defaultValue={openAmount} required />
              </div>
              <div>
                <label className="label">Método</label>
                <select className="field" name="payment_method">
                  <option value="pix">Pix</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="cartao_credito">Cartão de crédito</option>
                  <option value="cartao_debito">Cartão de débito</option>
                  <option value="transferencia">Transferência bancária</option>
                  <option value="boleto">Boleto</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className="label">Data do pagamento</label>
                <input className="field" name="paid_at" type="date" defaultValue={today} required />
              </div>
              <div>
                <label className="label">Observação</label>
                <input className="field" name="notes" type="text" placeholder="Opcional..." />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setOpen(false)}
                  className="flex-1 rounded-xl border border-sand bg-cream py-2 text-sm font-semibold hover:bg-sand/40 transition">
                  Cancelar
                </button>
                <button type="submit" className="button flex-1">Confirmar baixa</button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  );
}
