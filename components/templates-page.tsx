"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  FileText, Eye, Copy, Star, RotateCcw, CheckCircle2,
  Clock, FileCheck, ChevronRight, Settings2, Printer, FileDown
} from "lucide-react";
import {
  setTemplateDefault,
  duplicateTemplate,
  restoreTemplateDefaults,
} from "@/app/(crm)/identity-actions";

/* ─── Tipos ──────────────────────────────────────────────────────────────── */
export type DocumentTemplate = {
  id: string;
  name: string;
  type: string;
  status: "em_uso" | "rascunho" | "desativado";
  is_default: boolean;
  config: Record<string, unknown>;
  updated_at: string;
};

/* ─── Config de tipos ────────────────────────────────────────────────────── */
const TYPE_META: Record<string, { label: string; icon: typeof FileText; printHref: string; color: string }> = {
  orcamento_calhas:      { label: "Orçamento de Calhas",      icon: FileText,  printHref: "/orcamentos/calhas",   color: "bg-blue-50 text-blue-700 border-blue-200" },
  orcamento_esquadrias:  { label: "Orçamento de Esquadrias",   icon: FileText,  printHref: "/orcamentos/esquadrias",color: "bg-violet-50 text-violet-700 border-violet-200" },
  ficha_medicao:         { label: "Ficha de Medição",          icon: FileCheck, printHref: "/medicoes/ficha-em-branco", color: "bg-green-50 text-green-700 border-green-200" },
  ficha_medicao_branco:  { label: "Ficha de Medição em Branco",icon: FileCheck, printHref: "/ficha/branco",        color: "bg-teal-50 text-teal-700 border-teal-200" },
  pedido:                { label: "Pedido de Venda",           icon: FileText,  printHref: "/vendas",              color: "bg-amber-50 text-amber-700 border-amber-200" },
  ordem_producao:        { label: "Ordem de Produção",         icon: FileText,  printHref: "/producao",            color: "bg-orange-50 text-orange-700 border-orange-200" },
  ordem_instalacao:      { label: "Ordem de Instalação",       icon: FileText,  printHref: "/instalacoes",         color: "bg-rose-50 text-rose-700 border-rose-200" },
  contrato:              { label: "Contrato",                  icon: FileText,  printHref: "/contratos",           color: "bg-gray-50 text-gray-700 border-gray-200" },
};

const STATUS_META = {
  em_uso:     { label: "Em uso",     color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  rascunho:   { label: "Rascunho",   color: "bg-amber-50 text-amber-700 border-amber-200",       icon: Clock },
  desativado: { label: "Desativado", color: "bg-gray-50 text-gray-500 border-gray-200",           icon: Clock },
};

function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

/* ─── Componente principal ───────────────────────────────────────────────── */
export function TemplatesPage({ templates }: { templates: DocumentTemplate[] }) {
  // Agrupa por tipo
  const byType = Object.entries(TYPE_META).map(([type, meta]) => ({
    type, meta,
    items: templates.filter(t => t.type === type),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Visual</p>
          <h1 className="mt-1 text-3xl font-black">Templates do sistema</h1>
          <p className="mt-1 text-sm text-ink/50">
            Gerencie os modelos de documentos usados em orçamentos, fichas e impressões.
          </p>
        </div>
        <Link href="/configuracoes/identidade" className="button-ghost flex items-center gap-2 text-sm">
          <Settings2 className="h-4 w-4" /> Identidade visual
        </Link>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-3 rounded-xl border bg-cream p-4 text-xs">
        {Object.entries(STATUS_META).map(([k, v]) => (
          <span key={k} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-semibold ${v.color}`}>
            <v.icon className="h-3.5 w-3.5" /> {v.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-ink/40 ml-auto">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> = Template padrão (em uso)
        </span>
      </div>

      {/* Grupos por tipo */}
      <div className="space-y-10">
        {byType.map(({ type, meta, items }) => (
          <section key={type}>
            <div className="mb-3 flex items-center gap-3">
              <span className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-bold ${meta.color}`}>
                <meta.icon className="h-4 w-4" />
                {meta.label}
              </span>
              <ChevronRight className="h-4 w-4 text-ink/30" />
              <span className="text-sm text-ink/40">{items.length} modelo{items.length !== 1 ? "s" : ""}</span>
            </div>

            {items.length === 0 ? (
              <div className="card p-6 text-center text-sm text-ink/40">
                Nenhum modelo encontrado. Execute a migration 031 no Supabase para criar os templates padrão.
              </div>
            ) : (
              <div className="space-y-3">
                {items.map(tpl => (
                  <TemplateCard key={tpl.id} template={tpl} type={type} printHref={meta.printHref} />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

/* ─── Card individual do template ────────────────────────────────────────── */
function TemplateCard({ template, type, printHref }: { template: DocumentTemplate; type: string; printHref: string }) {
  const [isPending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState(template.status);
  const [isDefault, setIsDefault] = useState(template.is_default);
  const [error, setError] = useState("");
  const [duplicated, setDuplicated] = useState(false);
  const [restored, setRestored] = useState(false);

  const statusMeta = STATUS_META[localStatus] ?? STATUS_META.rascunho;

  const handleSetDefault = () => {
    startTransition(async () => {
      const result = await setTemplateDefault(template.id, type);
      if (result?.error) { setError(result.error); return; }
      setIsDefault(true);
      setLocalStatus("em_uso");
    });
  };

  const handleDuplicate = () => {
    startTransition(async () => {
      const result = await duplicateTemplate(template.id);
      if (result?.error) { setError(result.error); return; }
      setDuplicated(true);
      setTimeout(() => setDuplicated(false), 3000);
    });
  };

  const handleRestore = () => {
    startTransition(async () => {
      const result = await restoreTemplateDefaults(template.id);
      if (result?.error) { setError(result.error); return; }
      setRestored(true);
      setTimeout(() => setRestored(false), 3000);
    });
  };

  return (
    <div className={`card p-4 transition-all ${isDefault ? "ring-2 ring-forest/20" : ""} ${isPending ? "opacity-60" : ""}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Info */}
        <div className="flex items-start gap-3 min-w-0">
          {isDefault && <Star className="mt-0.5 h-4 w-4 shrink-0 fill-amber-400 text-amber-400" />}
          {!isDefault && <Star className="mt-0.5 h-4 w-4 shrink-0 text-ink/15" />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold">{template.name}</p>
              <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${statusMeta.color}`}>
                <statusMeta.icon className="h-3 w-3" /> {statusMeta.label}
              </span>
            </div>
            <p className="text-xs text-ink/40 mt-0.5">Atualizado em {fmtDate(template.updated_at)}</p>
            {/* Config resumida */}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink/50">
              {template.config.show_logo !== false && <span>Logo: ✓</span>}
              {!!template.config.logo_width && <span>Largura logo: {String(template.config.logo_width)}mm</span>}
              {!!template.config.logo_align && <span>Alinhamento: {String(template.config.logo_align)}</span>}
              {template.config.show_footer !== false && <span>Rodapé: ✓</span>}
            </div>
          </div>
        </div>

        {/* Ações */}
        <div className="flex flex-wrap gap-2 shrink-0">
          {/* Visualizar */}
          <Link href={printHref} target="_blank"
            className="flex items-center gap-1.5 rounded-xl border border-sand bg-white px-3 py-2 text-xs font-semibold hover:bg-cream">
            <Eye className="h-3.5 w-3.5" /> Visualizar
          </Link>

          {/* Imprimir prévia */}
          <Link href={printHref} target="_blank"
            className="flex items-center gap-1.5 rounded-xl border border-sand bg-white px-3 py-2 text-xs font-semibold hover:bg-cream">
            <Printer className="h-3.5 w-3.5" /> Imprimir
          </Link>

          {/* Duplicar */}
          <button onClick={handleDuplicate} disabled={isPending}
            className="flex items-center gap-1.5 rounded-xl border border-sand bg-white px-3 py-2 text-xs font-semibold hover:bg-cream disabled:opacity-50">
            <Copy className="h-3.5 w-3.5" />
            {duplicated ? "Duplicado!" : "Duplicar"}
          </button>

          {/* Restaurar padrão */}
          <button onClick={handleRestore} disabled={isPending}
            className="flex items-center gap-1.5 rounded-xl border border-sand bg-white px-3 py-2 text-xs font-semibold hover:bg-cream disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" />
            {restored ? "Restaurado!" : "Restaurar"}
          </button>

          {/* Definir como padrão */}
          {!isDefault && (
            <button onClick={handleSetDefault} disabled={isPending}
              className="flex items-center gap-1.5 rounded-xl bg-forest px-3 py-2 text-xs font-semibold text-white hover:bg-[#18221e] disabled:opacity-50">
              <Star className="h-3.5 w-3.5" /> Definir padrão
            </button>
          )}
          {isDefault && (
            <span className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Em uso
            </span>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
