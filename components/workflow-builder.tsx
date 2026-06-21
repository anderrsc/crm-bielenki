"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Save, Play, GripVertical } from "lucide-react";
import { saveWorkflow } from "@/app/(crm)/actions";

type Step = {
  id: string; type: string; name: string;
  config: Record<string, string | number | boolean>;
};
type Condition = { id: string; field: string; operator: string; value: string };

type WorkflowData = {
  id?: string; name: string; description: string; status: string;
  trigger_type: string; trigger_config: Record<string, string>;
  conditions: Condition[]; steps: Step[];
};

type Props = {
  workflow?: WorkflowData;
  templates: Array<{ id: string; name: string; channel: string }>;
};

const TRIGGER_OPTIONS = [
  { value: "lead_criado", label: "👤 Novo lead criado", group: "Leads" },
  { value: "lead_atualizado", label: "✏️ Lead atualizado", group: "Leads" },
  { value: "orcamento_criado", label: "📋 Orçamento criado", group: "Orçamentos" },
  { value: "orcamento_enviado", label: "📤 Orçamento enviado", group: "Orçamentos" },
  { value: "orcamento_aprovado", label: "✅ Orçamento aprovado", group: "Orçamentos" },
  { value: "orcamento_rejeitado", label: "❌ Orçamento rejeitado", group: "Orçamentos" },
  { value: "instalacao_agendada", label: "📅 Visita / instalação agendada", group: "Instalações" },
  { value: "instalacao_concluida", label: "🔧 Instalação concluída", group: "Instalações" },
  { value: "pagamento_recebido", label: "💰 Pagamento recebido", group: "Financeiro" },
  { value: "pagamento_vencido", label: "⚠️ Pagamento vencido", group: "Financeiro" },
  { value: "scheduled", label: "⏰ Agendado (cron)", group: "Sistema" },
  { value: "webhook", label: "🔗 Webhook externo", group: "Sistema" },
  { value: "manual", label: "▶️ Disparo manual", group: "Sistema" },
];

const STEP_TYPES = [
  { value: "send_whatsapp", label: "📱 Enviar WhatsApp", color: "text-emerald-600" },
  { value: "send_email", label: "📧 Enviar E-mail", color: "text-blue-600" },
  { value: "wait", label: "⏳ Aguardar tempo", color: "text-amber-600" },
  { value: "condition", label: "🔀 Condição / Bifurcação", color: "text-violet-600" },
  { value: "notify_user", label: "🔔 Notificar usuário interno", color: "text-orange-600" },
  { value: "update_lead", label: "✏️ Atualizar lead", color: "text-teal-600" },
  { value: "ai_classify", label: "🤖 IA — Classificar / Gerar", color: "text-fuchsia-600" },
  { value: "webhook_out", label: "🔗 Enviar webhook", color: "text-slate-600" },
];

const CONDITION_FIELDS = [
  { value: "lead_source", label: "Origem do lead" },
  { value: "lead_city", label: "Cidade do lead" },
  { value: "lead_status", label: "Status do lead" },
  { value: "quote_total", label: "Valor do orçamento" },
  { value: "quote_status", label: "Status do orçamento" },
  { value: "client_type", label: "Tipo de cliente" },
  { value: "payment_amount", label: "Valor do pagamento" },
  { value: "days_since_created", label: "Dias desde criação" },
];

const CONDITION_OPERATORS = [
  { value: "eq", label: "é igual a" },
  { value: "neq", label: "é diferente de" },
  { value: "contains", label: "contém" },
  { value: "gt", label: "maior que" },
  { value: "lt", label: "menor que" },
  { value: "gte", label: "maior ou igual a" },
  { value: "lte", label: "menor ou igual a" },
  { value: "empty", label: "está vazio" },
  { value: "not_empty", label: "não está vazio" },
];

const WAIT_PRESETS = [
  { label: "30 min", hours: 0.5 },
  { label: "1h", hours: 1 },
  { label: "2h", hours: 2 },
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
  { label: "3 dias", hours: 72 },
  { label: "7 dias", hours: 168 },
  { label: "15 dias", hours: 360 },
  { label: "30 dias", hours: 720 },
];

const ROLES = [
  { value: "administrador", label: "Administrador" },
  { value: "gerente", label: "Gerente" },
  { value: "vendedor", label: "Vendedor" },
  { value: "financeiro", label: "Financeiro" },
  { value: "instalador", label: "Instalador" },
  { value: "atendente", label: "Atendente" },
];

function uid() { return Math.random().toString(36).slice(2, 9); }

export function WorkflowBuilder({ workflow, templates }: Props) {
  const [name, setName] = useState(workflow?.name ?? "");
  const [description, setDescription] = useState(workflow?.description ?? "");
  const [triggerType, setTriggerType] = useState(workflow?.trigger_type ?? "lead_criado");
  const [conditions, setConditions] = useState<Condition[]>(workflow?.conditions ?? []);
  const [steps, setSteps] = useState<Step[]>(workflow?.steps ?? []);
  const [saving, startSave] = useTransition();
  const [activating, startActivate] = useTransition();
  const [error, setError] = useState("");

  const whatsappTemplates = templates.filter(t => t.channel === "whatsapp");
  const emailTemplates = templates.filter(t => t.channel === "email");

  function addCondition() {
    setConditions(prev => [...prev, { id: uid(), field: "lead_source", operator: "eq", value: "" }]);
  }
  function removeCondition(id: string) { setConditions(prev => prev.filter(c => c.id !== id)); }
  function updateCondition(id: string, key: keyof Condition, val: string) {
    setConditions(prev => prev.map(c => c.id === id ? { ...c, [key]: val } : c));
  }

  function addStep(type: string) {
    const typeInfo = STEP_TYPES.find(s => s.value === type);
    const defaultConfig: Record<string, string | number | boolean> = {};
    if (type === "send_whatsapp") defaultConfig.template = whatsappTemplates[0]?.name ?? "";
    if (type === "send_email") defaultConfig.template = emailTemplates[0]?.name ?? "";
    if (type === "wait") { defaultConfig.hours = 24; defaultConfig.preset = "24h"; }
    if (type === "notify_user") { defaultConfig.message = ""; defaultConfig.role = "gerente"; }
    if (type === "update_lead") { defaultConfig.field = "status"; defaultConfig.value = ""; }
    if (type === "ai_classify") { defaultConfig.prompt = ""; defaultConfig.model = "gpt-4o"; }
    if (type === "webhook_out") { defaultConfig.url = ""; defaultConfig.method = "POST"; }
    if (type === "condition") { defaultConfig.field = "lead_source"; defaultConfig.operator = "eq"; defaultConfig.value = ""; }
    setSteps(prev => [...prev, { id: uid(), type, name: typeInfo?.label.replace(/^[^ ]+ /, "") ?? type, config: defaultConfig }]);
  }
  function removeStep(id: string) { setSteps(prev => prev.filter(s => s.id !== id)); }
  function moveStep(id: string, dir: -1 | 1) {
    setSteps(prev => {
      const i = prev.findIndex(s => s.id === id);
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function updateStepName(id: string, val: string) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, name: val } : s));
  }
  function updateStepConfig(id: string, key: string, val: string | number | boolean) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, config: { ...s.config, [key]: val } } : s));
  }

  function buildFormData(status: string) {
    if (!name.trim()) { setError("Informe o nome do fluxo."); return null; }
    if (steps.length === 0) { setError("Adicione pelo menos um passo."); return null; }
    setError("");
    const fd = new FormData();
    if (workflow?.id) fd.append("id", workflow.id);
    fd.append("name", name);
    fd.append("description", description);
    fd.append("status", status);
    fd.append("trigger_type", triggerType);
    fd.append("conditions", JSON.stringify(conditions));
    fd.append("steps", JSON.stringify(steps));
    return fd;
  }

  function handleSave(status: string) {
    const fd = buildFormData(status);
    if (!fd) return;
    startSave(async () => { await saveWorkflow(fd); });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/automacoes" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-ink/55">
        <ArrowLeft className="h-4 w-4" />Voltar para Automações
      </Link>
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Automações</p>
        <h1 className="mt-2 text-3xl font-black">{workflow?.id ? "Editar fluxo" : "Novo fluxo"}</h1>
      </div>

      {error && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      {/* Identidade */}
      <div className="card mb-4 p-5">
        <h2 className="mb-4 text-sm font-bold">Identificação</h2>
        <div className="space-y-3">
          <div>
            <label className="label">Nome do fluxo <span className="text-red-500">*</span></label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Boas-vindas ao lead" />
          </div>
          <div>
            <label className="label">Descrição (opcional)</label>
            <textarea className="input resize-none" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Descreva o objetivo deste fluxo..." />
          </div>
        </div>
      </div>

      {/* Gatilho */}
      <div className="card mb-4 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-forest text-white text-xs font-black">G</div>
          <h2 className="text-sm font-bold">Gatilho — quando executar?</h2>
        </div>
        <select className="input" value={triggerType} onChange={e => setTriggerType(e.target.value)}>
          {Object.entries(
            TRIGGER_OPTIONS.reduce<Record<string, typeof TRIGGER_OPTIONS>>((acc, t) => {
              (acc[t.group] ??= []).push(t); return acc;
            }, {})
          ).map(([group, opts]) => (
            <optgroup key={group} label={group}>
              {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          ))}
        </select>
        {triggerType === "scheduled" && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
            ⏰ Fluxos agendados requerem configuração do pg_cron no Supabase. Configure o dispatcher para executar este fluxo periodicamente.
          </div>
        )}
      </div>

      {/* Condições */}
      <div className="card mb-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-white text-xs font-black">C</div>
            <h2 className="text-sm font-bold">Condições — filtrar quando executar</h2>
          </div>
          <button onClick={addCondition} className="button-ghost flex items-center gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> Adicionar condição
          </button>
        </div>
        {conditions.length === 0 && (
          <p className="text-xs text-ink/40 text-center py-4">Sem condições — o fluxo executa para todos os eventos deste gatilho.</p>
        )}
        {conditions.map((cond, i) => (
          <div key={cond.id} className="mb-2 flex items-center gap-2 rounded-lg bg-ink/[.03] p-3">
            {i > 0 && <span className="shrink-0 text-xs font-bold text-violet-600 w-6 text-right">E</span>}
            {i === 0 && <span className="shrink-0 text-xs font-bold text-ink/30 w-6 text-right">SE</span>}
            <select className="input flex-1 text-xs" value={cond.field} onChange={e => updateCondition(cond.id, "field", e.target.value)}>
              {CONDITION_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <select className="input text-xs" style={{ width: "auto" }} value={cond.operator} onChange={e => updateCondition(cond.id, "operator", e.target.value)}>
              {CONDITION_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {!["empty", "not_empty"].includes(cond.operator) && (
              <input className="input flex-1 text-xs" value={cond.value} onChange={e => updateCondition(cond.id, "value", e.target.value)} placeholder="valor" />
            )}
            <button onClick={() => removeCondition(cond.id)} className="button-ghost shrink-0 p-1.5 text-red-400">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Passos */}
      <div className="card mb-4 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white text-xs font-black">A</div>
          <h2 className="text-sm font-bold">Ações — o que fazer?</h2>
        </div>

        {steps.length === 0 && (
          <div className="mb-4 rounded-xl border-2 border-dashed border-ink/10 p-8 text-center text-sm text-ink/40">
            Nenhuma ação adicionada. Escolha uma ação abaixo.
          </div>
        )}

        <div className="space-y-3 mb-5">
          {steps.map((step, i) => (
            <div key={step.id} className="rounded-xl border border-ink/10 bg-ink/[.015] p-4">
              <div className="flex items-start gap-3">
                <div className="flex flex-col gap-1 mt-0.5">
                  <button onClick={() => moveStep(step.id, -1)} disabled={i === 0} className="button-ghost p-0.5 disabled:opacity-20">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[11px] font-black text-white">{i + 1}</span>
                  <button onClick={() => moveStep(step.id, 1)} disabled={i === steps.length - 1} className="button-ghost p-0.5 disabled:opacity-20">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-bold text-ink/40 uppercase tracking-wide">{STEP_TYPES.find(s => s.value === step.type)?.label ?? step.type}</span>
                  </div>
                  <input
                    className="input mb-3 text-sm font-medium"
                    value={step.name}
                    onChange={e => updateStepName(step.id, e.target.value)}
                    placeholder="Nome do passo"
                  />
                  <StepConfig step={step} updateConfig={updateStepConfig} whatsappTemplates={whatsappTemplates} emailTemplates={emailTemplates} />
                </div>
                <button onClick={() => removeStep(step.id)} className="button-ghost shrink-0 p-1.5 text-red-400 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add step */}
        <div>
          <p className="mb-2 text-xs font-bold text-ink/40 uppercase tracking-wide">Adicionar passo</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STEP_TYPES.map(st => (
              <button key={st.value} onClick={() => addStep(st.value)}
                className="rounded-lg border border-ink/10 bg-white p-2.5 text-left text-xs hover:border-forest hover:bg-forest/5 transition-colors">
                <span className={`font-medium ${st.color}`}>{st.label.split(" ").slice(0, 2).join(" ")}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Link href="/automacoes" className="button-ghost">Cancelar</Link>
        <div className="flex gap-2">
          <button onClick={() => handleSave("rascunho")} disabled={saving}
            className="button-ghost flex items-center gap-2">
            <Save className="h-4 w-4" />{saving ? "Salvando..." : "Salvar rascunho"}
          </button>
          <button onClick={() => handleSave("ativo")} disabled={saving || activating}
            className="button-primary flex items-center gap-2">
            <Play className="h-4 w-4" />{activating ? "Ativando..." : "Salvar e ativar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepConfig({ step, updateConfig, whatsappTemplates, emailTemplates }: {
  step: Step;
  updateConfig: (id: string, key: string, val: string | number | boolean) => void;
  whatsappTemplates: Array<{ id: string; name: string }>;
  emailTemplates: Array<{ id: string; name: string }>;
}) {
  const upd = (key: string, val: string | number | boolean) => updateConfig(step.id, key, val);

  if (step.type === "send_whatsapp") return (
    <div className="space-y-2">
      <div>
        <label className="label text-xs">Template de mensagem</label>
        <select className="input text-sm" value={String(step.config.template ?? "")} onChange={e => upd("template", e.target.value)}>
          <option value="">Selecionar template...</option>
          {whatsappTemplates.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label text-xs">Atraso antes de enviar</label>
        <select className="input text-sm" value={String(step.config.delay_minutes ?? 0)} onChange={e => upd("delay_minutes", Number(e.target.value))}>
          <option value="0">Imediatamente</option>
          <option value="5">5 minutos</option>
          <option value="15">15 minutos</option>
          <option value="30">30 minutos</option>
          <option value="60">1 hora</option>
        </select>
      </div>
    </div>
  );

  if (step.type === "send_email") return (
    <div className="space-y-2">
      <div>
        <label className="label text-xs">Template de e-mail</label>
        <select className="input text-sm" value={String(step.config.template ?? "")} onChange={e => upd("template", e.target.value)}>
          <option value="">Selecionar template...</option>
          {emailTemplates.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
        </select>
      </div>
    </div>
  );

  if (step.type === "wait") return (
    <div>
      <label className="label text-xs">Aguardar por</label>
      <div className="flex flex-wrap gap-1.5">
        {WAIT_PRESETS.map(p => (
          <button key={p.label} type="button"
            onClick={() => { upd("hours", p.hours); upd("preset", p.label); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${String(step.config.preset) === p.label ? "bg-forest text-white border-forest" : "border-ink/10 hover:border-forest/40"}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input type="number" className="input w-24 text-sm" min={0.5} step={0.5}
          value={Number(step.config.hours ?? 24)}
          onChange={e => { upd("hours", Number(e.target.value)); upd("preset", "custom"); }} />
        <span className="text-sm text-ink/50">horas ({Number(step.config.hours) >= 24 ? `${Math.round(Number(step.config.hours) / 24)} dia(s)` : `${step.config.hours}h`})</span>
      </div>
    </div>
  );

  if (step.type === "notify_user") return (
    <div className="space-y-2">
      <div>
        <label className="label text-xs">Mensagem de notificação</label>
        <textarea className="input resize-none text-sm" rows={2}
          value={String(step.config.message ?? "")}
          onChange={e => upd("message", e.target.value)}
          placeholder="Ex: Lead respondeu orçamento! Verifique o CRM." />
      </div>
      <div>
        <label className="label text-xs">Notificar cargo</label>
        <select className="input text-sm" value={String(step.config.role ?? "gerente")} onChange={e => upd("role", e.target.value)}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
    </div>
  );

  if (step.type === "update_lead") return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="label text-xs">Campo</label>
        <select className="input text-sm" value={String(step.config.field ?? "status")} onChange={e => upd("field", e.target.value)}>
          <option value="status">Status</option>
          <option value="stage">Etapa do pipeline</option>
          <option value="score">Score</option>
          <option value="notes">Observações</option>
          <option value="responsible">Responsável</option>
        </select>
      </div>
      <div>
        <label className="label text-xs">Novo valor</label>
        <input className="input text-sm" value={String(step.config.value ?? "")} onChange={e => upd("value", e.target.value)} placeholder="Valor" />
      </div>
    </div>
  );

  if (step.type === "ai_classify") return (
    <div className="space-y-2">
      <div className="rounded-lg bg-fuchsia-50 p-2 text-xs text-fuchsia-700">
        🤖 Requer integração com OpenAI configurada em Integrações.
      </div>
      <div>
        <label className="label text-xs">Prompt / instrução para a IA</label>
        <textarea className="input resize-none text-sm" rows={3}
          value={String(step.config.prompt ?? "")}
          onChange={e => upd("prompt", e.target.value)}
          placeholder="Ex: Com base nos dados do lead, classifique como: quente, morno ou frio." />
      </div>
      <div>
        <label className="label text-xs">Modelo</label>
        <select className="input text-sm" value={String(step.config.model ?? "gpt-4o")} onChange={e => upd("model", e.target.value)}>
          <option value="gpt-4o">GPT-4o (recomendado)</option>
          <option value="gpt-4o-mini">GPT-4o Mini (rápido)</option>
          <option value="gpt-3.5-turbo">GPT-3.5 Turbo (econômico)</option>
        </select>
      </div>
    </div>
  );

  if (step.type === "webhook_out") return (
    <div className="space-y-2">
      <div>
        <label className="label text-xs">URL do endpoint</label>
        <input className="input text-sm font-mono" value={String(step.config.url ?? "")} onChange={e => upd("url", e.target.value)} placeholder="https://..." />
      </div>
      <div>
        <label className="label text-xs">Método HTTP</label>
        <select className="input text-sm" value={String(step.config.method ?? "POST")} onChange={e => upd("method", e.target.value)}>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="GET">GET</option>
        </select>
      </div>
    </div>
  );

  if (step.type === "condition") return (
    <div className="grid grid-cols-3 gap-2">
      <div>
        <label className="label text-xs">Campo</label>
        <select className="input text-sm" value={String(step.config.field ?? "lead_source")} onChange={e => upd("field", e.target.value)}>
          {CONDITION_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label text-xs">Operador</label>
        <select className="input text-sm" value={String(step.config.operator ?? "eq")} onChange={e => upd("operator", e.target.value)}>
          {CONDITION_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label text-xs">Valor</label>
        <input className="input text-sm" value={String(step.config.value ?? "")} onChange={e => upd("value", e.target.value)} placeholder="valor" />
      </div>
    </div>
  );

  return <div className="text-xs text-ink/40">Tipo de passo não reconhecido: {step.type}</div>;
}
