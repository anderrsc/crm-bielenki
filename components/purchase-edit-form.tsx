"use client";
// Formulário de correção da compra: fornecedor, previsão, destino, observação e itens.
import { useState } from "react";
import { editPurchase } from "@/app/(crm)/purchase-edit-actions";
import { money } from "@/lib/utils";
import { PURCHASE_TYPES } from "@/components/manual-purchase-form";

type Item = { id: string; description: string; category: string; quantity: number; unit_price: number };
export function PurchaseEditForm({ id, supplierId, suppliers, expectedAt, notes, orderId, orders, items: initial, locked }: {
  id: string; supplierId: string; suppliers: { id: string; name: string }[]; expectedAt: string; notes: string; orderId: string;
  orders: { id: string; label: string }[]; items: Item[]; locked: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [supplier, setSupplier] = useState(supplierId);
  const [expected, setExpected] = useState(expectedAt);
  const [obs, setObs] = useState(notes);
  const [order, setOrder] = useState(orderId);
  const total = items.reduce((t, x) => t + x.quantity * x.unit_price, 0);
  const set = (i: number, patch: Partial<Item>) => setItems((cur) => cur.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const payload = JSON.stringify({ supplier_id: supplier, expected_at: expected, notes: obs, order_id: order, items });
  return <form action={editPurchase} className="mt-4 space-y-4">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="payload" value={payload} />
    <div className="grid gap-3 sm:grid-cols-3">
      <div><label className="label" htmlFor="pe-forn">Fornecedor</label><select id="pe-forn" className="field" value={supplier} onChange={(e) => setSupplier(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div><label className="label" htmlFor="pe-prev">Previsão de entrega</label><input id="pe-prev" className="field" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
      <div><label className="label" htmlFor="pe-ped">É para</label><select id="pe-ped" className="field" value={order} onChange={(e) => setOrder(e.target.value)}><option value="">Estoque</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
    </div>
    {locked && <p className="rounded-lg bg-amber-50 p-2 text-xs font-bold text-amber-800">Material já recebido: quantidade e valor dos itens não mudam.</p>}
    {items.map((it, i) => <div key={it.id} className="grid gap-2 rounded-xl border border-sand p-3 sm:grid-cols-[1fr_1.4fr_90px_110px]">
      <select aria-label="Tipo" className="field" value={it.category} onChange={(e) => set(i, { category: e.target.value })}>{[...new Set([it.category, ...PURCHASE_TYPES])].filter(Boolean).map((t) => <option key={t}>{t}</option>)}</select>
      <input aria-label="Descrição" className="field" value={it.description} onChange={(e) => set(i, { description: e.target.value })} required />
      <input aria-label="Quantidade" className="field" type="number" min="0.001" step="0.001" value={it.quantity} disabled={locked} onChange={(e) => set(i, { quantity: Number(e.target.value) })} required />
      <input aria-label="Valor unitário" className="field" type="number" min="0" step="0.01" value={it.unit_price} disabled={locked} onChange={(e) => set(i, { unit_price: Number(e.target.value) })} required />
    </div>)}
    <div><label className="label" htmlFor="pe-obs">Observações</label><textarea id="pe-obs" className="field min-h-16" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
    <div className="flex items-center justify-between"><strong>Novo total: {money(total)}</strong><button className="button">Salvar correção</button></div>
  </form>;
}
