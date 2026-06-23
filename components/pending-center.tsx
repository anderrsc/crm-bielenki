import { createClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";
import { AlertCircle, AlertTriangle, ArrowRight, CalendarCheck, ClipboardList, FileText, Ruler, ShoppingCart, TrendingDown, WalletCards } from "lucide-react";
import Link from "next/link";

type PendingItem = {
  record_id: string;
  category: string;
  priority: string;
  title: string;
  subtitle: string;
  link: string;
  due_date: string | null;
  days_late: number | null;
  amount: number | null;
  client_name: string | null;
};

const CAT_CONFIG: Record<string, { label: string; icon: typeof FileText; color: string }> = {
  orcamento:          { label: "Orçamento",    icon: FileText,      color: "text-blue-600 bg-blue-50 border-blue-200" },
  financeiro_receber: { label: "A Receber",    icon: WalletCards,   color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  financeiro_pagar:   { label: "A Pagar",      icon: TrendingDown,  color: "text-orange-600 bg-orange-50 border-orange-200" },
  producao:           { label: "Produção",      icon: ClipboardList, color: "text-violet-600 bg-violet-50 border-violet-200" },
  compra:             { label: "Compra",        icon: ShoppingCart,  color: "text-amber-600 bg-amber-50 border-amber-200" },
  instalacao:         { label: "Instalação",    icon: CalendarCheck, color: "text-sky-600 bg-sky-50 border-sky-200" },
  medicao:            { label: "Medição",       icon: Ruler,         color: "text-indigo-600 bg-indigo-50 border-indigo-200" },
};

const PRIORITY_COLOR: Record<string, string> = {
  high:   "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low:    "bg-slate-100 text-slate-600 border-slate-200",
};
const PRIORITY_LABEL: Record<string, string> = { high: "URGENTE", medium: "ATENÇÃO", low: "PENDENTE" };

export async function PendingCenter({ category }: { category?: string }) {
  let items: PendingItem[] = [];
  let loadError = "";

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await createClient();
    const { data, error } = await db.rpc("pending_center");
    if (error) loadError = error.message;
    items = (data as PendingItem[]) ?? [];
  }

  const filtered = category
    ? items.filter(i => i.category === category || i.category.startsWith(category))
    : items;

  const counts: Record<string, number> = {};
  for (const i of items) {
    const key = i.category.replace("financeiro_", "financeiro");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const totalHigh = items.filter(i => i.priority === "high").length;

  const TABS = [
    { key: "",           label: "Todos",       count: items.length },
    { key: "orcamento",  label: "Orçamentos",  count: counts.orcamento ?? 0 },
    { key: "financeiro", label: "Financeiro",  count: (counts["financeiro_receber"] ?? 0) + (counts["financeiro_pagar"] ?? 0) },
    { key: "producao",   label: "Produção",    count: counts.producao ?? 0 },
    { key: "compra",     label: "Compras",     count: counts.compra ?? 0 },
    { key: "instalacao", label: "Instalações", count: counts.instalacao ?? 0 },
    { key: "medicao",    label: "Medições",    count: counts.medicao ?? 0 },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Gestão operacional</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Central de Pendências</h1>
        <p className="mt-1 text-sm text-ink/50">Tudo que precisa de ação imediata — em um só lugar.</p>
      </div>

      {loadError && (
        <div className="mb-6 rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-700 font-mono">
          {loadError}
        </div>
      )}

      {totalHigh > 0 && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-3.5">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-bold text-red-800">
            {totalHigh} item{totalHigh !== 1 ? "s" : ""} urgente{totalHigh !== 1 ? "s" : ""} exige{totalHigh === 1 ? "" : "m"} ação imediata
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.filter(t => t.key === "" || t.count > 0).map(t => (
          <Link
            key={t.key}
            href={t.key ? `/pendencias?categoria=${t.key}` : "/pendencias"}
            className={`flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-semibold transition
              ${(category ?? "") === t.key
                ? "bg-forest text-white border-forest"
                : "bg-white border-sand hover:bg-cream text-ink"}`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black leading-none
                ${(category ?? "") === t.key ? "bg-white/20 text-white" : "bg-ink/10 text-ink"}`}>
                {t.count}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {filtered.length === 0 && !loadError && (
          <div className="card p-16 text-center">
            <p className="mb-3 text-4xl">✅</p>
            <p className="text-lg font-bold">Tudo em dia!</p>
            <p className="mt-1 text-sm text-ink/50">Nenhuma pendência encontrada nesta categoria.</p>
          </div>
        )}
        {filtered.map(item => {
          const cfg = CAT_CONFIG[item.category] ?? CAT_CONFIG.orcamento;
          const { icon: Icon } = cfg;
          return (
            <Link
              href={item.link}
              key={item.record_id}
              className="card flex items-center gap-4 p-4 transition hover:-translate-y-px hover:shadow-md"
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${cfg.color}`}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold">{item.title}</p>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-black ${PRIORITY_COLOR[item.priority] ?? PRIORITY_COLOR.low}`}>
                    {PRIORITY_LABEL[item.priority] ?? "PENDENTE"}
                  </span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cfg.color}`}>
                    {cfg.label}
                  </span>
                </div>
                <p className="text-sm text-ink/55">{item.subtitle}</p>
                {item.client_name && <p className="mt-0.5 text-xs text-ink/40">{item.client_name}</p>}
              </div>
              <div className="hidden shrink-0 text-right sm:block">
                {item.amount != null && item.amount > 0 && (
                  <p className="text-sm font-bold">{money(item.amount)}</p>
                )}
                {item.due_date && (
                  <p className={`text-xs font-medium ${item.days_late != null && item.days_late > 0 ? "text-red-600" : "text-ink/45"}`}>
                    {item.days_late != null && item.days_late > 0
                      ? <><AlertTriangle className="mr-0.5 inline h-3 w-3" />{item.days_late}d de atraso</>
                      : shortDate(item.due_date)}
                  </p>
                )}
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink/25" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
