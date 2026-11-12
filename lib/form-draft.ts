"use client";
import { useEffect, useRef } from "react";

// Guarda o que foi digitado ao enviar; se a tela voltar com ?erro=, devolve tudo.
const TTL = 15 * 60_000;

function take(key: string): unknown {
  if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("erro")) return undefined;
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return undefined;
    const { at, v } = JSON.parse(raw);
    return Date.now() - at < TTL ? v : undefined;
  } catch { return undefined; }
}

function keep(key: string, v: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch { /* sem storage */ }
}

/** Formularios com estado React: devolve a funcao para chamar no envio. */
export function useErrorDraft<T>(key: string, snapshot: T, restore: (v: T) => void) {
  const snap = useRef(snapshot);
  snap.current = snapshot;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  useEffect(() => {
    const v = take(key);
    if (v !== undefined) restoreRef.current(v as T);
  }, [key]);
  return () => keep(key, snap.current);
}

/** Formularios comuns (campos com name): grava no envio e preenche de volta no erro. */
export function useFormMemory(key: string, ref: React.RefObject<HTMLElement | null>, skip: string[] = ["password", "senha"]) {
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const saved = take(key) as Record<string, string> | undefined;
    if (saved) {
      for (const el of Array.from(form.elements) as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
        if (!el.name || !(el.name in saved) || el.type === "hidden" || el.type === "file" || el.type === "password") continue;
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) el.checked = saved[el.name] === el.value;
        else {
          // Setter nativo: campos controlados pelo React tambem recebem o valor.
          const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, saved[el.name]);
        }
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      }
    }
    const onSubmit = () => {
      const data: Record<string, string> = {};
      new FormData(form).forEach((v, k) => { if (typeof v === "string" && !skip.some((s) => k.toLowerCase().includes(s))) data[k] = v; });
      keep(key, data);
    };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [key, ref, skip]);
}
