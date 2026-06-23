"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label = "Imprimir / salvar PDF" }: { label?: string }) {
  function handlePrint() {
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("img"));
    const pending = imgs.filter(img => !img.complete);
    if (!pending.length) { window.print(); return; }
    Promise.all(pending.map(img => new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); }))).then(() => window.print());
  }
  return <button type="button" className="button no-print" onClick={handlePrint}><Printer className="h-4 w-4" />{label}</button>;
}
