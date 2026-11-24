"use client";
// Ctrl+K / ⌘K: ir para qualquer tela, criar algo novo ou buscar no sistema, sem tirar a mão do teclado.
// Só lista o que o usuário pode ver (mesma regra do menu).
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, CornerDownLeft, Plus, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PaletteItem = { label: string; href: string; icon: LucideIcon; group: string; keywords?: string };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function CommandPalette({ items }: { items: PaletteItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
    };
    const onOpen = () => setOpen(true);
    addEventListener("keydown", onKey);
    addEventListener("open-command-palette", onOpen);
    return () => { removeEventListener("keydown", onKey); removeEventListener("open-command-palette", onOpen); };
  }, []);
  useEffect(() => { if (open) { setQ(""); setActive(0); } }, [open]);

  const results = useMemo(() => {
    const t = norm(q.trim());
    const found = t ? items.filter((i) => norm(`${i.label} ${i.group} ${i.keywords ?? ""}`).includes(t)) : items.filter((i) => i.group === "Criar" || i.group === "Ir para").slice(0, 12);
    const list = found.slice(0, 30);
    // Sempre dá para buscar o texto digitado em clientes, orçamentos, pedidos…
    if (q.trim().length >= 2) list.push({ label: `Buscar "${q.trim()}" no sistema`, href: `/busca?q=${encodeURIComponent(q.trim())}`, icon: Search, group: "Busca" });
    return list;
  }, [q, items]);
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const go = (item?: PaletteItem) => { if (!item) return; setOpen(false); router.push(item.href); };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-fade-in fixed inset-0 z-[80] bg-black/50" />
        <Dialog.Content aria-describedby={undefined} className="ui-fade-in fixed left-1/2 top-[12vh] z-[81] w-[calc(100%-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-sand bg-surface text-ink shadow-2xl">
          <Dialog.Title className="sr-only">Comandos rápidos</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-sand px-4">
            <Search className="h-4 w-4 shrink-0 text-ink/50" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ir para, criar ou buscar…" aria-label="Comando ou busca"
              role="combobox" aria-expanded="true" aria-controls="command-palette-list" aria-activedescendant={results[active] ? `cmd-${active}` : undefined}
              className="min-w-0 flex-1 bg-transparent py-3.5 text-[15px] outline-none !shadow-none"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
              }} />
            <kbd className="rounded border border-sand px-1.5 py-0.5 text-[11px] text-ink/50">Esc</kbd>
          </div>
          <ul id="command-palette-list" role="listbox" ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
            {results.length === 0 && <li className="p-6 text-center text-sm text-ink/55">Nada encontrado. Digite pelo menos 2 letras para buscar no sistema.</li>}
            {results.map((item, i) => {
              const Icon = item.icon;
              const head = i === 0 || results[i - 1].group !== item.group;
              return (
                <li key={`${item.group}-${item.href}`} role="presentation">
                  {head && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-ink/45">{item.group}</p>}
                  <button type="button" id={`cmd-${i}`} role="option" aria-selected={i === active} data-index={i}
                    onMouseMove={() => setActive(i)} onClick={() => go(item)}
                    className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm", i === active ? "bg-cream" : "")}>
                    {item.group === "Criar" ? <Plus className="h-4 w-4 shrink-0 text-forest" /> : <Icon className="h-4 w-4 shrink-0 text-ink/60" />}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {i === active ? <CornerDownLeft className="h-3.5 w-3.5 text-ink/40" /> : <ArrowRight className="h-3.5 w-3.5 text-transparent" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="hidden border-t border-sand px-4 py-2 text-[11px] text-ink/45 sm:block">↑ ↓ para escolher · Enter para abrir · Ctrl K abre e fecha</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
