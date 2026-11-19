"use client";
// Etiquetas de conversa: chips coloridos na lista e menu para marcar/desmarcar na conversa aberta.
import { useEffect, useState, useTransition } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Plus, Tag } from "lucide-react";
import { createConversationLabel, listConversationLabels, setConversationLabel, type ConversationLabel } from "@/app/(crm)/conversation-label-actions";
import { cn } from "@/lib/utils";

const COLOR: Record<string, string> = {
  slate: "bg-slate-500/15 text-slate-500", red: "bg-red-500/15 text-red-500", amber: "bg-amber-500/15 text-amber-600",
  green: "bg-green-500/15 text-green-600", blue: "bg-blue-500/15 text-blue-500", purple: "bg-purple-500/15 text-purple-500",
};
const PALETTE = ["blue", "green", "amber", "red", "purple", "slate"] as const;

export function LabelChip({ label }: { label: { name: string; color: string } }) {
  return <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold", COLOR[label.color] ?? COLOR.slate)}>{label.name}</span>;
}

export function LabelMenu({ conversationId, current, onChanged }: { conversationId: string; current: Array<{ id: string }>; onChanged: () => void }) {
  const [labels, setLabels] = useState<ConversationLabel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState("");
  const [cor, setCor] = useState<(typeof PALETTE)[number]>("blue");
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const marcadas = new Set(current.map((l) => l.id));

  useEffect(() => {
    if (!open || labels) return;
    void listConversationLabels().then((r) => { if ("labels" in r) setLabels(r.labels); else setErro(r.error); });
  }, [open, labels]);

  const alternar = (l: ConversationLabel) => start(async () => {
    const r = await setConversationLabel(conversationId, l.id, !marcadas.has(l.id));
    if ("error" in r) setErro(r.error); else { setErro(null); onChanged(); }
  });
  const criar = () => start(async () => {
    if (!novo.trim()) return;
    const r = await createConversationLabel(novo, cor);
    if ("error" in r) { setErro(r.error); return; }
    setLabels((cur) => [...(cur ?? []), r.label].sort((a, b) => a.name.localeCompare(b.name)));
    setNovo(""); setErro(null);
    const marcou = await setConversationLabel(conversationId, r.label.id, true);
    if ("error" in marcou) setErro(marcou.error); else onChanged();
  });

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button className="wa-row wa-muted relative rounded-full p-2" title="Etiquetas" aria-label="Etiquetas da conversa"><Tag className="h-4 w-4" />
          {current.length > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-forest px-1 text-[9px] font-bold text-white">{current.length}</span>}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-60 rounded-xl border border-sand bg-surface p-1.5 text-sm text-ink shadow-xl">
          {!labels && !erro && <p className="px-3 py-2 text-xs text-ink/55">Carregando…</p>}
          {labels?.map((l) => (
            <DropdownMenu.Item key={l.id} disabled={pending} onSelect={(e) => { e.preventDefault(); alternar(l); }} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none focus:bg-cream">
              <span className="flex h-4 w-4 items-center justify-center">{marcadas.has(l.id) && <Check className="h-4 w-4 text-forest" />}</span>
              <LabelChip label={l} />
            </DropdownMenu.Item>
          ))}
          <div className="mt-1 border-t border-sand p-2" onKeyDown={(e) => e.stopPropagation()}>
            <div className="flex gap-1.5">
              <input value={novo} onChange={(e) => setNovo(e.target.value)} maxLength={30} placeholder="Nova etiqueta" aria-label="Nome da nova etiqueta"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); criar(); } }} className="field min-w-0 flex-1 py-1 text-xs" />
              <button type="button" disabled={pending || !novo.trim()} onClick={criar} aria-label="Criar etiqueta" className="rounded-lg bg-forest px-2 text-white disabled:opacity-50"><Plus className="h-4 w-4" /></button>
            </div>
            <div className="mt-1.5 flex gap-1" role="radiogroup" aria-label="Cor da etiqueta">
              {PALETTE.map((c) => <button key={c} type="button" role="radio" aria-checked={cor === c} aria-label={c} onClick={() => setCor(c)} className={cn("h-5 w-5 rounded-full border-2", COLOR[c].split(" ")[0], cor === c ? "border-ink" : "border-transparent")} />)}
            </div>
            {erro && <p className="mt-1.5 text-xs text-red-500">{erro}</p>}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
