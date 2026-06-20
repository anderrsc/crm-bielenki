"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label = "Imprimir / salvar PDF" }: { label?: string }) {
  return <button type="button" className="button no-print" onClick={() => window.print()}><Printer className="h-4 w-4" />{label}</button>;
}
