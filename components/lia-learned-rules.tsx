"use client";
// Central de IA → "Ensinar a LIA": a gerência escreve a correção, confere a regra, confirma.
// Regras confirmadas valem nas próximas conversas; cada edição vira nova versão; dá para desfazer.
import { useCallback, useEffect, useState, useTransition } from "react";
import { GraduationCap, History, RotateCcw, Check } from "lucide-react";
import { interpretCorrection, listLiaRules, saveLiaRule, setLiaRuleStatus, type LiaRuleRow } from "@/app/(crm)/lia-rules-actions";
import type { LiaRule, RuleDraft } from "@/lib/ai/lia-learned-rules";

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
    <section className="card p-4" aria-labelledby="lia-ensinar">
      <h2 id="lia-ensinar" className="flex items-center gap-2 text-base font-semibold"><GraduationCap className="h-5 w-5" /> Ensinar a LIA</h2>
      <p className="mt-1 text-sm text-ink/70">
        Escreva a correção como falaria com ela. Ex.: <i>“Lia, quando o cliente pedir orçamento de calhas, primeiro peça o endereço e fotos.”</i>{" "}
        Você confere a regra antes; só as confirmadas valem, e dá para editar ou desfazer.
      </p>

      {!editing && (
        <div className="mt-3 grid gap-2">
          <textarea value={pedido} onChange={(e) => setPedido(e.target.value)} maxLength={1500} rows={3}
            placeholder="Lia, não responda dessa forma. Quando..." aria-label="Correção para a LIA"
            className="w-full rounded-xl border border-sand/80 bg-cream p-3 text-sm" />
          <button onClick={interpretar} disabled={busy || pedido.trim().length < 5}
            className="justify-self-start rounded-xl bg-forest px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
            {busy ? "Lendo…" : "Transformar em regra"}
          </button>
        </div>
      )}

      {editing && (
        <div className="mt-3 grid gap-2 rounded-xl border border-forest/30 bg-forest/5 p-3">
          <p className="text-xs text-ink/60">{editing.anterior ? "Nova versão da regra (a atual segue valendo até você confirmar)." : editing.viaIa ? "Regra montada a partir da sua correção. Confira:" : "A IA não respondeu agora; montei a regra pelo texto. Confira:"}</p>
          <label className="grid gap-1 text-xs font-semibold">Quando vale (vazio = sempre)
            <input value={editing.quando ?? ""} onChange={(e) => setEditing({ ...editing, quando: e.target.value || null })} maxLength={300}
              className="rounded-lg border border-sand/80 bg-white p-2 text-sm font-normal" />
          </label>
          <label className="grid gap-1 text-xs font-semibold">O que a LIA deve fazer
            <textarea value={editing.instrucao} onChange={(e) => setEditing({ ...editing, instrucao: e.target.value })} maxLength={1000} rows={3}
              className="rounded-lg border border-sand/80 bg-white p-2 text-sm font-normal" />
          </label>
          {editing.similar.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900" role="alert">
              <b>Já existe regra parecida.</b> Confira se não repete nem contradiz:
              <ul className="mt-1 list-disc pl-4">{editing.similar.slice(0, 3).map((r) => <li key={r.id}>{r.quando ? `Quando ${r.quando}: ` : ""}{r.instrucao}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => salvar(true)} disabled={busy || editing.instrucao.trim().length < 5} className="flex items-center gap-1 rounded-xl bg-forest px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"><Check className="h-4 w-4" /> Confirmar e aplicar</button>
            <button onClick={() => salvar(false)} disabled={busy} className="rounded-xl border border-forest px-3 py-2 text-xs font-semibold text-forest">Salvar como proposta</button>
            <button onClick={() => setEditing(null)} disabled={busy} className="rounded-xl px-3 py-2 text-xs font-semibold text-ink/60">Cancelar</button>
          </div>
        </div>
      )}

      {msg && <p className={`mt-2 text-xs ${msg.error ? "text-red-600" : "text-green-700"}`} role="status">{msg.text}</p>}

      {propostas.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-ink/50">Aguardando confirmação</h3>
          <ul className="mt-1 grid gap-2">{propostas.map((r) => (
            <li key={r.id} className="rounded-lg border border-sand/80 p-2 text-sm">
              {r.quando && <b>Quando {r.quando}: </b>}{r.instrucao} <span className="text-xs text-ink/50">v{r.versao}</span>
              <div className="mt-1 flex gap-3 text-xs">
                <button onClick={() => acao(r.id, "ativar")} disabled={busy} className="font-semibold text-forest">Confirmar</button>
                <button onClick={() => acao(r.id, "desfazer")} disabled={busy} className="font-semibold text-ink/60">Descartar</button>
              </div>
            </li>))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <h3 className="text-xs font-semibold text-ink/50">Valendo agora ({ativas.length})</h3>
        {ativas.length === 0 && <p className="mt-1 text-sm text-ink/60">Nenhuma regra ensinada ainda.</p>}
        <ul className="mt-1 grid gap-2">{ativas.map((r) => (
          <li key={r.id} className="rounded-lg border border-sand/80 p-2 text-sm">
            {r.quando && <b>Quando {r.quando}: </b>}{r.instrucao}
            <span className="ml-1 text-xs text-ink/50">v{r.versao}{r.ativada_em ? ` · desde ${new Date(r.ativada_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}</span>
            <div className="mt-1 flex gap-3 text-xs">
              <button onClick={() => setEditing({ quando: r.quando, instrucao: r.instrucao, pedido: null, exemplo: null, anterior: r.id, similar: [], viaIa: false })} disabled={busy}
                className="flex items-center gap-1 font-semibold text-forest"><History className="h-3 w-3" /> Editar (nova versão)</button>
              <button onClick={() => acao(r.id, "desfazer")} disabled={busy} className="flex items-center gap-1 font-semibold text-ink/60"><RotateCcw className="h-3 w-3" /> Desfazer</button>
            </div>
          </li>))}
        </ul>
      </div>
    </section>
  );
}
