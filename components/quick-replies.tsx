"use client";
// Respostas prontas no Atendimento: botão ⚡ ou "/" no começo da mensagem.
import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, Zap } from "lucide-react";
import { deleteQuickReply, listQuickReplies, saveQuickReply, type QuickReply } from "@/app/(crm)/quick-replies-actions";
import { fillQuickReply } from "@/lib/quick-replies";

export function QuickReplies({ query, open, onOpen, onClose, contactName, onPick }: {
  /** Texto depois da "/" (null = não está digitando atalho). */
  query: string | null; open: boolean; onOpen: () => void; onClose: () => void;
  contactName: string | null; onPick: (text: string) => void;
}) {
  const [replies, setReplies] = useState<QuickReply[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id?: string; shortcut: string; body: string } | null>(null);
  const visible = open || query !== null;

  useEffect(() => {
    if (!visible || replies) return;
    listQuickReplies().then((r) => (r.ok ? setReplies(r.replies) : setErro(r.error)));
  }, [visible, replies]);

  const filtered = useMemo(() => (replies ?? []).filter((r) => !query || r.shortcut.startsWith(query) || r.body.toLowerCase().includes(query)), [replies, query]);

  async function salvar() {
    if (!editando) return;
    const r = await saveQuickReply(editando);
    if (!r.ok) return setErro(r.error);
    setErro(null);
    setReplies((cur) => editando.id ? (cur ?? []).map((x) => (x.id === r.reply.id ? r.reply : x)) : [...(cur ?? []), r.reply]);
    setEditando(null);
  }
  async function apagar(id: string) {
    if (!window.confirm("Apagar esta resposta pronta?")) return;
    const r = await deleteQuickReply(id);
    if (!r.ok) return setErro(r.error);
    setReplies((cur) => (cur ?? []).filter((x) => x.id !== id));
  }

  return (
    <div className="relative">
      <button type="button" onClick={visible ? onClose : onOpen} className="rounded-xl bg-cream p-3 text-ink/70" aria-label="Respostas prontas" title="Respostas prontas (ou digite / na mensagem)">
        <Zap className="h-5 w-5" />
      </button>
      {visible && (
        <div className="absolute bottom-14 left-0 z-20 max-h-[60vh] w-[min(26rem,85vw)] overflow-y-auto rounded-2xl border border-sand/80 bg-surface p-2 shadow-xl">
          <div className="mb-1 flex items-center justify-between px-2 pt-1">
            <p className="text-xs font-black uppercase text-ink/50">Respostas prontas</p>
            <button type="button" onClick={() => setEditando({ shortcut: "", body: "" })} className="flex items-center gap-1 text-xs font-bold text-forest"><Plus className="h-3.5 w-3.5" /> Nova</button>
          </div>
          {erro && <p className="m-2 rounded-lg bg-red-500/10 p-2 text-xs text-red-500">{erro}</p>}
          {!replies && !erro && <p className="p-3 text-xs text-ink/50">Carregando…</p>}
          {editando && (
            <div className="m-1 space-y-2 rounded-xl bg-cream p-2">
              <input value={editando.shortcut} onChange={(e) => setEditando({ ...editando, shortcut: e.target.value })} placeholder="atalho (ex.: pix)" className="field w-full p-2 text-sm" />
              <textarea value={editando.body} onChange={(e) => setEditando({ ...editando, body: e.target.value })} rows={4} placeholder="Mensagem. Use {nome} para o nome do cliente." className="field w-full p-2 text-sm" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditando(null)} className="px-2 text-xs font-bold text-ink/60">Cancelar</button>
                <button type="button" onClick={salvar} className="rounded-lg bg-forest px-3 py-1.5 text-xs font-bold text-white">Salvar</button>
              </div>
            </div>
          )}
          {filtered.map((r) => (
            <div key={r.id} className="group flex items-start gap-1 rounded-xl hover:bg-cream">
              <button type="button" onClick={() => { onPick(fillQuickReply(r.body, contactName)); onClose(); }} className="min-w-0 flex-1 p-2 text-left">
                <p className="text-xs font-black text-forest">/{r.shortcut}</p>
                <p className="line-clamp-2 text-xs text-ink/70">{r.body}</p>
              </button>
              <button type="button" onClick={() => setEditando({ id: r.id, shortcut: r.shortcut, body: r.body })} className="p-2 text-ink/40 hover:text-ink" aria-label="Editar"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => apagar(r.id)} className="p-2 text-ink/40 hover:text-red-500" aria-label="Apagar"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {replies && !filtered.length && <p className="p-3 text-xs text-ink/50">Nenhum atalho com "{query}". Toque em Nova para criar.</p>}
        </div>
      )}
    </div>
  );
}
