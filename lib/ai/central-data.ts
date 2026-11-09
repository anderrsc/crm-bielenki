// Dados reais da Central de IA: so le o banco e as variaveis do servidor.
// Nunca devolve chaves ou tokens, apenas se existem.
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAiProvider, type AiProvider } from "@/lib/ai/chat";

export const AI_FALLBACK_MARK = "alguém da nossa equipe vai te responder";

export type CentralCheck = { label: string; ok: boolean; detail: string };
export type CentralEvent = { at: string; kind: "triagem" | "lead" | "falha" | "envio"; title: string; detail: string };
export type CentralData = {
  active: boolean;
  agentName: string;
  provider: AiProvider;
  wppProvider: "meta" | "evolution";
  checks: CentralCheck[];
  stats: { conversas: number; emAndamento: number; concluidas: number; posVenda: number; leads: number; falhasIa: number; enviadas: number; falhasEnvio: number; pendentes: number; workflowsOk: number; workflowsFalha: number };
  events: CentralEvent[];
};

type Msg = { role?: string; content?: string };
const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export async function loadCentralData(db: SupabaseClient, companyId: string): Promise<CentralData> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const [configRes, companyRes, sessionsRes, leadsRes, outboundRes, workflowRes] = await Promise.all([
    db.from("ai_agent_config").select("*").eq("company_id", companyId).maybeSingle(),
    db.from("companies").select("whatsapp_phone_number_id").eq("id", companyId).maybeSingle(),
    db.from("triage_sessions").select("id,nome,phone,status,produto,tipo_servico,score,prioridade,created_at,updated_at,messages").eq("company_id", companyId).gte("updated_at", since).order("updated_at", { ascending: false }).limit(200),
    db.from("leads").select("id,name,score,priority,created_at").eq("company_id", companyId).eq("source", "WhatsApp").gte("created_at", since).order("created_at", { ascending: false }).limit(100),
    db.from("outbound_messages").select("id,automation_type,status,error_message,phone,scheduled_at,sent_at").eq("company_id", companyId).gte("scheduled_at", since).order("scheduled_at", { ascending: false }).limit(300),
    db.from("workflow_executions").select("id,status,error_message,started_at").eq("company_id", companyId).gte("started_at", since).limit(300),
  ]);

  const cfg = (configRes.data ?? {}) as Record<string, unknown>;
  const provider = parseAiProvider(cfg.ai_provider);
  const env = process.env;
  const aiKey = provider === "ollama" ? has(env.OLLAMA_API_KEY) : provider === "groq" ? has(cfg.groq_api_key) || has(cfg.openai_api_key) : has(cfg.openai_api_key);
  const metaNumber = has(companyRes.data?.whatsapp_phone_number_id) || has(cfg.whatsapp_number_id);
  const metaToken = has(cfg.whatsapp_token) || has(env.WHATSAPP_ACCESS_TOKEN);
  const evolution = has(cfg.evolution_api_url) && has(cfg.evolution_instance) && has(cfg.evolution_api_key)
    && (has(env.EVOLUTION_WEBHOOK_SECRET) || has(cfg.evolution_webhook_secret));
  const wppProvider = cfg.wpp_provider === "meta" || (!evolution && (metaNumber || metaToken)) ? "meta" : "evolution";
  const providerName = { ollama: "Ollama Cloud", groq: "Groq", openai: "OpenAI" }[provider];

  const checks: CentralCheck[] = [
    { label: "Agente ativo", ok: cfg.active === true, detail: cfg.active === true ? "Ligado" : "Desligado: a Lia não responde ninguém" },
    { label: `Chave da IA (${providerName})`, ok: aiKey, detail: aiKey ? "Configurada — use Testar IA para ver se tem crédito" : "Falta a chave. Groq é grátis: console.groq.com/keys" },
  ];
  if (wppProvider === "meta") {
    checks.push(
      { label: "Número da Meta (Phone Number ID)", ok: metaNumber, detail: metaNumber ? "Configurado" : "Falta o Phone Number ID do WhatsApp" },
      { label: "Token da Meta", ok: metaToken, detail: metaToken ? "Configurado" : "Falta o token de acesso da Meta" },
      { label: "Segredo do app (Vercel)", ok: has(env.WHATSAPP_APP_SECRET), detail: has(env.WHATSAPP_APP_SECRET) ? "Configurado" : "Falta WHATSAPP_APP_SECRET: mensagens da Meta são recusadas" },
      { label: "Token de verificação (Vercel)", ok: has(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN), detail: has(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) ? "Configurado" : "Falta WHATSAPP_WEBHOOK_VERIFY_TOKEN: a Meta não valida o webhook" },
    );
  } else {
    checks.push({ label: "WhatsApp (Evolution)", ok: evolution, detail: evolution ? "Servidor configurado — veja a conexão abaixo" : "Conecte o WhatsApp no quadro abaixo" });
  }

  const sessions = sessionsRes.data ?? [];
  const lastAssistant = (messages: unknown) => [...(Array.isArray(messages) ? (messages as Msg[]) : [])].reverse().find((m) => m?.role === "assistant")?.content ?? "";
  const failedSessions = sessions.filter((s) => lastAssistant(s.messages).includes(AI_FALLBACK_MARK));
  const outbound = outboundRes.data ?? [];
  const workflows = workflowRes.data ?? [];

  const label = (s: { nome?: string | null; phone?: string | null }) => s.nome || (s.phone ? `…${String(s.phone).slice(-4)}` : "Cliente");
  const statusName: Record<string, string> = { em_andamento: "em andamento", concluida: "concluída", pos_venda: "pós-venda" };
  const events: CentralEvent[] = [
    ...sessions.map((s) => failedSessions.includes(s)
      ? { at: s.updated_at, kind: "falha" as const, title: `IA não respondeu: ${label(s)}`, detail: "Cliente recebeu aviso de que a equipe vai responder" }
      : { at: s.updated_at, kind: "triagem" as const, title: `Triagem ${statusName[s.status] ?? s.status}: ${label(s)}`, detail: [s.tipo_servico, s.produto, s.prioridade && `prioridade ${s.prioridade}`].filter(Boolean).join(" · ") || "Coletando dados" }),
    ...(leadsRes.data ?? []).map((l) => ({ at: l.created_at, kind: "lead" as const, title: `Lead criado: ${l.name}`, detail: `Score ${l.score ?? 0}${l.priority ? ` · prioridade ${l.priority}` : ""}` })),
    ...outbound.filter((o) => o.status === "failed").map((o) => ({ at: o.scheduled_at, kind: "falha" as const, title: `Envio falhou (${o.automation_type})`, detail: o.error_message || "Sem detalhe" })),
    ...outbound.filter((o) => o.status === "sent").map((o) => ({ at: o.sent_at ?? o.scheduled_at, kind: "envio" as const, title: `Mensagem enviada (${o.automation_type})`, detail: `Para …${String(o.phone).slice(-4)}` })),
  ].filter((e) => e.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);

  return {
    active: cfg.active === true,
    agentName: has(cfg.agent_name) && cfg.agent_name !== "Ana" ? String(cfg.agent_name) : "Lia",
    provider,
    wppProvider,
    checks,
    stats: {
      conversas: sessions.length,
      emAndamento: sessions.filter((s) => s.status === "em_andamento").length,
      concluidas: sessions.filter((s) => s.status === "concluida").length,
      posVenda: sessions.filter((s) => s.status === "pos_venda").length,
      leads: leadsRes.data?.length ?? 0,
      falhasIa: failedSessions.length,
      enviadas: outbound.filter((o) => o.status === "sent").length,
      falhasEnvio: outbound.filter((o) => o.status === "failed").length,
      pendentes: outbound.filter((o) => o.status === "pending" || o.status === "processing").length,
      workflowsOk: workflows.filter((w) => w.status === "concluido").length,
      workflowsFalha: workflows.filter((w) => w.status === "falhou").length,
    },
    events,
  };
}
