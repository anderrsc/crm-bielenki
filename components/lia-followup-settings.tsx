"use client";
// Acompanhamento comercial automático da Lia: desligado por padrão; o dono liga e define o limite do dia.
import { useEffect, useState, useTransition } from "react";
import { loadLiaFollowups, saveLiaFollowups, type LiaFollowups } from "@/app/(crm)/lia-mode-actions";
import { cn } from "@/lib/utils";

export function LiaFollowupSettings() {
  const [data, setData] = useState<LiaFollowups | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [limite, setLimite] = useState(15);
  const [pending, start] = useTransition();
  const carregar = async () => {
    const r = await loadLiaFollowups();
    if ("error" in r) { setErro(r.error); return; }
    setData(r); setEnabled(r.enabled); setLimite(r.dailyLimit);
  };
  useEffect(() => { const t = setTimeout(() => void carregar(), 0); return () => clearTimeout(t); }, []);
  if (!data) return <div className="card p-4 text-sm">{erro ?? "Carregando acompanhamento…"}</div>;
  const salvar = () => start(async () => {
    setOk(false);
    const r = await saveLiaFollowups({ enabled, dailyLimit: limite });
    if (r.error) { setErro(r.error); return; }
    setErro(null); setOk(true); void carregar();
  });
  return (
    <div className="card space-y-3 p-4">
      <div>
        <h2 className="font-bold">Acompanhamento automático de leads</h2>
        <p className="text-xs text-ink/55">Quando um lead que já conversou fica 24 horas sem responder, a Lia manda uma mensagem curta (depois de 48 h e 72 h, no máximo 3 vezes). Só no horário de atendimento, só para quem já falou com a empresa, e para de vez se o cliente responder ou pedir para não receber.</p>
      </div>
      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={enabled} disabled={!data.canEdit} onChange={(e) => setEnabled(e.target.checked)} />
        {enabled ? "Ligado" : "Desligado"}
      </label>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="lia-fu-limite">No máximo</label>
        <input id="lia-fu-limite" type="number" min={1} max={100} value={limite} disabled={!data.canEdit} onChange={(e) => setLimite(Number(e.target.value))} className="field w-24" />
        <span>mensagens por dia (enviadas hoje: <b>{data.sentToday}</b>). Saem poucas por minuto, nunca em rajada.</span>
      </div>
      {erro && <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-500">{erro}</p>}
      {ok && <p className="rounded-lg bg-green-500/10 p-2 text-xs text-green-600">Salvo.</p>}
      {data.canEdit && <button type="button" disabled={pending} onClick={salvar} className={cn("button", pending && "opacity-60")}>Salvar acompanhamento</button>}
    </div>
  );
}
