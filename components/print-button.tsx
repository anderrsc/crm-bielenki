"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label = "Imprimir / salvar PDF" }: { label?: string }) {
  async function waitForImages(container: ParentNode) {
    const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
    await Promise.all(
      images.map((img) => {
        if (img.complete && img.naturalWidth > 0) return img.decode?.().catch(() => undefined) ?? Promise.resolve();
        return new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      })
    );
  }

  async function handlePrint() {
    const printArea = document.querySelector(".print-sheet") ?? document.body;
    await waitForImages(printArea);
    window.print();
  }
  return <button type="button" className="button no-print" onClick={handlePrint}><Printer className="h-4 w-4" />{label}</button>;
}
