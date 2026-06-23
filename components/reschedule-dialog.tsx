"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, X } from "lucide-react";
import { rescheduleEntry } from "@/app/(crm)/actions";

export function RescheduleDialog({ entryId, currentDueDate }: { entryId: string; currentDueDate: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-lg border border-sand bg-white px-2 py-1 text-xs font-semibold text-ink/60 hover:border-forest hover:text-forest transition"
        title="Renegociar vencimento"
      >
        <CalendarClock className="h-3.5 w-3.5" />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="font-black text-lg">Renegociar vencimento</h2>
                <p className="text-xs text-ink/50 mt-0.5">Altere a data de vencimento do lançamento</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-cream"><X className="h-4 w-4" /></button>
            </div>
            <form action={rescheduleEntry} onSubmit={() => setOpen(false)} className="space-y-4">
              <input type="hidden" name="entry_id" value={entryId} />
              <div>
                <label className="label">Nova data de vencimento *</label>
                <input
                  className="field"
                  type="date"
                  name="new_due_date"
                  defaultValue={currentDueDate?.slice(0, 10) ?? ""}
                  min={new Date().toISOString().slice(0, 10)}
                  required
                />
              </div>
              <div>
                <label className="label">Motivo (opcional)</label>
                <input className="field" name="reason" placeholder="Ex: Acordo com cliente, aguardando pagamento..." maxLength={200} />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="button-ghost flex-1">Cancelar</button>
                <button type="submit" className="button flex-1">Salvar nova data</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
