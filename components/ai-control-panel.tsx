"use client";
import { useState } from "react";
import { AlertTriangle, Bot, BookOpen, Brain, CheckCircle, ChevronRight, Clock, Cpu, FileText, Flame, History, Layers, Pause, Play, Plus, RefreshCw, Settings, Shield, Sliders, TestTube, TrendingUp, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "dashboard" | "autonomia" | "conhecimento" | "regras" | "automacoes" | "auditoria" | "decisoes" | "melhorias";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Dashboard", icon: Cpu },
  { id: "autonomia", label: "Autonomia", icon: Sliders },
  { id: "conhecimento", label: "Conhecimento", icon: BookOpen },
  { id: "regras", label: "Regras", icon: Shield },
  { id: "automacoes", label: "Automações", icon: Zap },
  { id: "auditoria", label: "Auditoria", icon: History },
  { id: "decisoes", label: "Decisões", icon: Brain },
  { id: "melhorias", label: "Melhorias", icon: TrendingUp },
];

const AUTONOMY_LEVELS = [
  { level: 0, label: "Desativada", desc: "IA inativa. Apenas disponível para consultas.", color: "bg-ink/20 text-ink/50", dot: "bg-ink/30" },
  { level: 1, label: "Observadora", desc: "Monitora o sistema e informa alertas. Não executa nada.", color: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  { level: 2, label: "Assistente", desc: "Sugere ações. Toda ação exige aprovação humana.", color: "bg-yellow-100 text-yellow-700", dot: "bg-yellow-500" },
  { level: 3, label: "Semi-Autônoma", desc: "Executa automações aprovadas. Ações críticas exigem aprovação.", color: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  { level: 4, label: "Operacional", desc: "Executa todas as automações autorizadas. Registro completo.", color: "bg-lime/30 text-forest", dot: "bg-lime" },
];

const MOCK_KNOWLEDGE = [
  { id: 1, title: "Atendimento de Manutenções", category: "Atendimento", version: "v2.0", status: true, author: "Admin", updated: "21/06/2026", desc: "Solicitações de manutenção não entram no funil de vendas." },
  { id: 2, title: "Follow-up Comercial", category: "Comercial", version: "v1.2", status: true, author: "Admin", updated: "20/06/2026", desc: "Orçamentos sem retorno após 4 dias recebem mensagem automática." },
  { id: 3, title: "Classificação de Leads Premium", category: "Comercial", version: "v1.0", status: true, author: "Admin", updated: "19/06/2026", desc: "Leads com projeto + medidas + fotos + prazo <30 dias + valor >R$20k são PRIORIDADE MÁXIMA." },
  { id: 4, title: "Triagem de Orçamentos", category: "Orçamentos", version: "v1.1", status: false, author: "Admin", updated: "18/06/2026", desc: "Orçamentos acima de R$50k passam por aprovação do gerente antes de envio." },
];

const MOCK_RULES = [
  { id: 1, name: "Rota Manutenção", category: "Atendimento", condition: "Cliente solicitar manutenção", action: "Mover para assistência técnica", responsible: "Ana (IA)", status: true },
  { id: 2, name: "Follow-up Automático", category: "Comercial", condition: "Orçamento parado há +4 dias", action: "Enviar mensagem de retorno", responsible: "Ana (IA)", status: true },
  { id: 3, name: "Alerta Lead Premium", category: "Comercial", condition: "Score ≥ 85 ou valor >R$20k", action: "Notificar vendedor + PRIORIDADE MÁXIMA", responsible: "Ana (IA)", status: true },
  { id: 4, name: "Cobrança Vencida", category: "Financeiro", condition: "Parcela vencida há +3 dias", action: "Enviar lembrete ao cliente", responsible: "Admin", status: false },
];

const MOCK_AUTOMATIONS = [
  { id: 1, name: "Follow-up Comercial", status: true, executions: 127, lastRun: "Hoje às 08:22", successRate: 41, category: "Comercial" },
  { id: 2, name: "Triagem Inicial (Ana)", status: true, executions: 89, lastRun: "Hoje às 09:15", successRate: 94, category: "Atendimento" },
  { id: 3, name: "Alerta Produção Atrasada", status: true, executions: 23, lastRun: "Ontem às 17:00", successRate: 78, category: "Produção" },
  { id: 4, name: "Relatório Diário", status: false, executions: 45, lastRun: "19/06/2026", successRate: 100, category: "Administrativo" },
];

const MOCK_AUDIT = [
  { id: 1, date: "21/06/2026 09:15", action: "Triagem iniciada", detail: "Cliente: João Pedro | Motivo: Novo contato via WhatsApp | Resultado: Lead criado com Score 78", type: "success" },
  { id: 2, date: "21/06/2026 08:22", action: "Follow-up enviado", detail: "Cliente: Carlos Souza | Motivo: Orçamento parado há 4 dias | Resultado: Cliente respondeu", type: "success" },
  { id: 3, date: "21/06/2026 07:50", action: "Lead PREMIUM detectado", detail: "Cliente: Construtora Alpha | Motivo: Score 92, valor R$45k | Resultado: Vendedor notificado", type: "alert" },
  { id: 4, date: "20/06/2026 18:30", action: "Automação pausada", detail: "Cobrança Vencida | Motivo: Pausada manualmente pelo Admin | Resultado: Aguardando reativação", type: "warning" },
  { id: 5, date: "20/06/2026 16:10", action: "Regra atualizada", detail: "Follow-up Comercial v1.1 → v1.2 | Motivo: Prazo alterado de 5 para 4 dias | Por: Admin", type: "info" },
];

const MOCK_DECISIONS = [
  { id: 1, problem: "12 orçamentos sem retorno", rule: "Follow-up Comercial v1.2", action: "Enviar mensagem automática", impact: "Recuperar entre 2 e 4 negociações", priority: "alta" },
  { id: 2, problem: "3 produções atrasadas", rule: "Alerta Produção v1.0", action: "Notificar responsável de produção", impact: "Evitar atraso na entrega de 3 clientes", priority: "maxima" },
  { id: 3, problem: "Lead premium sem atendimento (2h)", rule: "Alerta Lead Premium v1.0", action: "Escalar para gerente de vendas", impact: "Evitar perda de negócio de R$45k", priority: "maxima" },
];

const MOCK_IMPROVEMENTS = [
  { id: 1, title: "Gargalo no Pipeline", desc: "47% dos orçamentos ficam parados na etapa 'Aguardando Visita' por mais de 7 dias. Sugestão: criar alerta automático de agendamento.", impact: "alto", category: "Comercial", status: "pendente" },
  { id: 2, title: "Retrabalho em Orçamentos", desc: "Orçamentos de calhas são recriados manualmente com frequência. Sugestão: modelo de orçamento pré-preenchido por tipo de produto.", impact: "medio", category: "Orçamentos", status: "aprovado" },
  { id: 3, title: "Falha Comercial Identificada", desc: "Clientes de obras acima de R$30k têm taxa de fechamento 3x maior quando recebem visita técnica. Sugestão: priorizar visita para esse perfil.", impact: "alto", category: "Comercial", status: "pendente" },
];

export function AiControlPanel({ tab: initialTab = "dashboard" }: { tab?: string }) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || "dashboard");
  const [autonomyLevel, setAutonomyLevel] = useState(3);
  const [paused, setPaused] = useState(false);
  const [knowledge, setKnowledge] = useState(MOCK_KNOWLEDGE);
  const [rules, setRules] = useState(MOCK_RULES);
  const [automations, setAutomations] = useState(MOCK_AUTOMATIONS);
  const [showTeachModal, setShowTeachModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const activeRules = rules.filter(r => r.status).length;
  const activeAutomations = automations.filter(a => a.status).length;
  const totalExec = automations.reduce((s, a) => s + a.executions, 0);
  const avgSuccess = Math.round(automations.reduce((s, a) => s + a.successRate, 0) / automations.length);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-forest" />
            <h1 className="text-2xl font-black">Central de Controle da IA</h1>
          </div>
          <p className="mt-1 text-sm text-ink/50">CRM Bielenki OS — Versão Profissional</p>
        </div>
        <button
          onClick={() => setPaused(!paused)}
          className={cn(
            "flex items-center gap-2 rounded-xl px-5 py-3 font-bold text-sm transition",
            paused ? "bg-lime text-forest" : "bg-red-600 text-white hover:bg-red-700"
          )}
        >
          {paused ? <><Play className="h-4 w-4" /> REATIVAR IA</> : <><Pause className="h-4 w-4" /> PAUSAR IA</>}
        </button>
      </div>

      {paused && (
        <div className="rounded-xl border-2 border-red-200 bg-red-50 px-5 py-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
          <div>
            <p className="font-bold text-red-700">IA PAUSADA — Todas as automações foram interrompidas.</p>
            <p className="text-sm text-red-600">A IA permanece disponível apenas para consultas. Clique em REATIVAR IA para retomar.</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl bg-cream p-1">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
                tab === t.id ? "bg-white text-ink shadow-sm" : "text-ink/50 hover:text-ink"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* DASHBOARD */}
      {tab === "dashboard" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Regras ativas", value: activeRules, sub: `${rules.length - activeRules} inativas`, icon: Shield, color: "text-forest" },
              { label: "Automações ativas", value: activeAutomations, sub: `${automations.length - activeAutomations} pausadas`, icon: Zap, color: "text-blue-600" },
              { label: "Execuções totais", value: totalExec, sub: "desde o início", icon: RefreshCw, color: "text-orange-600" },
              { label: "Taxa de sucesso", value: `${avgSuccess}%`, sub: "média das automações", icon: TrendingUp, color: "text-lime-700" },
            ].map(card => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="card p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-ink/40">{card.label}</p>
                      <p className={cn("mt-1 text-3xl font-black", card.color)}>{card.value}</p>
                      <p className="mt-1 text-xs text-ink/50">{card.sub}</p>
                    </div>
                    <Icon className={cn("h-8 w-8 opacity-20", card.color)} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Saúde da IA */}
            <div className="card p-5 space-y-4">
              <h3 className="font-bold flex items-center gap-2"><Cpu className="h-4 w-4 text-forest" /> Saúde da IA</h3>
              {[
                { label: "Nível de autonomia", value: `Nível ${autonomyLevel} — ${AUTONOMY_LEVELS[autonomyLevel].label}`, ok: !paused },
                { label: "Regras configuradas", value: `${activeRules} ativas de ${rules.length}`, ok: true },
                { label: "Base de conhecimento", value: `${knowledge.filter(k => k.status).length} registros ativos`, ok: true },
                { label: "Automações rodando", value: `${activeAutomations} de ${automations.length}`, ok: activeAutomations > 0 },
                { label: "Status geral", value: paused ? "PAUSADA" : "OPERANDO NORMALMENTE", ok: !paused },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between text-sm">
                  <span className="text-ink/60">{row.label}</span>
                  <span className={cn("font-medium flex items-center gap-1", row.ok ? "text-forest" : "text-red-600")}>
                    {row.ok ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Alertas ativos */}
            <div className="card p-5 space-y-3">
              <h3 className="font-bold flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-orange-500" /> Alertas Ativos</h3>
              {MOCK_DECISIONS.map(d => (
                <div key={d.id} className={cn("rounded-lg p-3 text-sm", d.priority === "maxima" ? "bg-red-50 border border-red-200" : "bg-yellow-50 border border-yellow-200")}>
                  <div className="flex items-center gap-2 font-bold">
                    <Flame className={cn("h-3 w-3", d.priority === "maxima" ? "text-red-600" : "text-yellow-600")} />
                    <span className={d.priority === "maxima" ? "text-red-700" : "text-yellow-700"}>{d.problem}</span>
                  </div>
                  <p className="mt-1 text-ink/60">{d.action}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* AUTONOMIA */}
      {tab === "autonomia" && (
        <div className="space-y-4">
          <div className="card p-6">
            <h3 className="font-bold text-lg mb-1">Nível de Autonomia da IA</h3>
            <p className="text-sm text-ink/50 mb-6">Controle o quanto a IA pode agir de forma independente dentro do sistema.</p>
            <div className="space-y-3">
              {AUTONOMY_LEVELS.map(lvl => (
                <button
                  key={lvl.level}
                  onClick={() => setAutonomyLevel(lvl.level)}
                  className={cn(
                    "w-full flex items-center gap-4 rounded-xl border-2 p-4 text-left transition",
                    autonomyLevel === lvl.level ? "border-forest bg-lime/10" : "border-cream hover:border-ink/20"
                  )}
                >
                  <div className={cn("h-10 w-10 rounded-full flex items-center justify-center font-black text-lg shrink-0", lvl.color)}>
                    {lvl.level}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold">{lvl.label}</p>
                    <p className="text-sm text-ink/60">{lvl.desc}</p>
                  </div>
                  {autonomyLevel === lvl.level && <CheckCircle className="h-5 w-5 text-forest shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CONHECIMENTO */}
      {tab === "conhecimento" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg">Base de Conhecimento</h3>
            <button onClick={() => setShowTeachModal(true)} className="button flex items-center gap-2 text-sm">
              <Plus className="h-4 w-4" /> ENSINAR IA
            </button>
          </div>
          <div className="space-y-3">
            {knowledge.map(k => (
              <div key={k.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-bold">{k.title}</span>
                      <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-ink/50">{k.category}</span>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-600">{k.version}</span>
                    </div>
                    <p className="text-sm text-ink/60">{k.desc}</p>
                    <p className="mt-2 text-xs text-ink/40">Por {k.author} · Atualizado {k.updated}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setKnowledge(prev => prev.map(x => x.id === k.id ? { ...x, status: !x.status } : x))}
                      className={cn("relative h-6 w-11 rounded-full transition", k.status ? "bg-forest" : "bg-ink/20")}
                    >
                      <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white transition-all", k.status ? "left-6" : "left-1")} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {showTeachModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
              <div className="card w-full max-w-lg p-6 space-y-4">
                <h3 className="font-black text-lg">Ensinar IA</h3>
                <div className="space-y-3">
                  <div><label className="label">Título</label><input className="field" placeholder="Ex: Atendimento de Manutenções" /></div>
                  <div><label className="label">Categoria</label>
                    <select className="field"><option>Comercial</option><option>Atendimento</option><option>Orçamentos</option><option>Produção</option><option>Financeiro</option></select>
                  </div>
                  <div><label className="label">Regra / Processo</label><textarea className="field min-h-[100px]" placeholder="Descreva a regra que a IA deve seguir..." /></div>
                  <div><label className="label">Prioridade</label>
                    <select className="field"><option>Alta</option><option>Média</option><option>Baixa</option></select>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button className="button flex-1">Salvar Conhecimento</button>
                  <button onClick={() => setShowTeachModal(false)} className="button-ghost flex-1">Cancelar</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* REGRAS */}
      {tab === "regras" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg">Regras da IA</h3>
            <button className="button flex items-center gap-2 text-sm"><Plus className="h-4 w-4" /> Nova Regra</button>
          </div>
          <div className="space-y-3">
            {rules.map(r => (
              <div key={r.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{r.name}</span>
                      <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-ink/50">{r.category}</span>
                    </div>
                    <div className="rounded-lg bg-cream p-3 text-sm space-y-1">
                      <p><span className="font-bold text-ink/50">SE</span> &nbsp;{r.condition}</p>
                      <p><span className="font-bold text-ink/50">ENTÃO</span> &nbsp;{r.action}</p>
                      <p><span className="font-bold text-ink/50">RESPONSÁVEL</span> &nbsp;{r.responsible}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setRules(prev => prev.map(x => x.id === r.id ? { ...x, status: !x.status } : x))}
                    className={cn("relative h-6 w-11 rounded-full transition shrink-0", r.status ? "bg-forest" : "bg-ink/20")}
                  >
                    <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white transition-all", r.status ? "left-6" : "left-1")} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AUTOMAÇÕES */}
      {tab === "automacoes" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg">Central de Automações</h3>
            <button className="button flex items-center gap-2 text-sm"><Plus className="h-4 w-4" /> Nova Automação</button>
          </div>
          <div className="space-y-3">
            {automations.map(a => (
              <div key={a.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{a.name}</span>
                      <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-ink/50">{a.category}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", a.status ? "bg-lime/30 text-forest" : "bg-ink/10 text-ink/40")}>
                        {a.status ? "✓ Ativo" : "Pausado"}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div><p className="text-xs text-ink/40">Execuções</p><p className="font-bold">{a.executions}x</p></div>
                      <div><p className="text-xs text-ink/40">Última execução</p><p className="font-bold">{a.lastRun}</p></div>
                      <div><p className="text-xs text-ink/40">Taxa de sucesso</p>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-cream overflow-hidden">
                            <div className="h-full bg-forest rounded-full" style={{ width: `${a.successRate}%` }} />
                          </div>
                          <span className="font-bold text-xs">{a.successRate}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => { setShowTestModal(a.id); setTestResult(null); }}
                      className="flex items-center gap-1 rounded-lg border border-ink/20 px-3 py-1.5 text-xs font-bold hover:bg-cream"
                    >
                      <TestTube className="h-3 w-3" /> Simular
                    </button>
                    <button
                      onClick={() => setAutomations(prev => prev.map(x => x.id === a.id ? { ...x, status: !x.status } : x))}
                      className={cn("relative h-6 w-11 rounded-full transition", a.status ? "bg-forest" : "bg-ink/20")}
                    >
                      <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white transition-all", a.status ? "left-6" : "left-1")} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {showTestModal !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
              <div className="card w-full max-w-lg p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <TestTube className="h-5 w-5 text-blue-600" />
                  <h3 className="font-black text-lg">Modo Teste — Simulação</h3>
                </div>
                <p className="text-sm text-ink/60">A IA mostrará exatamente o que faria, sem executar nada.</p>
                {!testResult ? (
                  <button
                    className="button w-full"
                    onClick={() => setTestResult(`✓ 7 clientes seriam afetados\n✓ Mensagem: "Olá! Ainda tem interesse no orçamento que enviamos?"\n✓ Etapa: Aguardando Retorno → Em Negociação\n✓ Tarefas criadas: 7\n✗ Nenhuma ação real foi executada.`)}
                  >
                    Executar Simulação
                  </button>
                ) : (
                  <div className="rounded-xl bg-ink p-4 text-sm text-white font-mono whitespace-pre-line">{testResult}</div>
                )}
                <button onClick={() => setShowTestModal(null)} className="button-ghost w-full">Fechar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AUDITORIA */}
      {tab === "auditoria" && (
        <div className="space-y-4">
          <h3 className="font-bold text-lg">Auditoria da IA</h3>
          <div className="space-y-2">
            {MOCK_AUDIT.map(log => (
              <div key={log.id} className={cn("card p-4 border-l-4", {
                "border-l-forest": log.type === "success",
                "border-l-red-500": log.type === "alert",
                "border-l-yellow-500": log.type === "warning",
                "border-l-blue-500": log.type === "info",
              })}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-3 w-3 text-ink/40" />
                      <span className="text-xs text-ink/40">{log.date}</span>
                    </div>
                    <p className="font-bold mt-1">{log.action}</p>
                    <p className="text-sm text-ink/60 mt-0.5">{log.detail}</p>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", {
                    "bg-lime/30 text-forest": log.type === "success",
                    "bg-red-100 text-red-700": log.type === "alert",
                    "bg-yellow-100 text-yellow-700": log.type === "warning",
                    "bg-blue-100 text-blue-700": log.type === "info",
                  })}>
                    {log.type === "success" ? "Sucesso" : log.type === "alert" ? "Alerta" : log.type === "warning" ? "Aviso" : "Info"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DECISÕES */}
      {tab === "decisoes" && (
        <div className="space-y-4">
          <h3 className="font-bold text-lg">Central de Decisões</h3>
          <div className="space-y-4">
            {MOCK_DECISIONS.map(d => (
              <div key={d.id} className={cn("card p-5 border-l-4", d.priority === "maxima" ? "border-l-red-500" : "border-l-orange-400")}>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Flame className={cn("h-4 w-4", d.priority === "maxima" ? "text-red-600" : "text-orange-500")} />
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-black uppercase", d.priority === "maxima" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700")}>
                      Prioridade {d.priority}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-cream p-3 text-sm">
                      <p className="text-xs font-bold text-ink/40 mb-1">PROBLEMA ENCONTRADO</p>
                      <p className="font-medium">{d.problem}</p>
                    </div>
                    <div className="rounded-lg bg-cream p-3 text-sm">
                      <p className="text-xs font-bold text-ink/40 mb-1">REGRA UTILIZADA</p>
                      <p className="font-medium">{d.rule}</p>
                    </div>
                    <div className="rounded-lg bg-cream p-3 text-sm">
                      <p className="text-xs font-bold text-ink/40 mb-1">AÇÃO RECOMENDADA</p>
                      <p className="font-medium">{d.action}</p>
                    </div>
                    <div className="rounded-lg bg-lime/20 p-3 text-sm">
                      <p className="text-xs font-bold text-ink/40 mb-1">IMPACTO ESPERADO</p>
                      <p className="font-medium text-forest">{d.impact}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button className="button text-sm flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Aprovar ação</button>
                    <button className="button-ghost text-sm">Ignorar</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MELHORIAS */}
      {tab === "melhorias" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg">Assistente de Melhorias</h3>
            <button className="button flex items-center gap-2 text-sm"><RefreshCw className="h-4 w-4" /> Analisar agora</button>
          </div>
          <div className="space-y-3">
            {MOCK_IMPROVEMENTS.map(m => (
              <div key={m.id} className="card p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{m.title}</span>
                      <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-ink/50">{m.category}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", m.impact === "alto" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700")}>
                        Impacto {m.impact}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-ink/60">{m.desc}</p>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold shrink-0", m.status === "aprovado" ? "bg-lime/30 text-forest" : "bg-yellow-100 text-yellow-700")}>
                    {m.status === "aprovado" ? "✓ Aprovado" : "Pendente"}
                  </span>
                </div>
                {m.status === "pendente" && (
                  <div className="flex gap-2">
                    <button className="button text-sm flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Aprovar</button>
                    <button className="button-ghost text-sm">Recusar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
