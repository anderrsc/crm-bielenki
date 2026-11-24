"use client";
// Modo de trabalho da Lia e o registro do que ela decidiu em cada mensagem.
import { useEffect, useState, useTransition } from "react";
import { loadLiaSettings, saveLiaSettings, type LiaSettings } from "@/app/(crm)/lia-mode-actions";
import { LIA_MODES, type LiaMode } from "@/lib/ai/lia-mode";
import { formatBrPhone } from "@/lib/whatsapp/phone";
import { Bot, History } from "lucide-react";
import { FormBlock, Note } from "@/components/form-blocks";
import { cn } from "@/lib/utils";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DECISAO: Record<string, { label: string; cls: string }> = {
  respondeu: { label: "Respondeu", cls: "bg-[var(--success-soft)] text-[#067647]" },
  aprovada: { label: "Aprovada", cls: "bg-[var(--success-soft)] text-[#067647]" },
  sugeriu: { label: "Sugeriu", cls: "bg-[var(--info-soft)] text-[#175CD3]" },
  encaminhou: { label: "Encaminhou", cls: "bg-[var(--warning-soft)] text-[#93370D]" },
  ignorou: { label: "Parou", cls: "bg-[var(--surface-2)] text-[var(--text-muted)]" },
  falhou: { label: "Falhou", cls: "bg-[var(--danger-soft)] text-[#B42318]" },
};
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export function LiaModeSettings() {
  const [data, setData] = useState<LiaSettings | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [mode, setMode] = useState<LiaMode>("automatica");
  const [comHorario, setComHorario] = useState(false);
  const [inicio, setInicio] = useState("08:00");
  const [fim, setFim] = useState("18:00");
  const [dias, setDias] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [limite, setLimite] = useState(200);
  const [salvando, startSalvar] = useTransition();

  const carregar = async () => {
    const r = await loadLiaSettings();
    if ("error" in r) { setErro(r.error); return; }
    setData(r); setMode(r.mode); setLimite(r.dailyLimit);
    setComHorario(!!r.hours);
    if (r.hours) { setInicio(r.hours.inicio); setFim(r.hours.fim); setDias(r.hours.dias); }
  };
  useEffect(() => { const t = setTimeout(() => void carregar(), 0); return () => clearTimeout(t); }, []);

  const salvar = () => startSalvar(async () => {
    setOk(false);
    const r = await saveLiaSettings({ mode, hours: comHorario ? { inicio, fim, dias } : null, dailyLimit: limite });
    if (r.error) { setErro(r.error); return; }
    setErro(null); setOk(true); void carregar();
  });

  if (!data) return <div className="fx-block text-sm">{erro ?? "Carregando modo da LIA…"}</div>;
  const editavel = data.canEdit;

  return (
    <FormBlock icon={Bot} title="Modo de trabalho da LIA" hint="Quando a LIA não responde sozinha, a resposta aparece no Atendimento para a equipe usar, editar ou descartar.">
      <div className="fx-stack">
        <div className="lia-modes" role="radiogroup" aria-label="Modo da LIA">
          {LIA_MODES.map(m => (
            <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} disabled={!editavel} onClick={() => setMode(m.value)} className="lia-mode">
              <p className="lia-mode-title">{m.label}</p>
              <p className="lia-mode-detail">{m.detail}</p>
            </button>
          ))}
        </div>
        <div className="fx-stack">
          <label className="lia-switch">
            <input type="checkbox" checked={comHorario} disabled={!editavel} onChange={e => setComHorario(e.target.checked)} />
            <span className="lia-switch-track" aria-hidden />
            Responder sozinha só neste horário
          </label>
          {comHorario && (
            <div className="fx-grid fx-grid-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input type="time" value={inicio} disabled={!editavel} onChange={e => setInicio(e.target.value)} className="field w-32" aria-label="Início" />
                <span>até</span>
                <input type="time" value={fim} disabled={!editavel} onChange={e => setFim(e.target.value)} className="field w-32" aria-label="Fim" />
              </div>
              <div className="lia-days">
                {DIAS.map((d, i) => (
                  <button key={d} type="button" disabled={!editavel} aria-pressed={dias.includes(i)} className="lia-day"
                    onClick={() => setDias(v => v.includes(i) ? v.filter(x => x !== i) : [...v, i].sort())}>{d}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Limite de respostas automáticas por dia
          <input type="number" min={1} max={5000} value={limite} disabled={!editavel} onChange={e => setLimite(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))} className="field w-24" />
        </label>
        {editavel ? (
          <div className="lia-actions">
            <button type="button" onClick={salvar} disabled={salvando} className="button disabled:opacity-60">{salvando ? "Salvando…" : "Salvar modo"}</button>
            {ok && <span className="text-sm text-[#067647]" role="status">Salvo. Vale para a próxima mensagem.</span>}
          </div>
        ) : <p className="text-xs text-ink/55">Só administrador ou gerente muda o modo.</p>}
        {erro && <Note tone="error" role="alert">{erro}</Note>}

        <div>
          <h3 className="lia-section-label flex items-center gap-1.5"><History className="h-3.5 w-3.5" aria-hidden />Decisões recentes</h3>
          {data.decisions.length === 0 ? <p className="mt-1 text-sm text-ink/55">Nenhuma decisão registrada ainda.</p> : (
            <ul className="mt-1">
              {data.decisions.map(d => {
                const st = DECISAO[d.decisao] ?? { label: d.decisao, cls: "bg-[var(--surface-2)]" };
                return (
                  <li key={d.id} className="lia-decision">
                    <span className={cn("lia-badge", st.cls)}>{st.label}</span>
                    <div className="min-w-0 flex-1"><p className="truncate">{d.motivo}</p>{d.phone && <p className="text-xs text-ink/50">{formatBrPhone(d.phone)}</p>}</div>
                    <span className="lia-event-time">{when(d.at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </FormBlock>
  );
}
