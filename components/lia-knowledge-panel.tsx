"use client";
import { useState, useTransition } from "react";
import { BookOpen, Edit2, Check, X, AlertTriangle } from "lucide-react";
import { listKnowledgeBlocks, updateKnowledgeBlock } from "@/app/(crm)/lia-central-actions";
import type { LiaKnowledgeBlockRow } from "@/lib/ai/lia-types";
import { Note } from "@/components/form-blocks";

function BlockCard({ block, onSave }: { block: LiaKnowledgeBlockRow; onSave: (id: string, content: string) => Promise<string | null> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(block.content);
  const [saving, startSave] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function startEdit() { setDraft(block.content); setErr(null); setEditing(true); }
  function cancel() { setEditing(false); setErr(null); }
  function save() {
    setErr(null);
    startSave(async () => {
      const error = await onSave(block.id, draft);
      if (error) { setErr(error); } else { setEditing(false); }
    });
  }

  const updated = new Date(block.updated_at).toLocaleDateString("pt-BR");

  return (
    <div className="fx-block">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="font-semibold text-sm">
            <span className="text-xs text-ink/40 mr-1.5 tabular-nums">#{block.block_number}</span>
            {block.category}
          </p>
          <p className="text-xs text-ink/50">IDs {block.rule_range_start}–{block.rule_range_end} · v{block.version} · atualizado {updated}</p>
        </div>
        {!editing && (
          <button type="button" className="button-ghost shrink-0 text-xs" onClick={startEdit} aria-label={`Editar bloco ${block.category}`}>
            <Edit2 className="h-3.5 w-3.5" /> Editar
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            className="w-full border rounded-lg p-3 text-sm font-mono leading-relaxed resize-y min-h-[120px] focus:outline-none focus:ring-2 focus:ring-forest/40"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            aria-label={`Conteúdo do bloco ${block.category}`}
            maxLength={8000}
          />
          <p className="text-xs text-ink/40 text-right">{draft.length}/8000</p>
          {err && <Note tone="error" className="mt-2">{err}</Note>}
          <div className="flex gap-2 mt-2">
            <button type="button" className="button text-sm" onClick={save} disabled={saving}>
              <Check className="h-4 w-4" /> {saving ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="button-ghost text-sm" onClick={cancel} disabled={saving}>
              <X className="h-4 w-4" /> Cancelar
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-ink/75 leading-relaxed line-clamp-4">{block.content}</p>
      )}
    </div>
  );
}

export function LiaKnowledgePanel({ initialBlocks }: { initialBlocks: LiaKnowledgeBlockRow[] }) {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [loading, setLoading] = useState(false);
  const [globalErr, setGlobalErr] = useState<string | null>(null);

  async function handleLoad() {
    setLoading(true);
    const result = await listKnowledgeBlocks();
    setLoading(false);
    if (result.error) { setGlobalErr(result.error); return; }
    setBlocks(result.data);
  }

  async function handleSave(id: string, content: string): Promise<string | null> {
    const result = await updateKnowledgeBlock(id, content);
    if (!result.error) {
      setBlocks(prev => prev.map(b => b.id === id ? { ...b, content, version: b.version + 1, updated_at: new Date().toISOString() } : b));
    }
    return result.error ?? null;
  }

  return (
    <div className="space-y-3">
      <div className="fx-block">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="h-4 w-4 text-forest" />
          <p className="font-semibold text-sm">Base de Conhecimento</p>
        </div>
        <p className="text-xs text-ink/55 mb-3">
          19 blocos consolidados importados do pacote LIA V2. Cada bloco resume as diretrizes de uma categoria.
          Edições precisam de aprovação antes de vigorarem em produção.
        </p>
        <Note tone="warn">
          <AlertTriangle className="h-4 w-4 inline mr-1" />
          Estes blocos são a base que a LIA usa para tomar decisões. Edite somente com orientação do gestor responsável.
        </Note>
      </div>
      {globalErr && <Note tone="error">{globalErr}</Note>}
      {blocks.length === 0 ? (
        <div className="fx-block text-center py-6">
          <p className="text-sm text-ink/55 mb-3">Blocos não carregados. A migration precisa ser aplicada.</p>
          <button type="button" className="button text-sm" onClick={handleLoad} disabled={loading}>
            {loading ? "Carregando…" : "Tentar carregar"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {blocks.map(b => <BlockCard key={b.id} block={b} onSave={handleSave} />)}
        </div>
      )}
    </div>
  );
}
