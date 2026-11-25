"use client";
import { useState, useTransition } from "react";
import { FileText, CheckCircle, Clock, Archive, Eye, EyeOff, PlusCircle } from "lucide-react";
import { listPromptVersions, savePromptDraft, publishPromptVersion } from "@/app/(crm)/lia-prompt-actions";
import type { PromptVersionRow } from "@/app/(crm)/lia-prompt-actions";
import { Note } from "@/components/form-blocks";

const STATUS_LABEL = { active: "Ativo", draft: "Rascunho", archived: "Arquivado" };
const STATUS_COLOR = { active: "text-green-600", draft: "text-amber-600", archived: "text-ink/40" };
const when = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

function VersionCard({ v, onPublish }: { v: PromptVersionRow; onPublish: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = v.status === "active" ? CheckCircle : v.status === "draft" ? Clock : Archive;
  return (
    <div className="fx-block">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Icon className={`h-4 w-4 shrink-0 ${STATUS_COLOR[v.status]}`} />
            v{v.version} — <span className={STATUS_COLOR[v.status]}>{STATUS_LABEL[v.status]}</span>
          </p>
          <p className="text-xs text-ink/50 mt-0.5">
            {when(v.created_at)}
            {v.published_at && <> · publicado {when(v.published_at)}</>}
            {v.change_note && <> · {v.change_note}</>}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" className="button-ghost text-xs" onClick={() => setExpanded(x => !x)} aria-label={expanded ? "Ocultar prompt" : "Ver prompt"}>
            {expanded ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {expanded ? "Ocultar" : "Ver"}
          </button>
          {v.status === "draft" && (
            <button type="button" className="button text-xs" onClick={() => onPublish(v.id)}>
              <CheckCircle className="h-3.5 w-3.5" /> Publicar
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <pre className="mt-3 p-3 bg-cream rounded-xl text-xs font-mono whitespace-pre-wrap leading-relaxed border border-ink/10">
          {v.content}
        </pre>
      )}
    </div>
  );
}

export function LiaPromptEditor({ initialVersions }: { initialVersions: PromptVersionRow[] }) {
  const [versions, setVersions] = useState(initialVersions);
  const [drafting, setDrafting] = useState(false);
  const [content, setContent] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [, startT] = useTransition();

  const active = versions.find(v => v.status === "active");

  function openDraft() {
    setContent(active?.content ?? "");
    setChangeNote("");
    setDrafting(true);
  }

  function handleSave() {
    startT(async () => {
      const result = await savePromptDraft(content, changeNote);
      if (result.error) { setMsg({ text: result.error, tone: "error" }); return; }
      const { data } = await listPromptVersions();
      setVersions(data);
      setDrafting(false);
      setMsg({ text: "Rascunho salvo. Publique quando estiver pronto.", tone: "ok" });
    });
  }

  function handlePublish(id: string) {
    startT(async () => {
      const result = await publishPromptVersion(id);
      if (result.error) { setMsg({ text: result.error, tone: "error" }); return; }
      const { data } = await listPromptVersions();
      setVersions(data);
      setMsg({ text: "Prompt publicado com sucesso.", tone: "ok" });
    });
  }

  return (
    <div className="space-y-3">
      <div className="fx-block">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="font-semibold text-sm flex items-center gap-2"><FileText className="h-4 w-4 text-forest" /> Prompt da LIA</p>
            <p className="text-xs text-ink/55">Instruções base que a LIA segue em todos os atendimentos. Editar e publicar exige aprovação do gerente.</p>
          </div>
          {!drafting && (
            <button type="button" className="button text-sm" onClick={openDraft}>
              <PlusCircle className="h-4 w-4" /> Nova versão
            </button>
          )}
        </div>
      </div>

      {msg && <Note tone={msg.tone} role="status">{msg.text}</Note>}

      {drafting && (
        <div className="fx-block space-y-3">
          <p className="text-sm font-semibold">Nova versão (rascunho)</p>
          <textarea
            className="w-full border rounded-xl p-3 text-sm font-mono leading-relaxed resize-y min-h-[200px] focus:outline-none focus:ring-2 focus:ring-forest/40"
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Escreva as instruções da LIA…"
            maxLength={20000}
          />
          <p className="text-xs text-ink/40 text-right">{content.length}/20000</p>
          <input
            type="text"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="Nota de alteração (ex: ajuste de prazo de esquadrias)"
            value={changeNote}
            onChange={e => setChangeNote(e.target.value)}
            maxLength={200}
          />
          <Note tone="warn">O rascunho não entra em vigor até ser publicado. A versão ativa continua valendo.</Note>
          <div className="flex gap-2">
            <button type="button" className="button text-sm" onClick={handleSave}>Salvar rascunho</button>
            <button type="button" className="button-ghost text-sm" onClick={() => setDrafting(false)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {versions.length === 0 ? (
          <div className="fx-block py-6 text-center text-sm text-ink/55">Nenhuma versão encontrada. A migration precisa ser aplicada.</div>
        ) : (
          versions.map(v => <VersionCard key={v.id} v={v} onPublish={handlePublish} />)
        )}
      </div>
    </div>
  );
}
