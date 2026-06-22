import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Plus, Play, Pause, Trash2, Zap, Clock, CheckCircle2, XCircle, ArrowRight, MessageSquare, Webhook, BarChart3, UserPlus, UserCheck, FileText, Send, CheckSquare, Wrench, CalendarCheck, AlertTriangle, CircleDollarSign, Link2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toggleWorkflow, deleteWorkflow } from "@/app/(crm)/actions";
import { ConfirmButton } from "@/components/confirm-button";

type Workflow = {
  id: string; name: string; description: string | null; status: string;
  trigger_type: string; runs_count: number; success_count: number;
  last_run_at: string | null; created_at: string;
  steps: Array<{ id: string; type: string; name: string }>;
};
type Execution = {
  id: string; workflow_id: string; status: string; trigger_type: string;
  started_at: string; completed_at: string | null; duration_ms: number | null;
  trigger_data: Record<string, unknown>;
};
type MessageTemplate = {
  id: string; name: string; category: string; channel: string; body: string;
  usage_count: number; active: boolean;
};

const TRIGGER_LABELS: Record<string, string> = {
  lead_criado: "Novo lead criado",
  lead_atualizado: "Lead atualizado",
  orcamento_criado: "Orçamento criado",
  orcamento_enviado: "Orçamento enviado",
  orcamento_aprovado: "Orçamento aprovado",
  orcamento_rejeitado: "Orçamento rejeitado",
  instalacao_concluida: "Instalação concluída",
  instalacao_agendada: "Visita agendada",
  pagamento_recebido: "Pagamento recebido",
  pagamento_vencido: "Pagamento vencido",
  scheduled: "Agendado (cron)",
  webhook: "Webhook externo",
  manual: "Manual",
};

const TRIGGER_ICONS: Record<string, LucideIcon> = {
  lead_criado: UserPlus, lead_atualizado: UserCheck,
  orcamento_criado: FileText, orcamento_enviado: Send, orcamento_aprovado: CheckSquare, orcamento_rejeitado: XCircle,
  instalacao_concluida: Wrench, instalacao_agendada: CalendarCheck,
  pagamento_recebido: CircleDollarSign, pagamento_vencido: AlertTriangle,
  scheduled: Clock, webhook: Webhook, manual: Play,
};

const STEP_TYPE_LABELS: Record<string, string> = {
  send_whatsapp: "WhatsApp", send_email: "E-mail", wait: "Aguardar",
  condition: "Condição", notify_user: "Notificar", update_lead: "Atualizar lead",
  ai_classify: "IA", webhook_out: "Webhook",
};

const CATEGORY_LABELS: Record<string, string> = {
  primeiro_contato: "Primeiro contato", pos_orcamento: "Pós-orçamento",
  pos_visita: "Pós-visita", pos_venda: "Pós-venda",
  reativacao: "Reativação", cobranca: "Cobrança", geral: "Geral",
};

const STATUS_BADGE: Record<string, string> = {
  ativo: "bg-emerald-50 text-emerald-700 border-emerald-200",
  inativo: "bg-slate-100 text-slate-500 border-slate-200",
  rascunho: "bg-amber-50 text-amber-700 border-amber-200",
  arquivado: "bg-red-50 text-red-500 border-red-200",
};
const STATUS_LABELS: Record<string, string> = { ativo: "Ativo", inativo: "Inativo", rascunho: "Rascunho", arquivado: "Arquivado" };

export async function AutomationsHub({ tab = "fluxos", saved, error }: { tab?: string; saved?: boolean; error?: string }) {
  let workflows: Workflow[] = [];
  let executions: Execution[] = [];
  let templates: MessageTemplate[] = [];
  let loadError = "";

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await createClient();
    const [wfRes, exRes, tplRes] = await Promise.all([
      db.from("workflows").select("id,name,description,status,trigger_type,runs_count,success_count,last_run_at,created_at,steps").order("created_at", { ascending: false }),
      db.from("workflow_executions").select("id,workflow_id,status,trigger_type,started_at,completed_at,duration_ms,trigger_data").order("started_at", { ascending: false }).limit(50),
      db.from("message_templates").select("id,name,category,channel,body,usage_count,active").order("category").order("name"),
    ]);
    workflows = (wfRes.data as Workflow[]) ?? [];
    executions = (exRes.data as Execution[]) ?? [];
    templates = (tplRes.data as MessageTemplate[]) ?? [];
    loadError = wfRes.error?.message ?? exRes.error?.message ?? tplRes.error?.message ?? "";
  }

  const activeCount = workflows.filter(w => w.status === "ativo").length;
  const totalRuns30d = executions.filter(e => new Date(e.started_at) > new Date(Date.now() - 30 * 86400000)).length;
  const successRuns = executions.filter(e => e.status === "concluido").length;
  const successRate = executions.length ? Math.round((successRuns / executions.length) * 100) : 0;

  const tabs = [
    { key: "fluxos", label: "Fluxos", icon: <Zap className="h-4 w-4" /> },
    { key: "mensagens", label: "Mensagens", icon: <MessageSquare className="h-4 w-4" /> },
    { key: "execucoes", label: "Execuções", icon: <BarChart3 className="h-4 w-4" /> },
    { key: "webhooks", label: "Webhooks", icon: <Webhook className="h-4 w-4" /> },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-7 flex items-end justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Automações</p>
          <h1 className="mt-2 text-3xl font-black">Central de Automações</h1>
          <p className="mt-1 text-sm text-ink/50">Crie fluxos inteligentes para automatizar seu processo de vendas.</p>
        </div>
        <Link href="/automacoes/novo" className="button-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Novo fluxo
        </Link>
      </div>

      {(error || loadError) && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error || loadError}</p>}
      {saved && <p className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Salvo com sucesso!</p>}

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={Zap} label="Fluxos ativos" value={activeCount} total={workflows.length} color="text-emerald-600" />
        <StatCard icon={Play} label="Execuções (30d)" value={totalRuns30d} color="text-blue-600" />
        <StatCard icon={CheckCircle2} label="Taxa de sucesso" value={`${successRate}%`} color="text-violet-600" />
        <StatCard icon={MessageSquare} label="Templates" value={templates.filter(t => t.active).length} color="text-amber-600" />
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl bg-ink/5 p-1">
        {tabs.map(t => (
          <Link key={t.key} href={`/automacoes?aba=${t.key}`}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tab === t.key ? "bg-white shadow-sm text-ink" : "text-ink/50 hover:text-ink"}`}>
            {t.icon}{t.label}
          </Link>
        ))}
      </div>

      {/* Tab: Fluxos */}
      {tab === "fluxos" && (
        <div className="space-y-3">
          {workflows.length === 0 && (
            <div className="card p-12 text-center">
              <Zap className="h-10 w-10 mx-auto mb-3 text-ink/20" />
              <p className="font-bold text-ink/70">Nenhum fluxo criado ainda</p>
              <p className="mt-1 text-sm text-ink/40">Crie seu primeiro fluxo de automação para começar.</p>
              <Link href="/automacoes/novo" className="button-primary mt-4 inline-flex items-center gap-2">
                <Plus className="h-4 w-4" /> Criar primeiro fluxo
              </Link>
            </div>
          )}
          {workflows.map(wf => (
            <WorkflowCard key={wf.id} workflow={wf} />
          ))}
        </div>
      )}

      {/* Tab: Mensagens */}
      {tab === "mensagens" && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-ink/50">{templates.length} template{templates.length !== 1 ? "s" : ""} disponíveis</p>
            <Link href="/automacoes/mensagens/novo" className="button-ghost flex items-center gap-2 text-sm">
              <Plus className="h-4 w-4" /> Novo template
            </Link>
          </div>
          {Object.entries(CATEGORY_LABELS).map(([cat, catLabel]) => {
            const catTemplates = templates.filter(t => t.category === cat);
            if (!catTemplates.length) return null;
            return (
              <div key={cat} className="mb-6">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-ink/40">{catLabel}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {catTemplates.map(tpl => (
                    <div key={tpl.id} className="card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold truncate">{tpl.name}</span>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${tpl.channel === "whatsapp" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>
                              {tpl.channel === "whatsapp" ? "WhatsApp" : "E-mail"}
                            </span>
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-xs text-ink/50">{tpl.body}</p>
                        </div>
                        <Link href={`/automacoes/mensagens/${tpl.id}`} className="button-ghost shrink-0 p-1.5" title="Editar">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                      <div className="mt-3 flex items-center gap-3 text-xs text-ink/40">
                        <span>{tpl.usage_count} uso{tpl.usage_count !== 1 ? "s" : ""}</span>
                        <span>•</span>
                        <span>{tpl.active ? "Ativo" : "Inativo"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {/* Templates sem categoria reconhecida */}
          {templates.filter(t => !Object.keys(CATEGORY_LABELS).includes(t.category)).length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-ink/40">Outros</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {templates.filter(t => !Object.keys(CATEGORY_LABELS).includes(t.category)).map(tpl => (
                  <div key={tpl.id} className="card p-4">
                    <p className="text-sm font-bold">{tpl.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-ink/50">{tpl.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Execuções */}
      {tab === "execucoes" && (
        <div className="card overflow-hidden">
          {executions.length === 0 && (
            <div className="p-12 text-center text-sm text-ink/40">Nenhuma execução registrada ainda.</div>
          )}
          {executions.length > 0 && (
            <div>
              <div className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-4 border-b px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/40">
                <span>Status</span><span>Fluxo / Gatilho</span><span>Dados</span><span>Duração</span><span>Hora</span>
              </div>
              {executions.map(ex => {
                const wf = workflows.find(w => w.id === ex.workflow_id);
                const statusIcon = ex.status === "concluido" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> :
                  ex.status === "falhou" ? <XCircle className="h-4 w-4 text-red-500" /> :
                  ex.status === "executando" ? <Play className="h-4 w-4 text-blue-500 animate-pulse" /> :
                  <Clock className="h-4 w-4 text-amber-500" />;
                const duration = ex.duration_ms ? `${(ex.duration_ms / 1000).toFixed(1)}s` : "—";
                const triggerData = ex.trigger_data as Record<string, unknown>;
                const dataPreview = Object.entries(triggerData).slice(0, 2).map(([k, v]) => `${k}: ${String(v).slice(0, 20)}`).join(" · ");
                return (
                  <div key={ex.id} className="grid grid-cols-[auto_1fr_1fr_auto_auto] items-center gap-4 border-b px-4 py-3 last:border-0 hover:bg-ink/[.02]">
                    <div title={ex.status}>{statusIcon}</div>
                    <div>
                      <p className="text-sm font-medium truncate">{wf?.name ?? "Fluxo removido"}</p>
                      <p className="text-xs text-ink/40">{TRIGGER_LABELS[ex.trigger_type] ?? ex.trigger_type}</p>
                    </div>
                    <p className="text-xs text-ink/40 truncate">{dataPreview || "—"}</p>
                    <span className="text-sm text-ink/50">{duration}</span>
                    <span className="text-xs text-ink/40 whitespace-nowrap">{new Date(ex.started_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab: Webhooks */}
      {tab === "webhooks" && (
        <div className="card p-8 text-center">
          <Link2 className="h-10 w-10 mx-auto mb-3 text-ink/20" />
          <p className="font-bold">Webhooks de entrada</p>
          <p className="mt-1 text-sm text-ink/50 max-w-md mx-auto">Configure endpoints para disparar fluxos a partir de sistemas externos como formulários, e-commerce, CRMs e qualquer serviço que suporte webhooks.</p>
          <button className="button-primary mt-4 mx-auto flex items-center gap-2 opacity-60 cursor-not-allowed" disabled>
            <Plus className="h-4 w-4" /> Criar webhook (em breve)
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, total, color }: { icon: LucideIcon; label: string; value: string | number; total?: number; color: string }) {
  return (
    <div className="card p-4">
      <Icon className={`h-5 w-5 mb-2 ${color}`} />
      <p className={`text-2xl font-black ${color}`}>{value}{total !== undefined ? <span className="text-sm font-normal text-ink/30 ml-1">/ {total}</span> : null}</p>
      <p className="text-xs text-ink/50 mt-0.5">{label}</p>
    </div>
  );
}

function WorkflowCard({ workflow: wf }: { workflow: Workflow }) {
  const steps = Array.isArray(wf.steps) ? wf.steps : [];
  const rate = wf.runs_count > 0 ? Math.round((wf.success_count / wf.runs_count) * 100) : null;
  const TriggerIcon = TRIGGER_ICONS[wf.trigger_type] ?? Zap;
  return (
    <div className="card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 rounded-lg bg-ink/5 p-2"><TriggerIcon className="h-4 w-4 text-ink/50" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-sm">{wf.name}</span>
            <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[wf.status] ?? STATUS_BADGE.inativo}`}>
              {STATUS_LABELS[wf.status] ?? wf.status}
            </span>
          </div>
          {wf.description && <p className="mt-0.5 text-xs text-ink/50 line-clamp-1">{wf.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/40">
            <span>{TRIGGER_LABELS[wf.trigger_type] ?? wf.trigger_type}</span>
            <span>• {steps.length} passo{steps.length !== 1 ? "s" : ""}</span>
            {wf.runs_count > 0 && <span>• {wf.runs_count} execuções</span>}
            {rate !== null && <span>• {rate}% sucesso</span>}
            {wf.last_run_at && <span>• Última execução {new Date(wf.last_run_at).toLocaleDateString("pt-BR")}</span>}
          </div>
          {steps.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {steps.slice(0, 5).map((s, i) => (
                <span key={i} className="rounded bg-ink/5 px-2 py-0.5 text-[11px] font-medium text-ink/60">
                  {STEP_TYPE_LABELS[s.type] ?? s.type}
                </span>
              ))}
              {steps.length > 5 && <span className="rounded bg-ink/5 px-2 py-0.5 text-[11px] text-ink/40">+{steps.length - 5}</span>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <form action={toggleWorkflow}>
            <input type="hidden" name="id" value={wf.id} />
            <input type="hidden" name="current_status" value={wf.status} />
            <button type="submit" className="button-ghost p-2" title={wf.status === "ativo" ? "Pausar" : "Ativar"}>
              {wf.status === "ativo" ? <Pause className="h-4 w-4 text-amber-500" /> : <Play className="h-4 w-4 text-emerald-500" />}
            </button>
          </form>
          <Link href={`/automacoes/${wf.id}/editar`} className="button-ghost p-2" title="Editar">
            <ArrowRight className="h-4 w-4" />
          </Link>
          <form action={deleteWorkflow}>
            <input type="hidden" name="id" value={wf.id} />
            <ConfirmButton formAction={deleteWorkflow} message={`Excluir o fluxo "${wf.name}"? Esta ação não pode ser desfeita.`} className="button-ghost p-2 text-red-400 hover:text-red-600" title="Excluir">
              <Trash2 className="h-4 w-4" />
            </ConfirmButton>
          </form>
        </div>
      </div>
    </div>
  );
}
