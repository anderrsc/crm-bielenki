"use client";
// Esqueleto exibido só enquanto a tela de verdade carrega (troca de página no servidor).
// Formato parecido com a tela que vem, para não "pular" quando ela aparece.
import { usePathname } from "next/navigation";

const Bar = ({ className = "" }: { className?: string }) => <div className={`ui-skeleton ${className}`} />;

function Lista({ rows = 8 }: { rows?: number }) {
  return (
    <div className="card divide-y divide-sand/60 overflow-hidden">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Bar className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2"><Bar className="h-3.5 w-2/5" /><Bar className="h-3 w-3/5" /></div>
          <Bar className="hidden h-3.5 w-20 sm:block" />
        </div>
      ))}
    </div>
  );
}

export default function Loading() {
  const path = usePathname() ?? "";
  const label = <span className="sr-only">Carregando…</span>;
  if (path.startsWith("/atendimento") && !path.startsWith("/atendimento/canais")) {
    return (
      <div role="status" aria-busy="true" className="flex h-[calc(100dvh-140px)] overflow-hidden rounded-2xl border border-sand">
        {label}
        <div className="w-full space-y-3 border-r border-sand p-3 md:w-[320px] xl:w-[360px]">
          <Bar className="h-7 w-32" /><Bar className="h-9 w-full" />
          {Array.from({ length: 9 }, (_, i) => <div key={i} className="flex gap-3 py-1.5"><Bar className="h-12 w-12 shrink-0 rounded-full" /><div className="flex-1 space-y-2 pt-1"><Bar className="h-3.5 w-3/5" /><Bar className="h-3 w-4/5" /></div></div>)}
        </div>
        <div className="hidden flex-1 flex-col justify-end gap-3 p-6 md:flex">
          <Bar className="h-10 w-1/3" /><Bar className="ml-auto h-10 w-2/5" /><Bar className="h-10 w-1/4" /><Bar className="mt-4 h-11 w-full" />
        </div>
      </div>
    );
  }
  const dashboard = path === "/" || path.startsWith("/dashboard") || path.startsWith("/financeiro") || path.startsWith("/relatorios");
  return (
    <div role="status" aria-busy="true" className="space-y-5">
      {label}
      <div className="space-y-2"><Bar className="h-3 w-28" /><Bar className="h-8 w-64 max-w-full" /></div>
      {dashboard && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="card space-y-3 p-4"><Bar className="h-3 w-24" /><Bar className="h-7 w-32" /></div>)}
        </div>
      )}
      <div className="flex gap-2"><Bar className="h-10 flex-1 sm:max-w-sm" /><Bar className="h-10 w-28" /></div>
      <Lista rows={dashboard ? 5 : 8} />
    </div>
  );
}
