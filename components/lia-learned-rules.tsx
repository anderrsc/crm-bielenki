"use client";
// Central de IA → "Ensinar a LIA": a gerência escreve a correção, confere a regra, confirma.
// Regras confirmadas valem nas próximas conversas; cada edição vira nova versão; dá para desfazer.
import { useCallback, useEffect, useState, useTransition } from "react";
import { GraduationCap, History, RotateCcw, Check } from "lucide-react";
import { interpretCorrection, listLiaRules, saveLiaRule, setLiaRuleStatus, type LiaRuleRow } from "@/app/(crm)/lia-rules-actions";
import type { LiaRule, RuleDraft } from "@/lib/ai/lia-learned-rules";
import { FormBlock, Note } from "@/components/form-blocks";

type Editing = RuleDraft & { pedido: string | null; exemplo: string | null; anterior: string | null; similar: LiaRule[]; viaIa: boolean };

export function LiaLearnedRules({ exemplo: exemploInicial = null }: { exemplo?: string | null }) {
  const [rules, setRules] = useState<LiaRuleRow[]>([]);
  const [pedido, setPedido] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, start] = useTransition();

  const load = useCallback(async () => {
    const r = await listLiaRules();
    if (r.ok) setRules(r.rules); else setMsg({ text: r.error, error: true });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const interpretar = () => start(async () => {
    setMsg(null);
    const r = await interpretCorrection(pedido, exemploInicial);
    if (!r.ok) { setMsg({ text: r.error, error: true }); return; }
    setEditing({ ...r.draft, pedido, exemplo: exemploInicial, anterior: null, similar: r.similar, viaIa: r.viaIa });
  });

  const salvar = (ativar: boolean) => start(async () => {
    if (!editing) return;
    const r = await saveLiaRule({ quando: editing.quando, instrucao: editing.instrucao, pedido: editing.pedido, exemplo: editing.exemplo, anterior: editing.anterior, ativar });
    if (!r.ok) { setMsg({ text: r.error, error: true }); return; }
    setMsg({ text: ativar ? "Regra confirmada. A LIA segue a partir da próxima mensagem." : "Proposta salva. Confirme quando quiser que passe a valer." });
    setEditing(null); setPedido(""); await load();
  });

  const acao = (id: string, a: "ativar" | "desfazer") => start(async () => {
    const r = await setLiaRuleStatus(id, a);
    setMsg(r.ok ? { text: a === "ativar" ? "Regra confirmada." : "Regra desfeita. Se era uma versão nova, a anterior voltou a valer." } : { text: r.error, error: true });
    await load();
  });

  const ativas = rules.filter((r) => r.status === "ativa");
  const propostas = rules.filter((r) => r.status === "proposta");

  return (
    <FormBlock id="lia-ensinar" icon={GraduationCap} title="Ensinar a LIA"
      hint={<>Escreva a correção como falaria com ela. Ex.: <i>“Lia, quando o cliente pedir orçamento de calhas, primeiro peça o endereço e fotos.”</i> Você confere a regra antes; só as confirmadas valem, e dá para editar ou desfazer.</>}>
      <div className="fx-stack">
        {!editing && (
          <div className="grid gap-2">
            <textarea value={pedido} onChange={(e) => setPedido(e.target.value)} maxLength={1500} rows={3}
              placeholder="Lia, não responda dessa forma. Quando..." aria-label="Correção para a LIA" className="field" />
            <div className="lia-actions">
              <button onClick={interpretar} disabled={busy || pedido.trim().length < 5} className="button disabled:opacity-60">
                {busy ? "Lendo…" : "Transformar em regra"}
              </button>
            </div>
          </div>
        )}

        {editing && (
          <div className="lia-draft">
            <p className="lia-section-label">{editing.anterior ? "Nova versão da regra (a atual segue valendo até você confirmar)." : editing.viaIa ? "Regra montada a partir da sua correção. Confira:" : "A IA não respondeu agora; montei a regra pelo texto. Confira:"}</p>
            <label className="grid gap-1 text-xs font-semibold">Quando vale (vazio = sempre)
              <input value={editing.quando ?? ""} onChange={(e) => setEditing({ ...editing, quando: e.target.value || null })} maxLength={300} />
            </label>
            <label className="grid gap-1 text-xs font-semibold">O que a LIA deve fazer
              <textarea value={editing.instrucao} onChange={(e) => setEditing({ ...editing, instrucao: e.target.value })} maxLength={1000} rows={3} />
            </label>
            {editing.similar.length > 0 && (
              <Note tone="warn" role="alert">
                <b>Já existe regra parecida.</b> Confira se não repete nem contradiz:
                <ul className="mt-1 list-disc pl-4">{editing.similar.slice(0, 3).map((r) => <li key={r.id}>{r.quando ? `Quando ${r.quando}: ` : ""}{r.instrucao}</li>)}</ul>
              </Note>
            )}
            <div className="lia-actions">
              <button onClick={() => salvar(true)} disabled={busy || editing.instrucao.trim().length < 5} className="button disabled:opacity-60"><Check className="h-4 w-4" /> Confirmar e aplicar</button>
              <button onClick={() => salvar(false)} disabled={busy} className="button-ghost">Salvar como proposta</button>
              <button onClick={() => setEditing(null)} disabled={busy} className="button-ghost">Cancelar</button>
            </div>
          </div>
        )}

        {msg && <Note tone={msg.error ? "error" : "ok"} role="status">{msg.text}</Note>}

        {propostas.length > 0 && (
          <div>
            <h3 className="lia-section-label">Aguardando confirmação</h3>
            <ul className="fx-stack mt-1">{propostas.map((r) => (
              <li key={r.id} className="lia-rule">
                {r.quando && <b>Quando {r.quando}: </b>}{r.instrucao} <span className="lia-rule-meta">v{r.versao}</span>
                <div className="lia-rule-actions">
                  <button onClick={() => acao(r.id, "ativar")} disabled={busy}>Confirmar</button>
                  <button onClick={() => acao(r.id, "desfazer")} disabled={busy} data-quiet>Descartar</button>
                </div>
              </li>))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="lia-section-label">Valendo agora ({ativas.length})</h3>
          {ativas.length === 0 && <p className="mt-1 text-sm text-ink/60">Nenhuma regra ensinada ainda.</p>}
          <ul className="fx-stack mt-1">{ativas.map((r) => (
            <li key={r.id} className="lia-rule">
              {r.quando && <b>Quando {r.quando}: </b>}{r.instrucao}
              <span className="lia-rule-meta ml-1">v{r.versao}{r.ativada_em ? ` · desde ${new Date(r.ativada_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}</span>
              <div className="lia-rule-actions">
                <button onClick={() => setEditing({ quando: r.quando, instrucao: r.instrucao, pedido: null, exemplo: null, anterior: r.id, similar: [], viaIa: false })} disabled={busy}><History className="h-3 w-3" /> Editar (nova versão)</button>
                <button onClick={() => acao(r.id, "desfazer")} disabled={busy} data-quiet><RotateCcw className="h-3 w-3" /> Desfazer</button>
              </div>
            </li>))}
          </ul>
        </div>
      </div>
    </FormBlock>
  );
}
