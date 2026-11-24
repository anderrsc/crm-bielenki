"use client";
// Marca/desmarca todas as caixas de um grupo dentro do mesmo formulário (seleção múltipla).
import { useRef } from "react";

export function CheckAll({ name, label = "Marcar todas" }: { name: string; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button ref={ref} type="button" className="text-xs font-semibold text-forest underline"
      onClick={() => {
        const boxes = [...(ref.current?.closest("form")?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]:not(:disabled)`) ?? [])];
        const all = boxes.length > 0 && boxes.every((b) => b.checked);
        boxes.forEach((b) => { b.checked = !all; });
      }}>{label}</button>
  );
}
