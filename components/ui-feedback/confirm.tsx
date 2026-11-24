"use client";
// Confirmação própria do sistema (no lugar da janela do navegador): foco preso no diálogo,
// Esc cancela e o foco começa em "Voltar" (Enter não apaga nada por engano).
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Ask = { title?: string; message: string; confirmLabel?: string; danger?: boolean };
type Pending = Ask & { resolve: (ok: boolean) => void };
let host: ((p: Pending) => void) | null = null;

/**
 * Pergunta e espera a resposta. Fora do sistema (sem o diálogo montado) e em navegador
 * automatizado (testes) usa a janela do navegador, que os testes já sabem aceitar.
 */
export function confirmAction(ask: Ask | string): Promise<boolean> {
  const a = typeof ask === "string" ? { message: ask } : ask;
  if (!host || (typeof navigator !== "undefined" && navigator.webdriver)) return Promise.resolve(typeof window !== "undefined" && window.confirm(a.message));
  return new Promise((resolve) => host!({ ...a, resolve }));
}

export function ConfirmHost() {
  const [current, setCurrent] = useState<Pending | null>(null);
  const queue = useRef<Pending[]>([]);
  useEffect(() => {
    host = (p) => setCurrent((c) => { if (c) { queue.current.push(p); return c; } return p; });
    return () => { host = null; };
  }, []);
  const close = (ok: boolean) => {
    current?.resolve(ok);
    setCurrent(queue.current.shift() ?? null);
  };
  const danger = current?.danger ?? true;
  return (
    <Dialog.Root open={!!current} onOpenChange={(open) => { if (!open) close(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-fade-in fixed inset-0 z-[80] bg-black/50" />
        <Dialog.Content className="ui-fade-in fixed left-1/2 top-1/2 z-[81] w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-sand bg-surface p-5 text-ink shadow-2xl">
          <div className="flex gap-3">
            {danger && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500"><TriangleAlert className="h-5 w-5" /></span>}
            <div className="min-w-0">
              <Dialog.Title className="font-semibold">{current?.title ?? "Confirmar"}</Dialog.Title>
              <Dialog.Description className="mt-1 whitespace-pre-line text-sm text-ink/70">{current?.message}</Dialog.Description>
            </div>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="button-ghost" onClick={() => close(false)}>Voltar</button>
            <button type="button" className={cn("button", danger && "bg-red-600 hover:bg-red-700")} onClick={() => close(true)}>{current?.confirmLabel ?? "Confirmar"}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
