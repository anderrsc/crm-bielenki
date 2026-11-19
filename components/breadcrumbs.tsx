"use client";
// Migalhas de pão: onde estou e como voltar sem perder o lugar (ex.: Compras › Compra › Nova).
import Link from "next/link";
import { ChevronRight } from "lucide-react";

const WORDS: Record<string, string> = {
  novo: "Novo", nova: "Nova", calhas: "Calhas", esquadrias: "Esquadrias", canais: "WhatsApp", receber: "A receber", pagar: "A pagar",
  conciliacao: "Conciliação", extrato: "Extrato", recorrencias: "Recorrências", relatorios: "Relatórios", configuracoes: "Configurações",
  funcionarios: "Funcionários", cargos: "Cargos", medicoes: "Medições", "materiais-do-pedido": "Materiais do pedido", "ficha-visita": "Ficha de visita",
};
const isId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) || /^\d+$/.test(s);

export function breadcrumbTrail(pathname: string, sectionLabel: (href: string) => string | undefined) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return [];
  const trail: Array<{ label: string; href: string | null }> = [{ label: "Início", href: "/dashboard" }];
  parts.forEach((seg, i) => {
    const href = "/" + parts.slice(0, i + 1).join("/");
    const label = i === 0 ? sectionLabel(href) ?? WORDS[seg] ?? decodeURIComponent(seg) : isId(seg) ? "Detalhe" : WORDS[seg] ?? decodeURIComponent(seg).replace(/-/g, " ");
    trail.push({ label: label.charAt(0).toUpperCase() + label.slice(1), href: i === parts.length - 1 ? null : href });
  });
  return trail;
}

export function Breadcrumbs({ pathname, sectionLabel }: { pathname: string; sectionLabel: (href: string) => string | undefined }) {
  const trail = breadcrumbTrail(pathname, sectionLabel);
  if (!trail.length) return null;
  return (
    <nav aria-label="Você está em" className="no-print mb-3 flex flex-wrap items-center gap-1 text-xs text-ink/55">
      {trail.map((t, i) => (
        <span key={`${t.label}-${i}`} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
          {t.href ? <Link href={t.href} className="hover:text-ink hover:underline">{t.label}</Link> : <span aria-current="page" className="font-bold text-ink/80">{t.label}</span>}
        </span>
      ))}
    </nav>
  );
}
