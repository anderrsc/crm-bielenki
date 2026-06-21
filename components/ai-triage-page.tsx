"use client";

import { useState, useTransition } from "react";
import { saveAiAgentConfig } from "@/app/(crm)/actions";

type TriageSession = {
  id: string;
  phone: string;
  nome: string | null;
  status: string;
  produto: string | null;
  tipo_servico: string | null;
  score: number;
  prioridade: string | null;
  probabilidade: number | null;
  prazo: string | null;
  necessita_visita: boolean | null;
  possui_projeto: boolean | null;
  possui_fotos: boolean | null;
  eh_manutencao: boolean;
  resumo_executivo: string | null;
  created_at: string;
  completed_at: string | null;
  messages: Array<{ role: string; content: string; timestamp: string }>;
};

type AgentConfig = {
  id: string;
  active: boolean;
  agent_name: string;
  ai_provider: string | null;
  openai_api_key: string | null;
  groq_api_key: string | null;
  openai_model: string;
  temperature: number;
  wpp_provider: string | null;
  whatsapp_number_id: string | null;
  whatsapp_token: string | null;
  evolution_api_url: string | null;
  evolution_api_key: string | null;
  evolution_instance: string | null;
  auto_create_lead: boolean;
  notify_on_premium: boolean;
};

type Props = {
  config: AgentConfig | null;
  sessions: TriageSession[];
  tab: string;
  saved?: boolean;
  error?: string;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  em_andamento: { label: "Em andamento", color: "bg-blue-100 text-blue-700" },
  concluida: { label: "Concluída", color: "bg-green-100 text-green-700" },
  encaminhada: { label: "Encaminhada", color: "bg-purple-100 text-purple-700" },
  pos_venda: { label: "Pós-venda", color: "bg-orange-100 text-orange-700" },
  cancelada: { label: "Cancelada", color: "bg-gray-100 text-gray-600" },
};

const PRIORIDADE_COLORS: Record<string, string> = {
  maxima: "text-red-600 font-bold",
  alta: "text-orange-500 font-semibold",
  media: "text-yellow-600",
  baixa: "text-gray-400",
};

const PRAZO_LABELS: Record<string, string> = {
  ate_30_dias: "🔴 Até 30 dias",
  "30_a_90_dias": "🟡 30–90 dias",
  acima_90_dias: "🟢 +90 dias",
};

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-400" : score >= 40 ? "bg-orange-400" : "bg-gray-300";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-gray-100">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono text-ink/60">{score}</span>
    </div>
  );
}

function SessionCard({ session, onClick }: { session: TriageSession; onClick: () => void }) {
  const st = STATUS_LABELS[session.status] ?? { label: session.status, color: "bg-gray-100 text-gray-600" };
  return (
    <div className="card cursor-pointer p-4 hover:border-forest/30 transition-colors" onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{session.nome || session.phone}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${st.color}`}>{st.label}</span>
            {session.eh_manutencao && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">Pós-venda</span>}
            {session.prioridade === "maxima" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 font-bold">⚡ MÁXIMA</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/55">
            {session.produto && <span>📦 {session.produto}</span>}
            {session.tipo_servico && !session.produto && <span>🔧 {session.tipo_servico}</span>}
            {session.prazo && <span>{PRAZO_LABELS[session.prazo] ?? session.prazo}</span>}
            {session.necessita_visita && <span>📍 Visita técnica</span>}
            {session.possui_projeto && <span>📐 Com projeto</span>}
            {session.possui_fotos && <span>📷 Com fotos</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <ScoreBar score={session.score} />
          {session.probabilidade != null && (
            <span className="text-xs text-ink/40 mt-0.5 block">{session.probabilidade}% prob.</span>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-ink/40">
        <span>{session.messages.length} mensagens</span>
        <span>{new Date(session.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  );
}

function SessionDrawer({ session, onClose }: { session: TriageSession; onClose: () => void }) {
  const st = STATUS_LABELS[session.status] ?? { label: session.status, color: "bg-gray-100 text-gray-600" };
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-lg bg-paper shadow-2xl overflow-y-auto flex flex-col">
        <div className="sticky top-0 bg-paper border-b border-forest/10 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-base">{session.nome || session.phone}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`rounded-full px-2 py-0.5 text-xs ${st.color}`}>{st.label}</span>
              <ScoreBar score={session.score} />
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink text-xl leading-none">✕</button>
        </div>

        {/* Resumo executivo */}
        {session.resumo_executivo && (
          <div className="mx-5 mt-4 rounded-xl bg-forest/5 border border-forest/15 p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-forest mb-2">Resumo Executivo</p>
            <pre className="text-xs text-ink/80 whitespace-pre-wrap font-sans">{session.resumo_executivo}</pre>
          </div>
        )}

        {/* Dados coletados */}
        <div className="mx-5 mt-4">
          <p className="text-xs font-bold uppercase tracking-widest text-ink/40 mb-2">Dados Coletados</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {[
              ["Telefone", session.phone],
              ["Produto", session.produto],
              ["Serviço", session.tipo_servico],
              ["Tipo obra", session.tipo_servico],
              ["Prazo", session.prazo ? (PRAZO_LABELS[session.prazo] ?? session.prazo) : null],
              ["Visita técnica", session.necessita_visita != null ? (session.necessita_visita ? "Sim" : "Não") : null],
              ["Tem projeto", session.possui_projeto != null ? (session.possui_projeto ? "Sim" : "Não") : null],
              ["Tem fotos", session.possui_fotos != null ? (session.possui_fotos ? "Sim" : "Não") : null],
              ["Prioridade", session.prioridade],
              ["Probabilidade", session.probabilidade != null ? `${session.probabilidade}%` : null],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-ink/40 text-xs">{k}</dt>
                <dd className={`font-medium ${k === "Prioridade" ? (PRIORIDADE_COLORS[String(v)] ?? "") : ""}`}>{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Conversa */}
        <div className="mx-5 mt-5 mb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-ink/40 mb-3">Conversa ({session.messages.length} mensagens)</p>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {session.messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-forest text-white rounded-br-sm"
                    : "bg-gray-100 text-ink rounded-bl-sm"
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AiTriagePage({ config, sessions, tab, saved, error }: Props) {
  const [activeTab, setActiveTab] = useState(tab);
  const [selectedSession, setSelectedSession] = useState<TriageSession | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showKeyWarning, setShowKeyWarning] = useState(false);
  const [aiProvider, setAiProvider] = useState(config?.ai_provider ?? "groq");
  const [wppProvider, setWppProvider] = useState(config?.wpp_provider ?? "evolution");

  const emAndamento = sessions.filter(s => s.status === "em_andamento");
  const concluidas = sessions.filter(s => s.status === "concluida" || s.status === "encaminhada");
  const posVenda = sessions.filter(s => s.status === "pos_venda");
  const premium = sessions.filter(s => s.prioridade === "maxima" && s.status !== "cancelada");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-forest">GESTÃO</p>
          <h1 className="mt-1 text-2xl font-black">Agente de IA — Triagem Comercial</h1>
          <p className="mt-1 text-sm text-ink/55">Ana realiza a triagem completa dos leads via WhatsApp antes de enviar para orçamento.</p>
        </div>
        <div className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold ${config?.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
          <span className={`h-2 w-2 rounded-full ${config?.active ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
          {config?.active ? "Online" : "Offline"}
        </div>
      </div>

      {saved && <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">✅ Configurações salvas com sucesso.</div>}
      {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">⚠️ {error}</div>}

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: "🔄", value: emAndamento.length, label: "Em andamento" },
          { icon: "✅", value: concluidas.length, label: "Concluídas" },
          { icon: "⚡", value: premium.length, label: "Prioridade máxima" },
          { icon: "🔧", value: posVenda.length, label: "Pós-venda" },
        ].map(({ icon, value, label }) => (
          <div key={label} className="card p-4 text-center">
            <div className="text-2xl">{icon}</div>
            <div className="mt-1 text-2xl font-black">{value}</div>
            <div className="text-xs text-ink/55">{label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-forest/10">
        {[
          { id: "triagens", label: "Triagens" },
          { id: "configuracoes", label: "Configurações" },
          { id: "webhook", label: "Webhook URL" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === t.id ? "border-forest text-forest" : "border-transparent text-ink/50 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Triagens */}
      {activeTab === "triagens" && (
        <div className="space-y-4">
          {premium.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-red-600">⚡ Prioridade Máxima — Notificar Vendedor</p>
              <div className="space-y-2">
                {premium.map(s => <SessionCard key={s.id} session={s} onClick={() => setSelectedSession(s)} />)}
              </div>
            </div>
          )}

          {emAndamento.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-blue-600">Em Andamento</p>
              <div className="space-y-2">
                {emAndamento.map(s => <SessionCard key={s.id} session={s} onClick={() => setSelectedSession(s)} />)}
              </div>
            </div>
          )}

          {concluidas.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-green-600">Concluídas — Prontas para Orçamento</p>
              <div className="space-y-2">
                {concluidas.map(s => <SessionCard key={s.id} session={s} onClick={() => setSelectedSession(s)} />)}
              </div>
            </div>
          )}

          {posVenda.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-orange-600">Encaminhadas ao Pós-Venda</p>
              <div className="space-y-2">
                {posVenda.map(s => <SessionCard key={s.id} session={s} onClick={() => setSelectedSession(s)} />)}
              </div>
            </div>
          )}

          {sessions.length === 0 && (
            <div className="card p-10 text-center text-ink/40">
              <p className="text-4xl mb-3">🤖</p>
              <p className="font-semibold">Nenhuma triagem ainda</p>
              <p className="text-sm mt-1">Quando clientes enviarem mensagens no WhatsApp, a Ana iniciará a triagem automaticamente.</p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Configurações */}
      {activeTab === "configuracoes" && (
        <form action={saveAiAgentConfig} className="card p-6 space-y-6">

          {/* Seção: Agente */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink/40 mb-3">Agente</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink/50 mb-1">Nome do Agente</label>
                <input name="agent_name" defaultValue={config?.agent_name ?? "Ana"} className="input w-full" placeholder="Ana" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink/50 mb-1">Temperatura</label>
                <input name="temperature" type="range" min="0" max="1" step="0.1" defaultValue={config?.temperature ?? 0.3} className="w-full mt-2" />
                <div className="flex justify-between text-xs text-ink/40 mt-0.5">
                  <span>Direto (0)</span><span>Criativo (1)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Seção: Provedor de IA */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink/40 mb-3">Provedor de IA</p>
            <div className="grid gap-3 sm:grid-cols-2 mb-4">
              {[
                { value: "groq", label: "🚀 Groq", badge: "GRÁTIS", desc: "Llama 3.3 70B · 14.400 req/dia · Sem cartão" },
                { value: "openai", label: "OpenAI", badge: "PAGO", desc: "GPT-4o · ~R$0,03 por triagem" },
              ].map(opt => (
                <label key={opt.value} className={`flex items-start gap-3 rounded-xl border-2 p-4 cursor-pointer transition-colors ${aiProvider === opt.value ? "border-forest bg-forest/5" : "border-transparent bg-gray-50 hover:border-forest/30"}`}>
                  <input type="radio" name="ai_provider" value={opt.value} checked={aiProvider === opt.value} onChange={() => setAiProvider(opt.value)} className="mt-0.5" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{opt.label}</span>
                      <span className={`text-xs rounded px-1.5 py-0.5 font-bold ${opt.value === "groq" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{opt.badge}</span>
                    </div>
                    <p className="text-xs text-ink/50 mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            {aiProvider === "groq" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-ink/50 mb-1">Chave Groq API <a href="https://console.groq.com/keys" target="_blank" className="text-forest underline ml-1">Criar grátis →</a></label>
                  <input name="groq_api_key" type="password" defaultValue={config?.groq_api_key ?? ""} className="input w-full font-mono" placeholder="gsk_..." onFocus={() => setShowKeyWarning(true)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-ink/50 mb-1">Modelo</label>
                  <select name="openai_model" defaultValue={config?.openai_model ?? "llama-3.3-70b-versatile"} className="input w-full">
                    <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Recomendado)</option>
                    <option value="llama-3.1-8b-instant">Llama 3.1 8B (Mais rápido)</option>
                    <option value="gemma2-9b-it">Gemma 2 9B</option>
                    <option value="qwen-qwq-32b">Qwen 32B Reasoning</option>
                  </select>
                </div>
              </div>
            )}

            {aiProvider === "openai" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-ink/50 mb-1">Chave OpenAI API</label>
                  <input name="openai_api_key" type="password" defaultValue={config?.openai_api_key ?? ""} className="input w-full font-mono" placeholder="sk-..." onFocus={() => setShowKeyWarning(true)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-ink/50 mb-1">Modelo</label>
                  <select name="openai_model" defaultValue={config?.openai_model ?? "gpt-4o"} className="input w-full">
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                  </select>
                </div>
              </div>
            )}
            {showKeyWarning && <p className="text-xs text-amber-600 mt-1">⚠️ Chave salva de forma segura. Nunca a compartilhe.</p>}
          </div>

          {/* Seção: WhatsApp */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink/40 mb-3">Provedor WhatsApp</p>
            <div className="grid gap-3 sm:grid-cols-2 mb-4">
              {[
                { value: "evolution", label: "📱 Evolution API", badge: "GRÁTIS", desc: "QR code · Sem aprovação Meta · Open source" },
                { value: "meta", label: "Meta Business API", badge: "OFICIAL", desc: "Requer aprovação Meta Business · Gratuito até 1.000 conv/mês" },
              ].map(opt => (
                <label key={opt.value} className={`flex items-start gap-3 rounded-xl border-2 p-4 cursor-pointer transition-colors ${wppProvider === opt.value ? "border-forest bg-forest/5" : "border-transparent bg-gray-50 hover:border-forest/30"}`}>
                  <input type="radio" name="wpp_provider" value={opt.value} checked={wppProvider === opt.value} onChange={() => setWppProvider(opt.value)} className="mt-0.5" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{opt.label}</span>
                      <span className={`text-xs rounded px-1.5 py-0.5 font-bold ${opt.value === "evolution" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>{opt.badge}</span>
                    </div>
                    <p className="text-xs text-ink/50 mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            {wppProvider === "evolution" && (
              <div className="space-y-3 rounded-xl bg-green-50 border border-green-200 p-4">
                <p className="text-xs font-bold text-green-800">Evolution API — Configuração</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-ink/50 mb-1">URL da Evolution API</label>
                    <input name="evolution_api_url" defaultValue={config?.evolution_api_url ?? ""} className="input w-full font-mono text-sm" placeholder="https://sua-instancia.railway.app" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink/50 mb-1">Nome da Instância</label>
                    <input name="evolution_instance" defaultValue={config?.evolution_instance ?? ""} className="input w-full font-mono text-sm" placeholder="marquinhos" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink/50 mb-1">API Key da Evolution</label>
                  <input name="evolution_api_key" type="password" defaultValue={config?.evolution_api_key ?? ""} className="input w-full font-mono text-sm" placeholder="sua-api-key" />
                </div>
                <p className="text-xs text-green-700">Webhook para configurar na Evolution API: <code className="bg-white rounded px-1">POST /agente-ia/webhook</code> apontando para <code className="bg-white rounded px-1">https://seu-site.com/api/whatsapp/webhook</code></p>
              </div>
            )}

            {wppProvider === "meta" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-ink/50 mb-1">Phone Number ID</label>
                  <input name="whatsapp_number_id" defaultValue={config?.whatsapp_number_id ?? ""} className="input w-full font-mono" placeholder="1234567890" />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-ink/50 mb-1">Access Token</label>
                  <input name="whatsapp_token" type="password" defaultValue={config?.whatsapp_token ?? ""} className="input w-full font-mono" placeholder="EAABxx..." />
                </div>
              </div>
            )}
          </div>

          {/* Opções gerais */}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input name="auto_create_lead" type="checkbox" defaultChecked={config?.auto_create_lead ?? true} className="rounded" />
              <span className="text-sm">Criar lead ao concluir triagem</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input name="notify_on_premium" type="checkbox" defaultChecked={config?.notify_on_premium ?? true} className="rounded" />
              <span className="text-sm">Notificar vendedor em leads premium</span>
            </label>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-forest/10">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input name="active" type="checkbox" defaultChecked={config?.active ?? false} className="sr-only peer" id="agent-active" />
                <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-forest transition-colors" />
                <div className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow peer-checked:translate-x-5 transition-transform" />
              </div>
              <span className="text-sm font-semibold">{config?.active ? "Agente ativo" : "Agente inativo"}</span>
            </label>
            <button type="submit" disabled={isPending} className="btn-primary">
              {isPending ? "Salvando..." : "Salvar configurações"}
            </button>
          </div>
        </form>
      )}

      {/* Tab: Webhook */}
      {activeTab === "webhook" && (
        <div className="card p-6 space-y-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-forest mb-1">URL do Webhook</p>
            <p className="text-sm text-ink/60 mb-3">Configure esta URL no Meta for Developers para receber mensagens do WhatsApp:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-xl bg-gray-50 border border-forest/10 px-4 py-3 text-sm font-mono break-all">
                https://seu-dominio.com/api/whatsapp/webhook
              </code>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-forest mb-1">Verify Token</p>
            <code className="rounded-xl bg-gray-50 border border-forest/10 px-4 py-2 text-sm font-mono block">
              marquinhos-crm-verify
            </code>
            <p className="mt-1 text-xs text-ink/40">Configure como WHATSAPP_WEBHOOK_VERIFY_TOKEN no .env.local para personalizar.</p>
          </div>
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 space-y-2">
            <p className="text-sm font-semibold text-blue-800">Passo a passo:</p>
            <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
              <li>Acesse <strong>Meta for Developers → Meu App → WhatsApp → Configuração</strong></li>
              <li>Em Webhooks, cole a URL acima e o Verify Token</li>
              <li>Selecione os campos: <code>messages</code></li>
              <li>Configure a chave OpenAI na aba Configurações</li>
              <li>Ative o agente e teste enviando "Olá" para o número</li>
            </ol>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
            <p className="text-sm font-semibold text-amber-800">Em desenvolvimento local:</p>
            <p className="text-sm text-amber-700 mt-1">Use <code>ngrok http 3000</code> para expor o webhook localmente. O Meta requer HTTPS.</p>
          </div>
        </div>
      )}

      {/* Drawer de detalhes */}
      {selectedSession && (
        <SessionDrawer session={selectedSession} onClose={() => setSelectedSession(null)} />
      )}
    </div>
  );
}
