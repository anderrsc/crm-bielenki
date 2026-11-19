"use client";
// Avisos curtos ("Salvo", "Não foi possível…") no canto da tela, sem bloquear o trabalho.
// Só mostram o que já aconteceu de verdade: chame depois da resposta do servidor.
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "success" | "error" | "info";
type Toast = { id: number; kind: Kind; text: string };
let seq = 0;
const listeners = new Set<(t: Toast) => void>();

function push(kind: Kind, text: string) {
  const t = { id: ++seq, kind, text: text.slice(0, 240) };
  listeners.forEach((l) => l(t));
}
export const toast = {
  success: (text: string) => push("success", text),
  error: (text: string) => push("error", text),
  info: (text: string) => push("info", text),
};

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  const params = useSearchParams();
  const pathname = usePathname();
  useEffect(() => {
    const add = (t: Toast) => {
      setItems((prev) => [...prev.slice(-2), t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), t.kind === "error" ? 7000 : 3500);
    };
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);
  // Ações de formulário que voltam com ?salvo=1 / ?ok=… confirmam aqui também.
  const query = params.toString();
  useEffect(() => {
    const q = new URLSearchParams(query);
    const ok = q.get("ok");
    if (q.get("salvo") === "1" || q.get("criado") === "1") toast.success("Salvo.");
    else if (ok) toast.success(ok);
  }, [query, pathname]);
  return (
    <div aria-live="polite" role="status" className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6 md:right-6 md:left-auto md:items-end">
      {items.map((t) => (
        <div key={t.id} className={cn("ui-pop-in pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl border bg-surface px-3 py-2.5 text-sm shadow-lg",
          t.kind === "error" ? "border-red-500/40" : "border-sand")}>
          {t.kind === "error" ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />}
          <p className="min-w-0 flex-1 break-words">{t.text}</p>
          <button type="button" aria-label="Fechar aviso" className="-m-1 rounded p-1 text-ink/50 hover:text-ink" onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );
}
