import Link from "next/link";
import { getRequestClient } from "@/lib/supabase/server";

const ITEMS: { key: string; label: string; href: string; alert?: boolean }[] = [
  { key: "aguardando_decisao", label: "Pedidos sem definição de medidas", href: "/agenda" },
  { key: "conferencias_sem_data", label: "Conferências sem data", href: "/agenda" },
  { key: "aguardando_validacao", label: "Medidas aguardando validação", href: "/agenda", alert: true },
  { key: "aguardando_corte", label: "Aguardando corte", href: "/producao" },
  { key: "em_producao", label: "Em produção", href: "/producao" },
  { key: "producao_atrasada", label: "Produções atrasadas", href: "/producao", alert: true },
  { key: "instalacoes_pendentes", label: "Instalações pendentes", href: "/producao" },
  { key: "manutencoes_abertas", label: "Serviços em aberto", href: "/servicos?filtro=abertos" },
  { key: "manutencoes_urgentes", label: "Serviços urgentes", href: "/servicos?filtro=urgentes", alert: true },
  { key: "servicos_concluidos_mes", label: "Serviços concluídos no mês", href: "/servicos?filtro=concluidos" },
];

/** Painel de acompanhamento: cada numero abre os registros correspondentes. */
export async function OperationalIndicators() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const db = await getRequestClient();
  const { data, error } = await db.rpc("operational_indicators");
  if (error || !data) return null;
  const values = data as Record<string, number>;
  return <section aria-label="Painel de acompanhamento" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
    {ITEMS.map((item) => {
      const n = Number(values[item.key] ?? 0);
      const hot = item.alert && n > 0;
      return <Link key={item.key} href={item.href} className={`rounded-xl border p-3 transition hover:shadow-soft ${hot ? "border-red-200 bg-red-50/50" : "border-sand bg-surface"}`}>
        <p className={`text-2xl font-semibold ${hot ? "text-red-700" : n === 0 ? "text-ink/35" : ""}`}>{n}</p>
        <p className="text-xs font-semibold text-ink/60">{item.label}</p>
      </Link>;
    })}
  </section>;
}
