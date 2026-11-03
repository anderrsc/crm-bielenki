"use client";

import { useEffect } from "react";

// Erro inesperado numa pagina do CRM: mostra aviso com opcao de tentar de
// novo, sem derrubar o menu nem perder a navegacao.
export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800" role="alert">
      <p className="text-lg font-bold">Não foi possível carregar esta página.</p>
      <p className="mt-1 text-sm">Tente novamente. Se o problema continuar, avise o suporte{error.digest ? ` informando o código ${error.digest}` : ""}.</p>
      <button type="button" onClick={reset} className="mt-4 rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white">Tentar novamente</button>
    </div>
  );
}
