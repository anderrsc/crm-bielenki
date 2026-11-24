"use client";
import { useState } from "react";
import { editManualSale } from "@/app/(crm)/sale-edit-actions";
import { money } from "@/lib/utils";

type Item = { id: string; description: string; quantity: number; unit_price: number };
export function SaleEditForm({ id, clientId, clients, dueDate, notes, items: initial }: { id: string; clientId: string; clients: { id: string; name: string }[]; dueDate: string; notes: string; items: Item[] }) {
  const [items, setItems] = useState(initial);
  const [client, setClient] = useState(clientId);
  const [due, setDue] = useState(dueDate);
  const [obs, setObs] = useState(notes);
  const set = (i: number, patch: Partial<Item>) => setItems((cur) => cur.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const total = items.reduce((t, x) => t + x.quantity * x.unit_price, 0);
  return <form action={editManualSale} className="fx-stack mt-4">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="payload" value={JSON.stringify({ client_id: client, due_date: due, notes: obs, items })} />
    <div className="fx-grid fx-grid-2">
      <div><label className="label" htmlFor="se-cli">Cliente</label><select id="se-cli" className="field" value={client} onChange={(e) => setClient(e.target.value)}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div><label className="label" htmlFor="se-venc">Vencimento</label><input id="se-venc" className="field" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
    </div>
    {items.map((it, i) => <div key={it.id} className="fx-item fx-item-edit fx-item-edit-3">
      <input aria-label="Descrição" className="field" value={it.description} onChange={(e) => set(i, { description: e.target.value })} />
      <input aria-label="Quantidade" className="field" type="number" min="0.001" step="0.001" value={it.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} required />
      <input aria-label="Valor unitário" className="field" type="number" min="0" step="0.01" value={it.unit_price} onChange={(e) => set(i, { unit_price: Number(e.target.value) })} required />
    </div>)}
    <div><label className="label" htmlFor="se-obs">Observações</label><textarea id="se-obs" className="field min-h-16" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
    <div className="fx-footer"><strong>Novo total: {money(total)}</strong><button className="button">Salvar correção</button></div>
  </form>;
}
