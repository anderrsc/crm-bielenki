"use client";
// Envia o PDF da proposta do WVetro: itens, cliente e observações entram no orçamento para conferir.
import { useRef, useState } from "react";
import { FileUp, Loader2, UserPlus } from "lucide-react";
import { createClientFromProposal, readWvetroProposal, type ProposalResult } from "@/app/(crm)/wvetro-actions";

export type ProposalRead = Extract<ProposalResult, { ok: true }> & { file: File };

export function WvetroImport({ onRead, onClient }: { onRead: (r: ProposalRead) => void; onClient: (c: { id: string; name: string }) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<ProposalRead | null>(null);
  const [creating, setCreating] = useState(false);

  async function send(file: File) {
    setBusy(true); setError(""); setPending(null);
    const form = new FormData(); form.set("file", file);
    try {
      const r = await readWvetroProposal(form);
      if (!r.ok) { setError(r.error); return; }
      const read = { ...r, file };
      onRead(read);
      if (!r.client && r.proposal.cliente.nome) setPending(read);
    } catch { setError("Não foi possível ler a proposta. Tente de novo."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  async function register() {
    if (!pending) return;
    setCreating(true); setError("");
    const c = pending.proposal.cliente;
    const r = await createClientFromProposal({ nome: c.nome ?? "", telefone: c.telefone, celular: c.celular, email: c.email, endereco: c.endereco, bairro: c.bairro, cidade: c.cidade, uf: c.uf, cep: c.cep, documento: c.documento, numero: pending.proposal.numero }).catch(() => ({ ok: false as const, error: "Não foi possível cadastrar o cliente." }));
    setCreating(false);
    if (r.ok) { onClient(r.client); setPending(null); } else setError(r.error);
  }

  return <div className="card flex flex-wrap items-center justify-between gap-3 border-dashed p-4">
    <div className="min-w-0 flex-1"><p className="font-bold">Tem a proposta do WVetro?</p><p className="text-sm text-ink/60">Envie o PDF: cliente, esquadrias, medidas, vidros e observações entram sozinhos para você conferir.</p></div>
    <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" aria-label="PDF da proposta do WVetro" onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); }} />
    <button type="button" className="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" />Lendo a proposta…</> : <><FileUp className="h-4 w-4" />Importar PDF do WVetro</>}</button>
    {pending && <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      <span>O cliente <b>{pending.proposal.cliente.nome}</b> ainda não está cadastrado{pending.proposal.cliente.cidade ? ` (${pending.proposal.cliente.cidade}${pending.proposal.cliente.uf ? `/${pending.proposal.cliente.uf}` : ""})` : ""}.</span>
      <button type="button" className="button-ghost bg-white" disabled={creating} onClick={() => void register()}>{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}Cadastrar e usar</button>
    </div>}
    {error && <p role="alert" className="w-full rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
  </div>;
}
