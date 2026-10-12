"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

// Baixa o PDF do orcamento direto como arquivo, mostrando "Gerando PDF..."
// enquanto o servidor responde (na hora so e lento se o cache estiver vazio).
export function QuotePdfButton({ quoteId, fileName }: { quoteId: string; fileName: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/orcamentos/${quoteId}/pdf`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setError("Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <button type="button" onClick={download} disabled={loading} className="button-ghost">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {loading ? "Gerando PDF..." : "Baixar PDF"}
      </button>
      {error && <span role="alert" className="absolute right-0 top-full mt-1 whitespace-nowrap text-xs font-semibold text-red-700">{error}</span>}
    </span>
  );
}
