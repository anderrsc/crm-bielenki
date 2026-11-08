"use client";
// Central de IA com dados reais (lib/ai/central-data.ts). Substitui o painel antigo,
// que mostrava números e históricos fixos no código.
import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, Bot, CheckCircle, MessageSquare, Pause, Play, Send, TestTube, UserPlus, XCircle } from "lucide-react";
import { setAiAgentActive, testAiAgent } from "@/app/(crm)/actions";
import type { CentralData, CentralEvent } from "@/lib/ai/central-data";
import { cn } from "@/lib/utils";
import { WhatsappConnect } from "@/components/whatsapp-connect";

const EVENT_STYLE: Record<CentralEvent["kind"], { icon: React.ElementType; cls: string }> = {
  triagem: { icon: MessageSquare, cls: "text-blue-600" },
  lead: { icon: UserPlus, cls: "text-green-600" },
  envio: { icon: Send, cls: "text-ink/50" },
  falha: { icon: AlertTriangle, cls: "text-red-600" },
};

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="card p-4">
      <p className={cn("text-2xl font-black", alert && value > 0 && "text-red-600")}>{value}</p>
      <p className="text-xs text-ink/55">{label}</p>
    </div>
  );
}

export function AiCentral({ data, error }: { data: CentralData | null; error?: string }) {
  const [test, setTest] = useState<{ reply?: string; error?: string } | null>(null);
  const [testing, startTest] = useTransition();

  if (!data) return <div className="card p-6 text-sm">Não foi possível carregar a Central de IA{error ? `: ${error}` : "."}</div>;
  const pending = data.checks.filter((c) => !c.ok);
  const ready = pending.length === 0;
  const s = data.stats;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Bot className="h-6 w-6 text-forest" /><h1 className="text-2xl font-black">Central de IA</h1></div>
          <p className="mt-1 text-sm text-ink/55">{data.agentName} · triagem pelo WhatsApp ({data.wppProvider === "meta" ? "Meta" : "Evolution"}) · últimos 30 dias</p>
        </div>
        <form action={setAiAgentActive}>
          <input type="hidden" name="active" value={data.active ? "0" : "1"} />
          <button className={cn("flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold", data.active ? "bg-red-600 text-white" : "bg-brand-strong text-forest")}>
            {data.active ? <><Pause className="h-4 w-4" /> Pausar {data.agentName}</> : <><Play className="h-4 w-4" /> Ativar {data.agentName}</>}
          </button>
        </form>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-500">{error}</div>}

      <div className={cn("rounded-2xl border-2 p-4", ready ? "border-green-500/40 bg-green-500/10" : "border-amber-500/40 bg-amber-500/10")}>
        <p className="font-bold">{ready ? `${data.agentName} está pronta para atender.` : `${data.agentName} ainda não atende: ${pending.length} item(ns) pendente(s).`}</p>
        <ul className="mt-3 space-y-2">
          {data.checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2 text-sm">
              {c.ok ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
              <span><b>{c.label}:</b> {c.detail}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" disabled={testing} onClick={() => startTest(async () => setTest(await testAiAgent()))} className="flex items-center gap-2 rounded-xl bg-forest px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            <TestTube className="h-4 w-4" /> {testing ? "Testando…" : "Testar IA agora"}
          </button>
          <Link href="/agente-ia?aba=configuracoes" className="rounded-xl border border-sand px-4 py-2 text-sm font-bold">Configurar</Link>
        </div>
        {test && <p className={cn("mt-3 text-sm", test.error ? "text-red-500" : "text-green-500")}>{test.error ? `⚠️ ${test.error}` : `✅ ${test.reply}`}</p>}
      </div>

      <WhatsappConnect />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Conversas no WhatsApp" value={s.conversas} />
        <Stat label="Triagens concluídas" value={s.concluidas} />
        <Stat label="Leads criados pela IA" value={s.leads} />
        <Stat label="Vezes que a IA falhou" value={s.falhasIa} alert />
        <Stat label="Em andamento" value={s.emAndamento} />
        <Stat label="Pós-venda encaminhado" value={s.posVenda} />
        <Stat label="Mensagens automáticas enviadas" value={s.enviadas} />
        <Stat label="Envios com erro" value={s.falhasEnvio} alert />
      </div>
      {(s.workflowsOk > 0 || s.workflowsFalha > 0 || s.pendentes > 0) && (
        <p className="text-sm text-ink/60">Automações: {s.workflowsOk} execuções ok · {s.workflowsFalha} com falha · {s.pendentes} mensagem(ns) na fila.</p>
      )}

      <div className="card p-4">
        <h2 className="font-bold">Histórico real</h2>
        {data.events.length === 0 ? (
          <p className="mt-2 text-sm text-ink/55">Nada nos últimos 30 dias. Quando um cliente chamar no WhatsApp, aparece aqui.</p>
        ) : (
          <ul className="mt-3 divide-y divide-sand/70">
            {data.events.map((e, i) => {
              const { icon: Icon, cls } = EVENT_STYLE[e.kind];
              return (
                <li key={i} className="flex items-start gap-3 py-2 text-sm">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", cls)} />
                  <div className="min-w-0 flex-1"><p className="font-semibold">{e.title}</p><p className="truncate text-ink/55">{e.detail}</p></div>
                  <span className="shrink-0 text-xs text-ink/45">{when(e.at)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/agente-ia" className="mt-3 inline-block text-sm font-bold text-forest">Ver conversas completas →</Link>
      </div>
    </div>
  );
}
