"use client";
// Central de IA com dados reais (lib/ai/central-data.ts). Substitui o painel antigo,
// que mostrava números e históricos fixos no código.
import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle, Clock, Headset, History, MessageSquare, Pause, Play, Send, Settings2, TestTube, UserPlus, XCircle } from "lucide-react";
import { FormBlock, Note } from "@/components/form-blocks";
import { setAiAgentActive, testAiAgent } from "@/app/(crm)/actions";
import type { CentralData, CentralEvent } from "@/lib/ai/central-data";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
const LiaFollowupSettings = dynamic(() => import("@/components/lia-followup-settings").then(module => module.LiaFollowupSettings), { loading: () => <p role="status">Carregando acompanhamento…</p> });
const LiaModeSettings = dynamic(() => import("@/components/lia-mode-settings").then(module => module.LiaModeSettings), { loading: () => <p role="status">Carregando modo da LIA…</p> });
const LiaLearnedRules = dynamic(() => import("@/components/lia-learned-rules").then(module => module.LiaLearnedRules), { loading: () => <p role="status">Carregando regras ensinadas…</p> });
const AnaRules = dynamic(() => import("@/components/ana-rules").then(module => module.AnaRules), { loading: () => <p role="status">Carregando regras…</p> });

const EVENT_STYLE: Record<CentralEvent["kind"], { icon: React.ElementType }> = {
  triagem: { icon: MessageSquare },
  lead: { icon: UserPlus },
  envio: { icon: Send },
  falha: { icon: AlertTriangle },
};

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function Stat({ label, value, alert, icon: Icon }: { label: string; value: number; alert?: boolean; icon: React.ElementType }) {
  const hot = !!alert && value > 0;
  return (
    <div className="lia-stat" data-alert={hot}>
      <div className="lia-stat-top"><span className="lia-stat-ico" aria-hidden><Icon className="h-4 w-4" /></span></div>
      <div><p className="lia-stat-value">{value}</p><p className="lia-stat-label">{label}</p></div>
    </div>
  );
}

export function AiCentral({ data, error }: { data: CentralData | null; error?: string }) {
  const [test, setTest] = useState<{ reply?: string; error?: string } | null>(null);
  const [testing, startTest] = useTransition();
  const [rulesOpen, setRulesOpen] = useState(false);

  if (!data) return <div className="card p-6 text-sm">Não foi possível carregar a Central de IA{error ? `: ${error}` : "."}</div>;
  const pending = data.checks.filter((c) => !c.ok);
  const ready = pending.length === 0;
  const s = data.stats;

  const agent = /^lia$/i.test(data.agentName) ? "LIA" : data.agentName;
  return (
    <div className="space-y-5">
      <h1 className="sr-only">Central de IA</h1>
      <div className="ai-toolbar">
        <div className="min-w-0">
          {/* Estado verdadeiro, vindo da configuração e das checagens (sem animação contínua). */}
          <span role="status" className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
            !ready ? "bg-amber-500/15 text-amber-700" : data.active ? "bg-green-500/15 text-green-700" : "bg-cream text-ink/70")}>
            <span aria-hidden className={cn("h-2 w-2 rounded-full", !ready ? "bg-amber-500" : data.active ? "bg-green-500" : "bg-ink/40")} />
            {!ready ? `Falta configurar (${pending.length})` : data.active ? `${agent} pronta` : `${agent} pausada`}
          </span>
          <p className="ai-toolbar-sub">Triagem pelo WhatsApp ({data.wppProvider === "meta" ? "Meta" : "Evolution"}) · últimos 30 dias</p>
        </div>
        <form action={setAiAgentActive}>
          <input type="hidden" name="active" value={data.active ? "0" : "1"} />
          <button className={cn("button", data.active && "ai-pause")}>
            {data.active ? <><Pause className="h-4 w-4" /> Pausar {agent}</> : <><Play className="h-4 w-4" /> Ativar {agent}</>}
          </button>
        </form>
      </div>

      {error && <Note tone="error" role="alert">{error}</Note>}

      <div className="ai-checks lia-ready" data-ready={ready}>
        <p className="lia-ready-title">{ready ? `${agent} está pronta para atender.` : `${agent} ainda não atende: ${pending.length} item(ns) pendente(s).`}</p>
        <ul className="lia-checks">
          {data.checks.map((c) => (
            <li key={c.label} className="lia-check">
              {c.ok ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
              <span><b>{c.label}:</b> {c.detail}</span>
            </li>
          ))}
        </ul>
        <div className="lia-actions">
          <button type="button" disabled={testing} onClick={() => startTest(async () => setTest(await testAiAgent()))} className="button disabled:opacity-60">
            <TestTube className="h-4 w-4" /> {testing ? "Testando…" : "Testar IA agora"}
          </button>
          <Link href="/agente-ia?aba=configuracoes" className="button-ghost">Configurar</Link>
        </div>
        {test && <Note tone={test.error ? "error" : "ok"} className="lia-test" role="status">{test.error ? `Erro: ${test.error}` : test.reply}</Note>}
      </div>

      <div className="ai-stats">
        <Stat icon={MessageSquare} label="Conversas no WhatsApp" value={s.conversas} />
        <Stat icon={CheckCircle} label="Triagens concluídas" value={s.concluidas} />
        <Stat icon={UserPlus} label="Leads criados pela IA" value={s.leads} />
        <Stat icon={AlertTriangle} label="Vezes que a IA falhou" value={s.falhasIa} alert />
        <Stat icon={Clock} label="Em andamento" value={s.emAndamento} />
        <Stat icon={Headset} label="Pós-venda encaminhado" value={s.posVenda} />
        <Stat icon={Send} label="Mensagens automáticas enviadas" value={s.enviadas} />
        <Stat icon={XCircle} label="Envios com erro" value={s.falhasEnvio} alert />
      </div>
      {(s.workflowsOk > 0 || s.workflowsFalha > 0 || s.pendentes > 0) && (
        <p className="text-sm text-ink/60">Automações: {s.workflowsOk} execuções ok · {s.workflowsFalha} com falha · {s.pendentes} mensagem(ns) na fila.</p>
      )}

      <FormBlock icon={History} title="Histórico real" hint="Últimos 30 dias">
        {data.events.length === 0 ? (
          <p className="text-sm text-ink/55">Nada nos últimos 30 dias. Quando um cliente chamar no WhatsApp, aparece aqui.</p>
        ) : (
          <ul>
            {data.events.map((e, i) => {
              const { icon: Icon } = EVENT_STYLE[e.kind];
              return (
                <li key={i} className="lia-event">
                  <span className="lia-event-ico" data-kind={e.kind} aria-hidden><Icon className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1"><p className="lia-event-title">{e.title}</p><p className="lia-event-detail truncate">{e.detail}</p></div>
                  <span className="lia-event-time">{when(e.at)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/agente-ia" className="mt-3 inline-block text-sm font-semibold text-forest">Ver conversas completas →</Link>
      </FormBlock>

      <details className="fx-block ai-config">
        <summary className="ai-config-summary"><span className="inline-flex items-center gap-2"><Settings2 className="h-[18px] w-[18px]" aria-hidden />Configurações da {agent}</span><small>Modo de trabalho, acompanhamento, regras e conexão</small></summary>
        <div className="space-y-5 pt-4">
        <LiaModeSettings />
      <LiaFollowupSettings />

      {/* Números e conexão do WhatsApp ficam num lugar só: menu lateral → WhatsApp. */}
      <div className="fx-block flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-semibold">Conexão do WhatsApp</p><p className="text-xs text-ink/55">Números, QR, servidor e conferência de mensagens.</p></div>
        <Link href="/atendimento/canais" className="button-ghost">Abrir WhatsApp →</Link>
      </div>
      <LiaLearnedRules />
      <details className="fx-block" onToggle={event => setRulesOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer font-semibold">Regras de atendimento</summary>
        {rulesOpen && <div className="mt-4"><AnaRules /></div>}
      </details>
        </div>
      </details>

    </div>
  );
}
