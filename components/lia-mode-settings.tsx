"use client";
// Modo de trabalho da Lia e o registro do que ela decidiu em cada mensagem.
import { useEffect, useState, useTransition } from "react";
import { loadLiaSettings, saveLiaSettings, type LiaSettings } from "@/app/(crm)/lia-mode-actions";
import { LIA_MODES, type LiaMode } from "@/lib/ai/lia-mode";
import { formatBrPhone } from "@/lib/whatsapp/phone";
import { cn } from "@/lib/utils";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DECISAO: Record<string, { label: string; cls: string }> = {
  respondeu: { label: "Respondeu", cls: "bg-green-500/15 text-green-600" },
  aprovada: { label: "Aprovada", cls: "bg-green-500/15 text-green-600" },
  sugeriu: { label: "Sugeriu", cls: "bg-blue-500/15 text-blue-500" },
  encaminhou: { label: "Encaminhou", cls: "bg-amber-500/15 text-amber-600" },
  ignorou: { label: "Parou", cls: "bg-ink/10 text-ink/60" },
  falhou: { label: "Falhou", cls: "bg-red-500/15 text-red-600" },
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

  if (!data) return <div className="card p-4 text-sm">{erro ?? "Carregando modo da Lia…"}</div>;
  const editavel = data.canEdit;

  return (
    <div className="card space-y-4 p-4">
      <div>
        <h2 className="font-bold">Modo de trabalho da Lia</h2>
        <p className="text-xs text-ink/55">Quando a Lia não responde sozinha, a resposta aparece no Atendimento para a equipe usar, editar ou descartar.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Modo da Lia">
        {LIA_MODES.map(m => (
          <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} disabled={!editavel} onClick={() => setMode(m.value)}
            className={cn("rounded-xl border-2 p-3 text-left text-sm", mode === m.value ? "border-forest bg-forest/10" : "border-sand")}>
            <p className="font-bold">{m.label}</p>
            <p className="mt-1 text-xs text-ink/60">{m.detail}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={comHorario} disabled={!editavel} onChange={e => setComHorario(e.target.checked)} />
          Responder sozinha só neste horário
        </label>
        {comHorario && (
          <>
            <input type="time" value={inicio} disabled={!editavel} onChange={e => setInicio(e.target.value)} className="field w-28" aria-label="Início" />
            <span>até</span>
            <input type="time" value={fim} disabled={!editavel} onChange={e => setFim(e.target.value)} className="field w-28" aria-label="Fim" />
            <div className="flex flex-wrap gap-1">
              {DIAS.map((d, i) => (
                <button key={d} type="button" disabled={!editavel} aria-pressed={dias.includes(i)}
                  onClick={() => setDias(v => v.includes(i) ? v.filter(x => x !== i) : [...v, i].sort())}
                  className={cn("rounded-lg px-2 py-1 text-xs font-bold", dias.includes(i) ? "bg-forest text-white" : "bg-cream text-ink/60")}>{d}</button>
              ))}
            </div>
          </>
        )}
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Limite de respostas automáticas por dia
        <input type="number" min={1} max={5000} value={limite} disabled={!editavel} onChange={e => setLimite(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))} className="field w-24" />
      </label>
      {editavel ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={salvar} disabled={salvando} className="rounded-xl bg-forest px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{salvando ? "Salvando…" : "Salvar modo"}</button>
          {ok && <span className="text-sm text-green-600">Salvo. Vale para a próxima mensagem.</span>}
        </div>
      ) : <p className="text-xs text-ink/55">Só administrador ou gerente muda o modo.</p>}
      {erro && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{erro}</p>}

      <div>
        <h3 className="text-sm font-bold">Decisões recentes</h3>
        {data.decisions.length === 0 ? <p className="mt-1 text-sm text-ink/55">Nenhuma decisão registrada ainda.</p> : (
          <ul className="mt-2 divide-y divide-sand/70">
            {data.decisions.map(d => {
              const st = DECISAO[d.decisao] ?? { label: d.decisao, cls: "bg-ink/10" };
              return (
                <li key={d.id} className="flex items-start gap-2 py-2 text-sm">
                  <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-bold", st.cls)}>{st.label}</span>
                  <div className="min-w-0 flex-1"><p className="truncate">{d.motivo}</p>{d.phone && <p className="text-xs text-ink/50">{formatBrPhone(d.phone)}</p>}</div>
                  <span className="shrink-0 text-xs text-ink/45">{when(d.at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
