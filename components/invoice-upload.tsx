"use client";
// Envia o PDF/foto da nota para a IA ler e preencher a Nova compra.
import { useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { readInvoice, type InvoiceResult } from "@/app/(crm)/invoice-reader-actions";

// A Vercel recusa corpo de requisição acima de ~4,5 MB: fotos grandes (iPhone) são reduzidas antes de enviar.
const SAFE_BYTES = 4 * 1024 * 1024;
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= SAFE_BYTES / 2) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}

export function InvoiceUpload({ onRead }: { onRead: (r: Extract<InvoiceResult, { ok: true }>) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(file: File) {
    setBusy(true); setError("");
    file = await shrinkImage(file);
    if (file.size > SAFE_BYTES) { setError("Arquivo grande demais (máx. 4 MB). Envie uma foto da nota ou um PDF menor."); setBusy(false); if (input.current) input.current.value = ""; return; }
    const form = new FormData(); form.set("file", file);
    try {
      const r = await readInvoice(form);
      if (r.ok) onRead(r); else setError(r.error);
    } catch { setError("A leitura demorou demais ou foi interrompida. Tente de novo; se repetir, envie uma foto mais leve da nota."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  return <div className="card mb-5 flex flex-wrap items-center justify-between gap-3 border-dashed p-4">
    <div><p className="font-semibold">Tem a nota fiscal?</p><p className="text-sm text-ink/60">Envie o PDF ou uma foto da nota: a IA preenche fornecedor, itens e vencimento para você conferir.</p></div>
    <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" aria-label="Arquivo da nota" onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); }} />
    <button type="button" className="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" />Lendo a nota…</> : <><FileText className="h-4 w-4" />Ler nota (PDF ou foto)</>}</button>
    {error && <p role="alert" className="w-full rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
  </div>;
}
