"use client";
// Visões salvas das listas: guarda a combinação de busca e filtros com um nome (por pessoa, neste navegador).
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, X } from "lucide-react";

type View = { name: string; qs: string };
const IGNORED = new Set(["erro", "ok", "salvo", "aviso", "criado", "senha"]);
export const SAVED_VIEW_PAGES = ["/clientes", "/orcamentos", "/vendas", "/pedidos", "/compras", "/fornecedores", "/estoque", "/financeiro/receber", "/financeiro/pagar", "/producao", "/servicos"];

export function SavedViews() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const key = `marquinhos-views:${pathname}`;
  const [views, setViews] = useState<View[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => { try { setViews(JSON.parse(localStorage.getItem(key) || "[]")); } catch { setViews([]); } setNaming(false); }, [key]);

  const clean = new URLSearchParams([...params.entries()].filter(([k]) => !IGNORED.has(k)));
  const qs = clean.toString();
  const save = (next: View[]) => { setViews(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch {} };
  const active = views.find((v) => v.qs === qs);
  if (!qs && !views.length) return null;

  return (
    <div className="no-print mb-3 flex flex-wrap items-center gap-2 text-xs" aria-label="Visões salvas">
      {views.length > 0 && <span className="inline-flex items-center gap-1 font-semibold text-ink/50"><Bookmark className="h-3.5 w-3.5" /> Minhas visões</span>}
      {views.map((v) => (
        <span key={v.name} className={`inline-flex items-center overflow-hidden rounded-full border ${active?.name === v.name ? "border-forest bg-forest/10" : "border-sand"}`}>
          <button type="button" className="px-2.5 py-1 font-semibold" aria-pressed={active?.name === v.name} onClick={() => router.push(v.qs ? `${pathname}?${v.qs}` : pathname)}>{v.name}</button>
          <button type="button" aria-label={`Apagar visão ${v.name}`} className="px-1.5 py-1 text-ink/40 hover:text-red-500" onClick={() => save(views.filter((x) => x.name !== v.name))}><X className="h-3 w-3" /></button>
        </span>
      ))}
      {qs && !active && !naming && <button type="button" className="rounded-full border border-dashed border-sand px-2.5 py-1 font-semibold text-forest" onClick={() => setNaming(true)}>Salvar estes filtros</button>}
      {naming && (
        <form className="inline-flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const n = name.trim().slice(0, 24); if (!n) return; save([...views.filter((v) => v.name !== n), { name: n, qs }].slice(-8)); setName(""); setNaming(false); }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Nome da visão" aria-label="Nome da visão" className="field w-36 py-1 text-xs" />
          <button className="rounded-lg bg-forest px-2.5 py-1 font-semibold text-white">Salvar</button>
        </form>
      )}
    </div>
  );
}
