"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveFinancialAllocations } from "@/app/(crm)/financial-allocation-actions";
import { SubmitButton } from "@/components/submit-button";
import { money } from "@/lib/utils";

type Option = { id: string; name: string };
export type AllocationRow = { order_id: string; cost_center_id: string; amount: number };
type Line = { order_id: string; cost_center_id: string; value: string };

const toNumber = (v: string) => { const n = Number(v.replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const cents = (n: number) => Math.round(n * 100);

/** Rateio de uma conta entre obras e centros de custos; so salva quando fecha o total. */
export function FinancialAllocationForm({ entryId, total, orders, centers, initial }: { entryId: string; total: number; orders: Option[]; centers: Option[]; initial: AllocationRow[] }) {
  const [mode, setMode] = useState<"amount" | "percent">("amount");
  const [lines, setLines] = useState<Line[]>(() => initial.length
    ? initial.map((r) => ({ order_id: r.order_id, cost_center_id: r.cost_center_id, value: String(r.amount).replace(".", ",") }))
    : [{ order_id: "", cost_center_id: "", value: "" }]);
  const sum = useMemo(() => lines.reduce((s, l) => s + toNumber(l.value), 0), [lines]);
  const target = mode === "percent" ? 100 : total;
  const diff = (cents(target) - cents(sum)) / 100;
  const complete = lines.every((l) => (l.order_id || l.cost_center_id) && toNumber(l.value) > 0);
  const closes = lines.length > 0 && complete && cents(sum) === cents(target);
  const set = (i: number, patch: Partial<Line>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const payload = JSON.stringify(lines.map((l) => ({ order_id: l.order_id, cost_center_id: l.cost_center_id, [mode]: toNumber(l.value) })));
  const show = (n: number) => (mode === "percent" ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%` : money(n));

  return <form action={saveFinancialAllocations} className="space-y-4">
    <input type="hidden" name="entry_id" value={entryId} /><input type="hidden" name="mode" value={mode} /><input type="hidden" name="rows" value={payload} />
    <div className="flex flex-wrap gap-2 text-sm">
      {(["amount", "percent"] as const).map((m) => <button key={m} type="button" onClick={() => { setMode(m); setLines((cur) => cur.map((l) => ({ ...l, value: "" }))); }}
        className={mode === m ? "button" : "button-ghost"}>{m === "amount" ? "Por valor (R$)" : "Por percentual (%)"}</button>)}
    </div>
    <div className="space-y-2">
      {lines.map((l, i) => <div key={i} className="grid gap-2 rounded-xl border border-sand p-3 sm:grid-cols-[2fr_2fr_1fr_auto]">
        <div><label className="label">Obra / pedido</label><select className="field" value={l.order_id} onChange={(e) => set(i, { order_id: e.target.value })} aria-label={`Obra da linha ${i + 1}`}><option value="">Sem obra</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <div><label className="label">Centro de custos</label><select className="field" value={l.cost_center_id} onChange={(e) => set(i, { cost_center_id: e.target.value })} aria-label={`Centro de custos da linha ${i + 1}`}><option value="">Sem centro</option>{centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label">{mode === "percent" ? "Percentual" : "Valor"}</label><input className="field" inputMode="decimal" value={l.value} onChange={(e) => set(i, { value: e.target.value })} placeholder={mode === "percent" ? "50" : "0,00"} aria-label={`Valor da linha ${i + 1}`} /></div>
        <button type="button" title="Remover linha" className="button-ghost self-end p-2 text-red-600" onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
      </div>)}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="button-ghost" onClick={() => setLines((cur) => [...cur, { order_id: "", cost_center_id: "", value: diff > 0 ? String(diff).replace(".", ",") : "" }])}><Plus className="h-4 w-4" /> Adicionar linha</button>
      <p role="status" className={`text-sm font-bold ${closes || !lines.length ? "text-emerald-700" : "text-red-700"}`}>
        {!lines.length ? "Sem linhas: salvar remove o rateio." : closes ? `Fecha o total: ${show(sum)}` : diff > 0 ? `Faltam ${show(diff)}` : diff < 0 ? `Passou ${show(-diff)}` : "Preencha obra ou centro e o valor em todas as linhas."}
      </p>
    </div>
    <SubmitButton className="button" disabled={lines.length > 0 && !closes}>{lines.length ? "Salvar rateio" : "Remover rateio"}</SubmitButton>
  </form>;
}
