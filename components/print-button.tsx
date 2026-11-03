"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label = "Imprimir / salvar PDF" }: { label?: string }) {
  async function waitForImages(container: ParentNode) {
    const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
    await Promise.all(
      images.map((img) => {
        return img.decode().catch(() => undefined);
      })
    );
  }

  async function handlePrint() {
    const printArea = document.querySelector(".print-sheet") ?? document.body;
    await Promise.all([waitForImages(printArea), document.fonts.ready]);
    window.print();
  }
  return <button type="button" className="button no-print" onClick={handlePrint}><Printer className="h-4 w-4" />{label}</button>;
}
