"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, CheckCircle2, ListChecks, Printer, RotateCcw } from "lucide-react";
import { setOrderInstaller, setOsPrint } from "@/app/(crm)/service-order-actions";
import type { ServiceOrderSheet as Data } from "@/lib/service-order";
import { OS_CSS, OsCard, OsSheets } from "./os-card";

const OUT = "nome:";
const NEW = "__novo";
const when = (v: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(v));

/** Escolhe o instalador de uma OS (usuário do CRM ou nome de fora). */
export function InstallerPicker({ data, onSaved }: { data: Data; onSaved?: () => void }) {
  const router = useRouter();
  const [installer, setInstaller] = useState(data.installerName ? OUT + data.installerName : data.installerId ?? "");
  const [typing, setTyping] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  function save(value: string) {
    if (!data.orderId) return;
    const prev = installer;
    setInstaller(value); setMsg("");
    const external = value.startsWith(OUT);
    start(async () => {
      const r = await setOrderInstaller({ saleId: data.saleId, orderId: data.orderId!, profileId: external ? null : value || null, name: external ? value.slice(OUT.length) : null });
      if (r.error) { setInstaller(prev); setMsg(r.error); } else { setMsg("Salvo."); onSaved?.(); router.refresh(); }
    });
  }
  const options = data.people.some(p => p.id === installer) || !installer || installer.startsWith(OUT) ? data.people : [{ id: installer, full_name: data.installer ?? "(inativo)" }, ...data.people];
  const finish = () => { const n = (typing ?? "").trim(); setTyping(null); if (n) save(OUT + n); };
  return <span className="flex flex-wrap items-end gap-2">
    <label className="flex flex-col gap-1"><span className="label">Instalador{data.number ? ` · ${data.number}` : ""}</span>
      <select className="field p-2 text-sm" value={installer} disabled={pending || !data.canEdit || !data.installerColumn} onChange={e => e.target.value === NEW ? setTyping("") : save(e.target.value)}>
        <option value="">Não definido (preencher à mão)</option>
        {options.map(p => <option key={p.id} value={p.id}>{p.full_name || "Sem nome"}</option>)}
        {data.installerName && <option value={OUT + data.installerName}>{data.installerName} (de fora)</option>}
        <option value={NEW}>+ Outro instalador (sem usuário)…</option>
      </select>
    </label>
    {typing !== null && <>
      <input autoFocus value={typing} onChange={e => setTyping(e.target.value)} placeholder="Nome do instalador" className="field p-2 text-sm"
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); finish(); } if (e.key === "Escape") setTyping(null); }} />
      <button type="button" className="button" onClick={finish}>Salvar</button>
    </>}
    {msg && <span className="os-msg">{msg}</span>}
  </span>;
}


/**
 * Impressão com confirmação obrigatória: ao mandar imprimir, a OS fica "enviada" no banco e esta janela
 * não fecha até responder. Se sair da página sem responder, a OS aparece como "impressão não confirmada"
 * na fila e no painel, até alguém confirmar.
 */
function usePrintConfirm(ids: string[], startOpen: boolean, onDone: (count: number) => void) {
  const [open, setOpen] = useState(startOpen);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open]);
  function print() {
    setMsg("");
    if (!ids.length) { window.print(); return; }
    start(async () => {
      const r = await setOsPrint(ids, "enviada");
      if (r.error) { setMsg(r.error); return; }
      setOpen(true);
      window.print();
    });
  }
  function confirm() {
    start(async () => { const r = await setOsPrint(ids, "impressa"); if (r.error) setMsg(r.error); else { setOpen(false); onDone(r.count); } });
  }
  const dialog = open && <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="os-confirm-title">
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
      <h2 id="os-confirm-title" className="text-lg font-semibold">A impressão saiu certinha?</h2>
      <p className="mt-2 text-sm text-ink/70">{ids.length === 1 ? "Esta ordem de serviço" : `Estas ${ids.length} ordens de serviço`} só saem da fila depois que você confirmar. Até lá, ficam marcadas como <b>impressão não confirmada</b>.</p>
      <div className="mt-5 flex flex-col gap-2">
        <button type="button" className="button justify-center" disabled={pending} onClick={confirm}><CheckCircle2 size={16} /> Sim, saiu impressa</button>
        <button type="button" className="button-ghost justify-center" disabled={pending} onClick={() => window.print()}><RotateCcw size={16} /> Não saiu — imprimir de novo</button>
      </div>
      {msg && <p className="mt-3 text-sm text-red-700">{msg}</p>}
    </div>
  </div>;
  return { print, dialog, pending, msg };
}

/** Ordem de serviço de um pedido. Imprime 1, 2 ou 4 vias na mesma folha A4. */
export function ServiceOrderSheet({ data, fresh = false }: { data: Data; fresh?: boolean }) {
  const router = useRouter();
  const [copies, setCopies] = useState(1);
  const [done, setDone] = useState("");
  const pendingConfirm = Boolean(data.orderId && data.printSentAt && !data.printedAt);
  const ids = data.orderId && !data.printedAt ? [data.orderId] : [];
  const { print, dialog, pending, msg } = usePrintConfirm(ids, pendingConfirm, () => { setDone("Impressão confirmada. A OS saiu da fila."); router.refresh(); });

  return <main className="os-page">
    <style>{OS_CSS}</style>
    <div className="os-toolbar no-print">
      <div className="flex flex-wrap gap-2">
        <Link href={`/vendas/${data.saleId}`} className="button-ghost"><ArrowLeft size={16} /> Voltar à venda</Link>
        <Link href="/ordens-servico" className="button-ghost"><ListChecks size={16} /> Fila de ordens de serviço</Link>
      </div>
      {fresh && <p className="os-fresh">Pedido fechado. A ordem de serviço entrou na fila de impressão.</p>}
      {done && <p className="os-fresh">{done}</p>}
      <p className="os-msg">{data.printedAt ? `Impressa em ${when(data.printedAt)}.` : data.queuedAt ? "Na fila de impressão." : ""}</p>
      <div className="os-controls">
        <InstallerPicker data={data} />
        <label><span className="label">Vias na folha A4</span>
          <select className="field p-2 text-sm" value={copies} onChange={e => setCopies(Number(e.target.value))}>
            <option value={1}>1 via</option><option value={2}>2 vias (escritório + equipe)</option><option value={4}>4 vias</option>
          </select>
        </label>
        <button type="button" className="button" disabled={pending} onClick={print}><Printer size={16} /> Imprimir só esta</button>
      </div>
      {!data.installerColumn && <p className="os-warn">Para salvar o instalador falta aplicar a atualização do banco. A OS já pode ser impressa e o instalador preenchido à mão.</p>}
      {msg && <p className="os-warn">{msg}</p>}
    </div>
    {dialog}
    <OsSheets cards={Array.from({ length: copies }, (_, i) => <OsCard key={i} data={data} via={copies > 1 ? i + 1 : undefined} />)} />
  </main>;
}

/** Várias ordens de serviço: 4 por folha A4. Depois de imprimir, tira da fila. */
export function ServiceOrderBatch({ list }: { list: Data[] }) {
  const router = useRouter();
  const sheets = Math.ceil(list.length / 4);
  const ids = list.filter(d => d.orderId && !d.printedAt).map(d => d.orderId!);
  const unconfirmed = list.some(d => d.printSentAt && !d.printedAt);
  const { print, dialog, pending, msg } = usePrintConfirm(ids, unconfirmed, count =>
    router.push(`/ordens-servico?ok=${encodeURIComponent(`Impressão confirmada: ${count} ordem(ns) de serviço saíram da fila.`)}`));

  return <main className="os-page">
    <style>{OS_CSS}</style>
    <div className="os-toolbar no-print">
      <Link href="/ordens-servico" className="button-ghost self-start"><ArrowLeft size={16} /> Voltar à fila</Link>
      <p className="os-fresh">{list.length} {list.length === 1 ? "ordem de serviço" : "ordens de serviço"} · {sheets} {sheets === 1 ? "folha A4" : "folhas A4"} (4 por folha)</p>
      <details><summary className="cursor-pointer text-sm font-semibold">Definir instaladores antes de imprimir</summary>
        <div className="mt-3 flex flex-col gap-3">{list.map(d => <InstallerPicker key={d.saleId} data={d} />)}</div>
      </details>
      <div className="os-controls"><button type="button" className="button" disabled={pending} onClick={print}><Printer size={16} /> Imprimir / salvar PDF</button></div>
      {msg && <p className="os-warn">{msg}</p>}
    </div>
    {dialog}
    <OsSheets cards={list.map(d => <OsCard key={d.saleId} data={d} />)} />
  </main>;
}
