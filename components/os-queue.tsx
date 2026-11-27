"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Printer, RotateCcw } from "lucide-react";
import { setOsPrint } from "@/app/(crm)/service-order-actions";

export type OsRow = { orderId: string; saleId: string; number: string; client: string; place: string; service: string; installer: string | null; closedAt: string; deadline: string | null; printedAt: string | null; unconfirmed: boolean; queued: boolean };

const br = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") : v ?? "");
const when = (v: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(v));

/** Lista com seleção: imprime as marcadas, 4 por folha A4. */
export function OsQueue({ rows, filtro }: { rows: OsRow[]; filtro: string }) {
  const router = useRouter();
  const [sel, setSel] = useState<string[]>(() => filtro === "fila" ? rows.slice(0, 4).map(r => r.saleId) : []);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const sheets = Math.ceil(sel.length / 4);
  const ordered = rows.filter(r => sel.includes(r.saleId));

  function step(ids: string[], s: "impressa" | "fila", ok: (n: number) => string) {
    start(async () => {
      const r = await setOsPrint(ids, s);
      setMsg(r.error ?? ok(r.count)); setSel([]); router.refresh();
    });
  }
  const backToQueue = () => step(ordered.map(o => o.orderId), "fila", n => `${n} ordem(ns) voltaram para a fila.`);
  const unconfirmed = rows.filter(r => r.unconfirmed);

  if (!rows.length) return <div className="card p-8 text-center text-sm text-ink/60">{filtro === "fila" ? "Nenhuma ordem de serviço na fila. Quando um pedido for fechado, ela aparece aqui." : "Nenhuma ordem de serviço encontrada."}</div>;

  return <section className="space-y-3">
    {unconfirmed.length > 0 && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={18} /> {unconfirmed.length} ordem(ns) mandada(s) para impressão sem confirmação</p>
      <p className="mt-1">Confira se saíram da impressora. Enquanto não confirmar, elas continuam aqui e no painel.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="button" disabled={pending} onClick={() => step(unconfirmed.map(r => r.orderId), "impressa", n => `Impressão confirmada: ${n} ordem(ns) saíram da fila.`)}><CheckCircle2 size={16} /> Saíram impressas — confirmar</button>
        <Link className="button-ghost" href={`/ordens-servico/imprimir?vendas=${unconfirmed.map(r => r.saleId).join(",")}`}><Printer size={16} /> Não saíram — imprimir de novo</Link>
      </div>
    </div>}
    <div className="card sticky top-2 z-10 flex flex-wrap items-center gap-2 p-3">
      <span className="text-sm font-semibold">{sel.length} selecionada(s){sel.length ? ` · ${sheets} folha(s) A4` : ""}</span>
      <button type="button" className="button-ghost" onClick={() => setSel(rows.slice(0, 4).map(r => r.saleId))}>Marcar as 4 primeiras</button>
      {sel.length > 0 && <button type="button" className="button-ghost" onClick={() => setSel([])}>Limpar</button>}
      <span className="ml-auto flex flex-wrap gap-2">
        {ordered.some(o => o.printedAt) && <button type="button" className="button-ghost" disabled={pending} onClick={backToQueue}><RotateCcw size={16} /> Voltar para a fila</button>}
        {sel.length > 0
          ? <Link className="button" href={`/ordens-servico/imprimir?vendas=${ordered.map(o => o.saleId).join(",")}`}><Printer size={16} /> Imprimir selecionadas</Link>
          : <span className="button pointer-events-none opacity-50"><Printer size={16} /> Imprimir selecionadas</span>}
      </span>
    </div>
    {msg && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{msg}</p>}
    <ul className="card divide-y">
      {rows.map(r => <li key={r.orderId} className={`flex items-start gap-3 p-4${r.unconfirmed ? " bg-red-50/60" : ""}`}>
        <input type="checkbox" className="mt-1 h-5 w-5" checked={sel.includes(r.saleId)} onChange={() => toggle(r.saleId)} aria-label={`Selecionar ${r.number}`} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2"><b>{r.client}</b><span className="text-xs text-ink/55">{r.number}</span>
            {r.printedAt ? <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs">Impressa {when(r.printedAt)}</span> : r.unconfirmed ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Impressão não confirmada</span> : r.queued ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Na fila</span> : null}</p>
          <p className="mt-1 text-sm text-ink/70">{r.service}{r.place ? ` · ${r.place}` : ""}</p>
          <p className="mt-1 text-xs text-ink/55">Fechado {br(r.closedAt)} · Prazo {br(r.deadline) || "a combinar"} · Instalador: {r.installer || "não definido"}</p>
        </div>
        <Link href={`/vendas/${r.saleId}/os`} className="button-ghost shrink-0">Ver OS</Link>
      </li>)}
    </ul>
  </section>;
}
