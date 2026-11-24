"use client";
// Envia o PDF/foto da nota para a IA ler e preencher a Nova compra.
import { useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { readInvoice, type InvoiceResult } from "@/app/(crm)/invoice-reader-actions";

export function InvoiceUpload({ onRead }: { onRead: (r: Extract<InvoiceResult, { ok: true }>) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(file: File) {
    setBusy(true); setError("");
    const form = new FormData(); form.set("file", file);
    try {
      const r = await readInvoice(form);
      if (r.ok) onRead(r); else setError(r.error);
    } catch { setError("Não foi possível ler a nota. Tente de novo."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  return <div className="card mb-5 flex flex-wrap items-center justify-between gap-3 border-dashed p-4">
    <div><p className="font-semibold">Tem a nota fiscal?</p><p className="text-sm text-ink/60">Envie o PDF ou uma foto da nota: a IA preenche fornecedor, itens e vencimento para você conferir.</p></div>
    <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" aria-label="Arquivo da nota" onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); }} />
    <button type="button" className="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" />Lendo a nota…</> : <><FileText className="h-4 w-4" />Ler nota (PDF ou foto)</>}</button>
    {error && <p role="alert" className="w-full rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
  </div>;
}
