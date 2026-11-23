"use server";
// Tela de Atendimento (estilo Octadesk): conversas do WhatsApp + ficha do cliente.
import { channelById, channelCredentials, type WhatsappChannel } from "@/lib/whatsapp/channels";
import { waitingSince } from "@/lib/inbox-waiting";
import { whatsappTarget } from "@/lib/whatsapp/phone";
import { validIsoDate } from "@/lib/valid-date";
import { formatRegistrationName } from "@/lib/brazilian-input";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { firstName } from "@/lib/seller-name";
import { todayISO } from "@/lib/utils";
import { autoLinkClients, recordOutbound } from "@/lib/whatsapp/inbox-store";
import { evolutionErrorMessage, syncRecentEvolutionMessages, syncAgendaNames } from "@/lib/whatsapp/evolution-history";
import { decryptSecret } from "@/lib/encrypt";
import { cleanContactName, formatBrPhone, digitsOnly } from "@/lib/whatsapp/phone";
import { markWhatsAppRead, markWhatsAppUnread, sendOutcomeUnknown, sendWhatsAppText, whatsappCredentials, type QuotedMessage } from "@/lib/whatsapp/send";
import { advanceReadThrough } from "@/lib/whatsapp/delivery";

export type InboxItem = {
  id: string; name: string; phone: string; clientId: string | null; clientName: string | null;
  preview: string; lastAt: string | null; unread: number; aiPaused: boolean; assignedName: string | null; archived: boolean;
  status: ConversationStatus; department: string | null; assignedTo: string | null;
  /** Número de WhatsApp da conversa (calha, esquadrias…). */
  channelId?: string | null; channelName?: string | null;
  labels?: Array<{ id: string; name: string; color: string }>;
  /** false = número sem Lia (só o principal tem IA por enquanto). */
  channelAi?: boolean;
  /** Cliente falou por último e ainda espera resposta desde este horário. */
  waitingSince?: string | null;
};
export type ConversationStatus = "aberta" | "aguardando_cliente" | "resolvida";
/** Nota interna, transferência ou troca de status: só a equipe vê. */
export type InboxEvent = { id: string; kind: "nota" | "transferencia" | "status"; body: string | null; toName: string | null; department: string | null; status: string | null; byName: string | null; at: string };
export type InboxMessage = {
  id: string; direction: "inbound" | "outbound"; author: string | null; senderName: string | null;
  body: string; at: string; failed: boolean; error: string | null; pending?: boolean; deliveryStatus?: string | null;
  /** Reações (emoji) do cliente e da empresa; trecho da mensagem citada, quando responde a outra. */
  reactionCustomer?: string | null; reactionTeam?: string | null; quotedPreview?: string | null;
};
export type ClientPanel = { canViewFinancial?: boolean;
  client: { id: string; name: string; phone: string | null; email: string | null; city: string | null; address: string | null; notes: string | null; created_at: string };
  resumo: { feitos: number; enviados: number; fechados: number; valorFechado: number; recebido: number; aReceber: number; vencido: number };
  orcamentos: Array<{ id: string; numero: string; status: string; total: number; data: string; fechado: boolean }>;
  contas: Array<{ id: string; descricao: string; total: number; pago: number; aberto: number; vencimento: string | null; status: string; vencida: boolean }>;
  pagamentos: Array<{ valor: number; data: string; forma: string | null; descricao: string }>;
  pipeline: { etapa: string | null; valor: number | null; proximaAcao: string | null; data: string | null } | null;
};
export type TriageInfo = { resumo: string | null; dados: Record<string, unknown> } | null;
export type ConversationDetail = { conversation: InboxItem; messages: InboxMessage[]; events: InboxEvent[]; hasOlder: boolean; panel: ClientPanel | null; triage: TriageInfo; windowOpen: boolean; suggestion: { text: string; at: string } | null; readSnapshot: { count: number; lastInbound: string | null; generation: string | null } };

async function context() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const { data: profile } = await db.from("profiles").select("company_id,full_name").eq("id", user.id).single();
  if (!profile?.company_id) throw new Error("Empresa não encontrada.");
  return { db, user, companyId: profile.company_id as string, myName: firstName(profile.full_name) || "Equipe" };
}

type ConvRow = {
  id: string; contact_name: string | null; phone: string | null; external_id: string | null; client_id: string | null;
  last_message_preview: string | null; last_message_at: string | null; created_at: string; unread_count: number | null;
  ai_paused: boolean | null; assigned_to: string | null; last_inbound_at?: string | null; ai_generation_id?: string | null; archived_at?: string | null;
  status?: string | null; department?: string | null;
  clients?: { name: string } | null; profiles?: { full_name: string } | null;
  channel_id?: string | null; wchan?: { name: string; is_default: boolean } | null;
  labels?: Array<{ label: { id: string; name: string; color: string } | null }> | null;
};
const CONV_COLUMNS = "id,contact_name,phone,external_id,client_id,last_message_preview,last_message_at,last_inbound_at,ai_generation_id,archived_at,status,department,created_at,unread_count,ai_paused,assigned_to,channel_id,clients(name),profiles:assigned_to(full_name),wchan:whatsapp_channels(name,is_default)";
// Etiquetas vêm junto; se o banco ainda não tem a tabela, a lista abre sem elas (nunca fica em branco).
const LABEL_COLUMNS = ",labels:conversation_label_links(label:conversation_labels(id,name,color))";

function toItem(c: ConvRow): InboxItem {
  const phone = c.phone || c.external_id || "";
  return {
    id: c.id,
    name: c.clients?.name || cleanContactName(c.contact_name) || formatBrPhone(phone),
    phone,
    clientId: c.client_id,
    clientName: c.clients?.name ?? null,
    preview: c.last_message_preview ?? "",
    lastAt: c.last_message_at ?? c.created_at,
    unread: c.unread_count ?? 0,
    aiPaused: !!c.ai_paused,
    assignedName: c.profiles?.full_name ? firstName(c.profiles.full_name) : null,
    archived: !!c.archived_at,
    status: c.status === "aguardando_cliente" || c.status === "resolvida" ? c.status : "aberta",
    department: c.department ?? null,
    assignedTo: c.assigned_to,
    channelId: c.channel_id ?? null,
    channelName: c.wchan?.name ?? null,
    labels: (c.labels ?? []).map((l) => l.label).filter((l): l is { id: string; name: string; color: string } => !!l),
    channelAi: c.wchan ? c.wchan.is_default : true,
    waitingSince: waitingSince(c.last_inbound_at, c.last_message_at),
  };
}

const agendaSyncedAt = new Map<string, number>();
/** Recupera as mensagens recentes de cada número sem disparar a IA nem alterar a atribuição. */
async function refreshInboxMessages(db: Awaited<ReturnType<typeof context>>["db"], companyId: string) {
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: cfg, error } = await admin.from("ai_agent_config").select("*").eq("company_id", companyId).maybeSingle();
  if (error) throw new Error("Não foi possível consultar a conexão do WhatsApp.");
  const { data: chans } = await admin.from("whatsapp_channels").select("*").eq("company_id", companyId).eq("provider", "evolution").eq("active", true).is("deleted_at", null);
  const channels = (chans ?? []) as WhatsappChannel[];
  if (!channels.length) {
    // Antes da tabela de números: conexão única da empresa.
    if (cfg?.wpp_provider !== "evolution") return 0;
    const key = cfg.evolution_api_key ? decryptSecret(cfg.evolution_api_key) : "";
    if (!cfg.evolution_api_url || !key) throw new Error("Configure a conexão do WhatsApp na Central de IA.");
    try { return (await syncRecentEvolutionMessages(db, companyId, cfg.evolution_api_url, key, cfg.evolution_instance || "crm", null, { maxPages: 3 })).inserted; }
    catch (e) { throw new Error(evolutionErrorMessage(e)); }
  }
  let inserted = 0; const errors: string[] = [];
  for (const ch of channels) {
    const c = channelCredentials(cfg, ch);
    if (!c.evolutionUrl || !c.evolutionKey || !c.evolutionInstance) { errors.push(`${ch.name}: configure a conexão na Central de IA.`); continue; }
    try {
      inserted += (await syncRecentEvolutionMessages(admin, companyId, c.evolutionUrl, c.evolutionKey, c.evolutionInstance, ch.id, { maxPages: 3 })).inserted;
      await admin.from("whatsapp_channels").update({ last_sync_at: new Date().toISOString() }).eq("id", ch.id);
    } catch (e) { errors.push(`${ch.name}: ${evolutionErrorMessage(e)}`); }
  }
  if (errors.length && !inserted) throw new Error(errors.join(" "));
  return inserted;
}
/** Nomes da agenda do celular, no máximo a cada 6 h (só quem pode ver a configuração da Evolution). */
async function refreshAgendaNames(db: Awaited<ReturnType<typeof context>>["db"], companyId: string, force = false) {
  if (!force && Date.now() - (agendaSyncedAt.get(companyId) ?? 0) < 5 * 60_000) return 0;
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: cfg } = await admin.from("ai_agent_config").select("evolution_api_url,evolution_api_key,evolution_instance,wpp_provider").eq("company_id", companyId).maybeSingle();
  const key = cfg?.evolution_api_key ? decryptSecret(cfg.evolution_api_key) : "";
  if (!cfg?.evolution_api_url || !key) return 0;
  const result = await syncAgendaNames(db, companyId, cfg.evolution_api_url, key, cfg.evolution_instance || "crm");
  agendaSyncedAt.set(companyId, Date.now());
  return result;
}

export async function loadInbox(): Promise<{ items: InboxItem[]; error?: string; companyId?: string; aiActive?: boolean; provider?: "meta" | "evolution" }> {
  try {
    const { db, companyId } = await context();
    // Liga conversas a clientes e atualiza os nomes da agenda DEPOIS de responder:
    // a lista abre na hora e os nomes novos chegam na proxima atualizacao (tempo real).
    after(async () => {
      // Reserva atomica no banco: so um servidor sincroniza a cada 10 min.
      const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const since = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data: claimed, error } = await admin.from("ai_agent_config").update({ inbox_synced_at: new Date().toISOString() })
        .eq("company_id", companyId).or(`inbox_synced_at.is.null,inbox_synced_at.lt.${since}`).select("company_id");
      if (error ? Date.now() - (agendaSyncedAt.get(companyId) ?? 0) < 10 * 60_000 : !claimed?.length) return;
      await Promise.all([autoLinkClients(db, companyId).catch(() => 0), refreshAgendaNames(db, companyId, true).catch(() => 0),
        refreshInboxMessages(db, companyId).catch(() => 0)]);
      agendaSyncedAt.set(companyId, Date.now());
    });
    const listQuery = (columns: string) => db.from("conversations").select(columns)
      .eq("company_id", companyId).eq("channel", "whatsapp").not("last_message_at", "is", null)
      .order("last_message_at", { ascending: false }).limit(300);
    let { data, error } = await listQuery(CONV_COLUMNS + LABEL_COLUMNS);
    // Banco sem a tabela de etiquetas ainda: a lista abre normalmente, sem elas.
    if (error && /conversation_label|relationship|schema cache/i.test(error.message)) ({ data, error } = await listQuery(CONV_COLUMNS));
    if (error) return { items: [], error: /column|does not exist/i.test(error.message) ? "Falta aplicar a atualização do banco do Atendimento (migração 20261108000000)." : error.message };
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: cfg } = await admin.from("ai_agent_config").select("active,wpp_provider,evolution_api_url,evolution_instance").eq("company_id", companyId).maybeSingle();
    const provider = cfg?.wpp_provider === "evolution" || (!cfg?.wpp_provider && cfg?.evolution_api_url && cfg?.evolution_instance) ? "evolution" : "meta";
    return { items: ((data ?? []) as unknown as ConvRow[]).map(toItem), companyId, aiActive: cfg?.active === true, provider };
  } catch (error) {
    return { items: [], error: error instanceof Error ? error.message : String(error) };
  }
}

const PAGE = 60;

export async function loadConversation(conversationId: string, opts: { panel?: boolean } = {}): Promise<ConversationDetail | { error: string }> {
  try {
    if (!z.string().uuid().safeParse(conversationId).success) return { error: "Conversa inválida." };
    const { db, companyId } = await context();
    const { data: conv, error } = await db.from("conversations").select(CONV_COLUMNS).eq("id", conversationId).eq("company_id", companyId).single();
    if (error || !conv) return { error: "Conversa não encontrada." };
    const row = conv as unknown as ConvRow;
    const [{ data: msgs, error: messagesError }, panel, triage, suggestion, events] = await Promise.all([
      db.from("messages").select(MESSAGE_COLUMNS)
        .eq("conversation_id", conversationId).order("sent_at", { ascending: false }).limit(PAGE + 1),
      row.client_id && opts.panel !== false ? loadClientPanel(db, companyId, row.client_id) : Promise.resolve(null),
      opts.panel !== false ? loadTriage(db, companyId, row.phone || row.external_id || "") : Promise.resolve(null),
      loadSuggestion(db, conversationId),
      loadEvents(db, conversationId),
    ]);
    if (messagesError) return { error: messagesError.message };
    const hasOlder = (msgs ?? []).length > PAGE;
    const messages: InboxMessage[] = (msgs ?? []).slice(0, PAGE).reverse().map(toMessage);
    const lastInbound = row.last_inbound_at ?? [...messages].reverse().find((m) => m.direction === "inbound")?.at ?? null;
    const windowOpen = !!lastInbound && Date.now() - new Date(lastInbound).getTime() < 24 * 60 * 60_000;
    return { conversation: toItem(row), messages, events, hasOlder, panel, triage, windowOpen, suggestion, readSnapshot: { count: row.unread_count ?? 0, lastInbound: row.last_inbound_at ?? null, generation: row.ai_generation_id ?? null } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Resposta que a Lia deixou para a equipe aprovar (modos assistente/semiautomático). */
async function loadSuggestion(db: Awaited<ReturnType<typeof context>>["db"], conversationId: string) {
  const { data, error } = await db.from("conversations").select("ai_suggestion,ai_suggestion_at").eq("id", conversationId).maybeSingle();
  if (error || !data?.ai_suggestion) return null;
  return { text: String(data.ai_suggestion), at: String(data.ai_suggestion_at ?? "") };
}

async function loadEvents(db: Awaited<ReturnType<typeof context>>["db"], conversationId: string): Promise<InboxEvent[]> {
  const { data, error } = await db.from("conversation_events")
    .select("id,kind,body,department,status,created_at,to:profiles!conversation_events_to_profile_fkey(full_name),by:profiles!conversation_events_created_by_fkey(full_name)")
    .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(100);
  if (error) return [];
  type Row = { id: string; kind: InboxEvent["kind"]; body: string | null; department: string | null; status: string | null; created_at: string; to: { full_name: string } | null; by: { full_name: string } | null };
  return ((data ?? []) as unknown as Row[]).reverse().map(e => ({
    id: e.id, kind: e.kind, body: e.body, department: e.department, status: e.status, at: e.created_at,
    toName: e.to?.full_name ? firstName(e.to.full_name) : null, byName: e.by?.full_name ? firstName(e.by.full_name) : null,
  }));
}

const MESSAGE_COLUMNS = "id,direction,author,sender_name,body,sent_at,delivery_status,error_message,reaction_customer,reaction_team,quoted_external_id,quoted_preview";
type MessageRow = { id: string; direction: string; author: string | null; sender_name: string | null; body: string | null; sent_at: string; delivery_status: string; error_message: string | null;
  reaction_customer?: string | null; reaction_team?: string | null; quoted_external_id?: string | null; quoted_preview?: string | null };
function toMessage(m: MessageRow): InboxMessage {
  return {
    id: m.id, direction: m.direction === "outbound" ? "outbound" : "inbound", author: m.author, senderName: m.sender_name,
    body: m.body ?? "", at: m.sent_at, deliveryStatus: m.delivery_status, pending: ["uploading", "processing", "enviando"].includes(m.delivery_status), failed: m.delivery_status === "falhou", error: m.error_message,
    reactionCustomer: m.reaction_customer ?? null, reactionTeam: m.reaction_team ?? null,
    quotedPreview: m.quoted_external_id ? (m.quoted_preview || "Mensagem") : null,
  };
}

/** Mensagens anteriores a `before` (rolar para cima carrega o historico sozinho). */
export async function loadOlderMessages(conversationId: string, before: string): Promise<{ messages: InboxMessage[]; hasOlder: boolean } | { error: string }> {
  try {
    if (!z.string().uuid().safeParse(conversationId).success || Number.isNaN(Date.parse(before))) return { error: "Pedido inválido." };
    const { db, companyId } = await context();
    const { data, error } = await db.from("messages").select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId).eq("company_id", companyId).lt("sent_at", before)
      .order("sent_at", { ascending: false }).limit(PAGE + 1);
    if (error) return { error: error.message };
    return { messages: (data ?? []).slice(0, PAGE).reverse().map((m) => toMessage(m as MessageRow)), hasOlder: (data ?? []).length > PAGE };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Arquiva ou desarquiva (como no WhatsApp: continua arquivada quando chega mensagem). */
export async function setConversationArchived(conversationId: string, archived: boolean): Promise<{ ok?: true; error?: string }> {
  try {
    if (!z.string().uuid().safeParse(conversationId).success) return { error: "Conversa inválida." };
    const { db, companyId } = await context();
    const { error } = await db.from("conversations").update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", conversationId).eq("company_id", companyId);
    return error ? { error: error.message } : { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadTriage(db: Awaited<ReturnType<typeof createClient>>, companyId: string, phone: string): Promise<TriageInfo> {
  if (!phone) return null;
  const { data } = await db.from("triage_sessions").select("resumo_executivo,dados_coletados")
    .eq("company_id", companyId).eq("phone", phone).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const dados = Object.fromEntries(Object.entries((data.dados_coletados ?? {}) as Record<string, unknown>).filter(([, v]) => v !== null && v !== "" && v !== undefined));
  return Object.keys(dados).length || data.resumo_executivo ? { resumo: data.resumo_executivo ?? null, dados } : null;
}

async function loadClientPanel(db: Awaited<ReturnType<typeof createClient>>, companyId: string, clientId: string): Promise<ClientPanel | null> {
  const { data: financialAccess } = await db.rpc("has_table_access", { resource: "financial_entries", action: "select" });
  const canViewFinancial = financialAccess === true;
  const [clientRes, quotesRes, entriesRes, leadRes] = await Promise.all([
    db.from("clients").select("id,name,phone,whatsapp,email,city,neighborhood,address,notes,created_at").eq("id", clientId).eq("company_id", companyId).maybeSingle(),
    db.from("quotes").select("id,quote_number,status,total,created_at,approved_at,sale_id").eq("client_id", clientId).eq("company_id", companyId).order("created_at", { ascending: false }).limit(30),
    canViewFinancial ? db.from("financial_entries").select("id,description,total_amount,paid_amount,open_amount,due_date,status").eq("client_id", clientId).eq("company_id", companyId).eq("entry_type", "receber").neq("status", "cancelado").order("due_date", { ascending: true }).limit(50) : Promise.resolve({ data: [] }),
    db.from("leads").select("estimated_value,next_action,next_action_date,status,pipeline_stages(name)").eq("client_id", clientId).eq("company_id", companyId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const c = clientRes.data;
  if (!c) return null;
  const quotes = quotesRes.data ?? [];
  const entries = entriesRes.data ?? [];
  const entryIds = entries.map((e) => e.id);
  const { data: pays } = entryIds.length
    ? await db.from("payments").select("amount,paid_at,payment_method,financial_entry_id").in("financial_entry_id", entryIds).order("paid_at", { ascending: false }).limit(20)
    : { data: [] as Array<{ amount: number; paid_at: string; payment_method: string | null; financial_entry_id: string }> };
  const today = todayISO();
  const n = (v: unknown) => Number(v ?? 0);
  const fechado = (q: { status: string; sale_id: string | null }) => q.status === "aprovado" || !!q.sale_id;
  const contas = entries.map((e) => ({
    id: e.id, descricao: e.description, total: n(e.total_amount), pago: n(e.paid_amount), aberto: n(e.open_amount),
    vencimento: e.due_date, status: e.status, vencida: n(e.open_amount) > 0 && !!e.due_date && e.due_date < today,
  }));
  const lead = leadRes.data as unknown as { estimated_value: number | null; next_action: string | null; next_action_date: string | null; pipeline_stages?: { name: string } | null } | null;
  return {
    canViewFinancial,
    client: { id: c.id, name: c.name, phone: c.phone || c.whatsapp, email: c.email, city: c.city, address: [c.address, c.neighborhood].filter(Boolean).join(", ") || null, notes: c.notes, created_at: c.created_at },
    resumo: {
      feitos: quotes.length,
      enviados: quotes.filter((q) => q.status === "enviado").length,
      fechados: quotes.filter(fechado).length,
      valorFechado: quotes.filter(fechado).reduce((s, q) => s + n(q.total), 0),
      recebido: contas.reduce((s, e) => s + e.pago, 0),
      aReceber: contas.reduce((s, e) => s + e.aberto, 0),
      vencido: contas.filter((e) => e.vencida).reduce((s, e) => s + e.aberto, 0),
    },
    orcamentos: quotes.map((q) => ({ id: q.id, numero: q.quote_number, status: q.status, total: n(q.total), data: q.created_at, fechado: fechado(q) })),
    contas,
    pagamentos: (pays ?? []).map((p) => ({ valor: n(p.amount), data: p.paid_at, forma: p.payment_method, descricao: entries.find((e) => e.id === p.financial_entry_id)?.description ?? "" })),
    pipeline: lead ? { etapa: lead.pipeline_stages?.name ?? null, valor: lead.estimated_value, proximaAcao: lead.next_action, data: lead.next_action_date } : null,
  };
}

/** Envia pelo WhatsApp com o nome de quem respondeu em cima ("*Rose:*"). */
export async function sendInboxMessage(conversationId: string, text: string, opts: { unsigned?: boolean; clientRef?: string; replyTo?: string } = {}): Promise<{ ok?: true; error?: string; warning?: string }> {
  try {
    const body = text.trim();
    if (!body) return { error: "Mensagem vazia." };
    if (!z.string().uuid().safeParse(conversationId).success) return { error: "Conversa inválida." };
    const clientRef = opts.clientRef && z.string().uuid().safeParse(opts.clientRef).success ? opts.clientRef : crypto.randomUUID();
    const { db, user, companyId, myName } = await context();
    const { data: conv } = await db.from("conversations").select("id,phone,external_id,channel_id").eq("id", conversationId).eq("company_id", companyId).single();
    if (!conv) return { error: "Conversa não encontrada." };
    // Contato "@lid" (sem numero): a Evolution envia direto para o identificador.
    const to = whatsappTarget(conv.phone || conv.external_id);
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "SUPABASE_SERVICE_ROLE_KEY não configurada no servidor." };
    // A config do WhatsApp tem segredos: lida com a chave de serviço, só desta empresa.
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const [{ data: cfg }, { data: company }] = await Promise.all([
      admin.from("ai_agent_config").select("*").eq("company_id", companyId).maybeSingle(),
      admin.from("companies").select("whatsapp_phone_number_id").eq("id", companyId).maybeSingle(),
    ]);
    const { error: pauseError } = await db.from("conversations").update({ ai_paused: true, assigned_to: user.id, ai_generation_id: null }).eq("id", conversationId).eq("company_id", companyId);
    if (pauseError) return { error: pauseError.message };
    await db.from("conversations").update({ ai_suggestion: null, ai_suggestion_at: null }).eq("id", conversationId).not("ai_suggestion", "is", null);
    // Sem assinatura só para o que o cliente precisa copiar inteiro (ex.: Pix copia e cola).
    const signed = opts.unsigned ? body : `*${myName}:*\n${body}`;
    // Resposta citando uma mensagem da mesma conversa (só se o WhatsApp já conhece essa mensagem).
    let quoted: QuotedMessage | null = null;
    if (opts.replyTo && z.string().uuid().safeParse(opts.replyTo).success) {
      const { data: original } = await db.from("messages").select("external_id,direction,body")
        .eq("id", opts.replyTo).eq("company_id", companyId).eq("conversation_id", conversationId).maybeSingle();
      if (original?.external_id) quoted = { id: original.external_id, fromMe: original.direction === "outbound", text: String(original.body ?? "").slice(0, 1000) };
    }
    const quotedPreview = quoted ? quoted.text.replace(/^\*[^*\n]{1,40}:\*\s*/, "").replace(/\s+/g, " ").trim().slice(0, 160) || null : null;
    // 1) Grava ANTES de enviar, com a chave do envio: duplo clique ou nova tentativa com a
    //    mesma chave não manda a mensagem duas vezes.
    const at = new Date().toISOString();
    const { data: row, error: rowError } = await db.from("messages").insert({
      company_id: companyId, conversation_id: conversationId, direction: "outbound", author: "equipe",
      sender_name: myName, sent_by: user.id, body: signed, delivery_status: "enviando", client_ref: clientRef, sent_at: at,
      ...(quoted ? { quoted_external_id: quoted.id, quoted_preview: quotedPreview } : {}),
    }).select("id").single();
    if (rowError?.code === "23505") {
      const { data: prev } = await db.from("messages").select("delivery_status").eq("company_id", companyId).eq("client_ref", clientRef).maybeSingle();
      return prev?.delivery_status === "falhou" ? { error: "Esta mensagem falhou antes. Escreva de novo para reenviar." } : { ok: true, warning: "Esta mensagem já foi enviada (ou está sendo enviada). Não reenvie." };
    }
    if (rowError || !row) return { error: `Mensagem não registrada, nada foi enviado: ${rowError?.message ?? ""}` };
    // 2) Envia pelo WhatsApp.
    let externalId: string | null = null;
    let failure: string | null = null;
    let unknown = false;
    try {
      externalId = await sendWhatsAppText(channelCredentials(cfg, await channelById(admin, conv.channel_id), { companyPhoneNumberId: company?.whatsapp_phone_number_id }), to, signed, { quoted });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      // Tempo esgotado / conexão caiu: pode ter saído. Não presume falha.
      unknown = sendOutcomeUnknown(error, failure);
    }
    // 3) Atualiza o registro com o resultado.
    const status = failure ? (unknown ? "desconhecido" : "falhou") : "enviada";
    const { error: updError } = await db.from("messages").update({
      external_id: externalId, delivery_status: status,
      error_message: failure ? (unknown ? `Sem confirmação do WhatsApp (${failure}). Confira no celular antes de reenviar.` : failure) : null,
    }).eq("id", row.id).eq("company_id", companyId);
    if (updError && !failure) return { ok: true, warning: "Mensagem enviada, mas o status não foi atualizado. Não reenvie." };
    await db.from("conversations").update({ last_message_at: at, last_message_preview: signed.replace(/^\*[^*\n]{1,40}:\*\s*\n?/, "").replace(/\s+/g, " ").trim().slice(0, 120), updated_at: new Date().toISOString() })
      .eq("id", conversationId).eq("company_id", companyId).or(`last_message_at.is.null,last_message_at.lte.${at}`);
    // Quem responde assume a conversa: a Lia para de responder esse cliente.
    await db.from("conversations").update({ ai_paused: true, assigned_to: user.id }).eq("id", conversationId);
    if (unknown) return { ok: true, warning: "O WhatsApp não confirmou o envio a tempo. Confira no celular antes de reenviar." };
    return failure ? { error: failure } : { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Devolve a conversa para a Lia (ou assume de novo). */
export async function setConversationAi(conversationId: string, aiOn: boolean): Promise<{ ok?: true; error?: string }> {
  try {
    const { db, user, companyId } = await context();
    if (aiOn) {
      const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: cfg } = await admin.from("ai_agent_config").select("active").eq("company_id", companyId).maybeSingle();
      if (!cfg?.active) return { error: "A IA está pausada globalmente. Ative-a na Central IA antes de devolver uma conversa." };
    }
    const { error } = await db.from("conversations")
      .update(aiOn ? { ai_paused: false, assigned_to: null, ai_generation_id: null } : { ai_paused: true, assigned_to: user.id, ai_generation_id: null })
      .eq("id", conversationId).eq("company_id", companyId);
    return error ? { error: error.message } : { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Cadastra o contato como cliente (com o nome digitado) e já lança no pipeline. */
export async function createClientFromConversation(conversationId: string, name: string): Promise<{ ok?: true; error?: string }> {
  try {
    const { db, companyId } = await context();
    const cleanName = formatRegistrationName(name);
    if (cleanName.length < 2) return { error: "Informe o nome do cliente." };
    const { data: conv } = await db.from("conversations").select("id,phone,external_id,client_id").eq("id", conversationId).eq("company_id", companyId).single();
    if (!conv) return { error: "Conversa não encontrada." };
    if (conv.client_id) return { ok: true };
    const raw = conv.phone || conv.external_id || "";
    const { data: client, error } = await db.from("clients")
      .insert({ company_id: companyId, name: cleanName, phone: formatBrPhone(raw), whatsapp: digitsOnly(raw), lead_source: "WhatsApp" })
      .select("id").single();
    if (error || !client) return { error: error?.message ?? "Cliente não cadastrado." };
    await db.from("conversations").update({ client_id: client.id }).eq("id", conversationId);
    const { error: pipelineError } = await db.rpc("launch_client_pipeline", { p_client_id: client.id, p_mode: "novo" });
    if (pipelineError) console.error("Pipeline do cliente novo:", pipelineError.message);
    revalidatePath("/clientes");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Liga a conversa a um cliente já cadastrado. */
export async function linkConversationClient(conversationId: string, clientId: string): Promise<{ ok?: true; error?: string }> {
  try {
    const { db, companyId } = await context();
    const { data: client } = await db.from("clients").select("id").eq("id", clientId).eq("company_id", companyId).maybeSingle();
    if (!client) return { error: "Cliente não encontrado." };
    const { error } = await db.from("conversations").update({ client_id: clientId }).eq("id", conversationId).eq("company_id", companyId);
    return error ? { error: error.message } : { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function searchClientsForLink(term: string): Promise<Array<{ id: string; name: string; phone: string | null }>> {
  const q = term.trim();
  if (q.length < 2) return [];
  const { db, companyId } = await context();
  const safe = q.replace(/[%,()]/g, " ");
  const { data } = await db.from("clients").select("id,name,phone").eq("company_id", companyId)
    .or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`).order("name").limit(8);
  return data ?? [];
}

/** Recebimento lançado direto no financeiro (mesma regra da tela Financeiro). */
export async function receiveFromInbox(input: {
  entryId: string; amount: number; discount: number; method: string; paidAt: string; notes?: string; accountId?: string;
}): Promise<{ ok?: true; error?: string }> {
  try {
    const parsed = z.object({
      entryId: z.string().uuid(), amount: z.number().finite().positive(), discount: z.number().finite().nonnegative(),
      method: z.string().min(1).max(40), paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().max(500).optional(),
      accountId: z.string().uuid().optional().or(z.literal("")),
    }).safeParse(input);
    if (!parsed.success) return { error: "Revise os dados do pagamento." };
    const { db, companyId } = await context();
    const p = parsed.data;
    // A função grava o desconto TOTAL do lançamento e não aceita mudar as parcelas
    // depois do 1º pagamento: soma o desconto novo ao que já existia e mantém o resto.
    const { data: entry } = await db.from("financial_entries")
      .select("interest_amount,discount_amount,installment_count,first_installment_due_date,due_date,open_amount")
      .eq("id", p.entryId).eq("company_id", companyId).single();
    if (!entry) return { error: "Lançamento não encontrado." };
    if (p.amount > Number(entry.open_amount ?? 0) - p.discount + 0.009) return { error: "Valor maior que o saldo em aberto (já descontado)." };
    const { data: paymentId, error } = await db.rpc("register_payment_with_adjustment", {
      p_entry_id: p.entryId, p_amount: p.amount, p_paid_at: p.paidAt, p_method: p.method, p_notes: p.notes?.trim() || "Recebido pelo Atendimento",
      p_interest: Number(entry.interest_amount ?? 0),
      p_discount: Number(entry.discount_amount ?? 0) + p.discount,
      p_installments: Math.max(1, Number(entry.installment_count ?? 1)),
      p_first_due_date: entry.first_installment_due_date ?? entry.due_date ?? p.paidAt,
    });
    if (error) return { error: error.message };
    if (p.accountId && paymentId) {
      const { error: accError } = await db.rpc("set_payment_account", { p_payment_id: paymentId, p_account_id: p.accountId });
      if (accError) { revalidatePath("/financeiro"); return { error: `Pagamento lançado, mas a conta não foi gravada: ${accError.message}` }; }
    }
    revalidatePath("/financeiro");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Fecha o orçamento: gera venda, pedido e conta a receber (regra do approve_quote). */
export async function closeQuoteFromInbox(quoteId: string, dueDate?: string): Promise<{ ok?: true; error?: string }> {
  try {
    if (!z.string().uuid().safeParse(quoteId).success) return { error: "Orçamento inválido." };
    if (dueDate && !validIsoDate(dueDate)) return { error: "Data de vencimento inválida." };
    const { db } = await context();
    const { error } = await db.rpc("approve_quote", { p_quote_id: quoteId, p_due_date: dueDate || null });
    if (error) return { error: error.message };
    revalidatePath("/orcamentos"); revalidatePath("/financeiro"); revalidatePath("/pipeline");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Called only after the visible conversation has rendered. CAS preserves arrivals during load. */
// Leitura interna (contador do CRM) e confirmação de leitura no WhatsApp são coisas separadas:
// a interna é gravada primeiro e não depende do WhatsApp responder.
// O contador só zera se nenhuma mensagem do cliente chegou depois da última que a pessoa viu na tela.
export async function markInboxRead(id: string, messageIds: string[], snapshot?: { count: number; lastInbound: string | null; generation: string | null }) {
  try {
    if (!z.string().uuid().safeParse(id).success || messageIds.length > 200 || !messageIds.every(v => z.string().uuid().safeParse(v).success)) return { error: "Leitura inválida." };
    const { db, companyId } = await context();
    const { data: conv } = await db.from("conversations").select("phone,external_id,unread_count,channel_id").eq("id", id).eq("company_id", companyId).single();
    if (!conv) return { error: "Conversa não encontrada." };
    const { data: seen, error: msgError } = messageIds.length
      ? await db.from("messages").select("id,external_id,delivery_status,sent_at").eq("company_id", companyId).eq("conversation_id", id).eq("direction", "inbound").in("id", messageIds)
      : { data: [], error: null };
    if (msgError) return { error: msgError.message };
    const lastSeen = (seen ?? []).reduce<string | null>((max, m) => (!max || new Date(m.sent_at).getTime() > new Date(max).getTime() ? m.sent_at : max), null);
    let cleared = (conv.unread_count ?? 0) === 0;
    if (!cleared) {
      let update = db.from("conversations").update({ unread_count: 0 }).eq("id", id).eq("company_id", companyId).gt("unread_count", 0);
      update = lastSeen ? update.lte("last_inbound_at", lastSeen) : update.is("last_inbound_at", null);
      if (snapshot) update = snapshot.generation ? update.eq("ai_generation_id", snapshot.generation) : update.is("ai_generation_id", null);
      const { data, error } = await update.select("id");
      if (error) return { error: error.message };
      cleared = !!data?.length;
    }
    // Lida no CRM até a mensagem mais nova vista: atrasadas mais antigas não voltam a contar.
    if (lastSeen) await advanceReadThrough(db, companyId, id, lastSeen);
    const pending = (seen ?? []).filter(m => m.external_id && m.delivery_status !== "lida");
    let receiptError: string | null = null;
    if (pending.length) {
      try {
        const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const [{ data: cfg }, { data: company }] = await Promise.all([
          admin.from("ai_agent_config").select("*").eq("company_id", companyId).maybeSingle(),
          admin.from("companies").select("whatsapp_phone_number_id").eq("id", companyId).maybeSingle(),
        ]);
        await markWhatsAppRead(channelCredentials(cfg, await channelById(admin, conv.channel_id), { companyPhoneNumberId: company?.whatsapp_phone_number_id }), whatsappTarget(conv.phone || conv.external_id), pending.map(m => m.external_id));
        const { error: receiptUpdate } = await db.from("messages").update({ delivery_status: "lida" }).eq("company_id", companyId).eq("conversation_id", id).in("id", pending.map(m => m.id));
        if (receiptUpdate) receiptError = receiptUpdate.message;
      } catch (error) {
        // Sem confirmação no WhatsApp agora: a leitura interna já valeu; tenta de novo na próxima abertura.
        receiptError = error instanceof Error ? error.message : String(error);
      }
    }
    return { ok: true, cleared, receiptError };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

export async function markConversationRead(id: string) {
  try {
    if (!z.string().uuid().safeParse(id).success) return { error: "Conversa inválida." };
    const { db, companyId } = await context();
    const { data: conv, error } = await db.from("conversations").select("unread_count,last_inbound_at,ai_generation_id").eq("id", id).eq("company_id", companyId).single();
    if (error || !conv) return { error: "Conversa não encontrada." };
    const { data: messages, error: messagesError } = await db.from("messages").select("id").eq("conversation_id", id).eq("company_id", companyId)
      .eq("direction", "inbound").order("sent_at", { ascending: false }).limit(200);
    if (messagesError) return { error: messagesError.message };
    return markInboxRead(id, (messages ?? []).map(m => m.id), { count: conv.unread_count, lastInbound: conv.last_inbound_at, generation: conv.ai_generation_id });
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

export async function markConversationUnread(id: string) {
  try {
    if (!z.string().uuid().safeParse(id).success) return { error: "Conversa inválida." };
    const { db, companyId } = await context();
    const { data: conv, error: readError } = await db.from("conversations").select("phone,external_id,channel_id").eq("id", id).eq("company_id", companyId).single();
    if (readError || !conv) return { error: "Conversa não encontrada." };
    // Não troca uma contagem real por 1 se outra mensagem chegar ao mesmo tempo.
    const { error } = await db.from("conversations").update({ unread_count: 1 }).eq("id", id).eq("company_id", companyId).eq("unread_count", 0);
    if (error) return { error: error.message };
    try {
      const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: cfg } = await admin.from("ai_agent_config").select("*").eq("company_id", companyId).maybeSingle();
      const { data: last } = await db.from("messages").select("external_id").eq("conversation_id", id).eq("company_id", companyId)
        .not("external_id", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle();
      await markWhatsAppUnread(channelCredentials(cfg, await channelById(admin, conv.channel_id)), whatsappTarget(conv.phone || conv.external_id), last?.external_id);
      return { ok: true };
    } catch { return { ok: true, warning: "Conversa marcada como não lida no CRM. A marcação no WhatsApp está pendente." }; }
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

export async function syncInboxContacts() {
  try {
    const { db, companyId } = await context();
    const inserted = await refreshInboxMessages(db, companyId);
    const count = await refreshAgendaNames(db, companyId, true);
    await autoLinkClients(db, companyId);
    return { ok: true, count, inserted };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

/**
 * Envia a sugestão da Lia como está, aprovada por quem clicou. Sai como mensagem da
 * Lia (a conversa continua com ela) e fica registrada com quem aprovou.
 */
export async function approveLiaSuggestion(conversationId: string, expectedAt: string): Promise<{ ok?: true; error?: string; warning?: string }> {
  try {
    if (!z.string().uuid().safeParse(conversationId).success) return { error: "Conversa inválida." };
    const { db, user, companyId, myName } = await context();
    const { data: conv } = await db.from("conversations").select("id,phone,external_id,channel_id,ai_suggestion,ai_suggestion_at")
      .eq("id", conversationId).eq("company_id", companyId).maybeSingle();
    if (!conv) return { error: "Conversa não encontrada." };
    const text = String(conv.ai_suggestion ?? "").trim();
    if (!text || conv.ai_suggestion_at !== expectedAt) return { error: "Essa sugestão já foi usada, descartada ou substituída por uma nova." };
    // Retira a sugestão de forma condicional: dois cliques (ou duas pessoas) não enviam duas vezes.
    const { data: taken, error: takeError } = await db.from("conversations")
      .update({ ai_suggestion: null, ai_suggestion_at: null })
      .eq("id", conversationId).eq("company_id", companyId).eq("ai_suggestion_at", expectedAt)
      .select("id");
    if (takeError) return { error: takeError.message };
    if (!taken?.length) return { error: "Essa sugestão já foi usada por outra pessoa." };
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "SUPABASE_SERVICE_ROLE_KEY não configurada no servidor." };
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const [{ data: cfg }, { data: company }] = await Promise.all([
      admin.from("ai_agent_config").select("*").eq("company_id", companyId).maybeSingle(),
      admin.from("companies").select("whatsapp_phone_number_id").eq("id", companyId).maybeSingle(),
    ]);
    const agentName = cfg?.agent_name && cfg.agent_name !== "Ana" ? String(cfg.agent_name) : "Lia";
    let externalId: string | null = null;
    let failure: string | null = null;
    let unknown = false;
    try {
      // Contato "@lid" (sem numero): envia para o identificador, como no envio normal.
      externalId = await sendWhatsAppText(channelCredentials(cfg, await channelById(admin, conv.channel_id), { companyPhoneNumberId: company?.whatsapp_phone_number_id }), whatsappTarget(conv.phone || conv.external_id), text);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      unknown = sendOutcomeUnknown(error, failure);
    }
    try {
      await recordOutbound(db, { companyId, conversationId, body: text, author: "ana", senderName: `${agentName} (aprovada por ${myName})`, sentBy: user.id, externalId,
        deliveryStatus: failure ? (unknown ? "desconhecido" : "falhou") : "enviada",
        error: failure ? (unknown ? `Sem confirmação do WhatsApp (${failure}). Confira no celular antes de reenviar.` : failure) : null });
    } catch (recordError) {
      if (!failure || unknown) return { ok: true, warning: "Mensagem enviada (ou sem confirmação), mas não apareceu no histórico. Confira no celular e não reenvie." };
      throw recordError;
    }
    // Pode ter saído: não devolve a sugestão (evita mandar duas vezes); o eco do celular confirma.
    if (unknown) return { ok: true, warning: "O WhatsApp não confirmou o envio a tempo. Confira no celular antes de reenviar." };
    if (failure) {
      // Volta a sugestão para tentar de novo.
      await db.from("conversations").update({ ai_suggestion: text, ai_suggestion_at: new Date().toISOString() }).eq("id", conversationId).is("ai_suggestion", null);
      return { error: failure };
    }
    await admin.from("ai_decisions").insert({ company_id: companyId, conversation_id: conversationId, phone: conv.phone, decisao: "aprovada", motivo: `Sugestão aprovada por ${myName}`, modo: cfg?.lia_mode ?? null });
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Descarta a sugestão da Lia (a equipe responde do seu jeito). */
export async function discardLiaSuggestion(conversationId: string): Promise<{ ok?: true; error?: string }> {
  try {
    if (!z.string().uuid().safeParse(conversationId).success) return { error: "Conversa inválida." };
    const { db, companyId } = await context();
    const { error } = await db.from("conversations").update({ ai_suggestion: null, ai_suggestion_at: null }).eq("id", conversationId).eq("company_id", companyId);
    return error ? { error: error.message } : { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const rpcError = (message: string) => message.replace(/^.*?:\s*/, "").slice(0, 200) || "Não foi possível concluir.";

export async function addInboxNote(conversationId: string, body: string): Promise<{ ok?: true; error?: string }> {
  try {
    if (!z.string().uuid().safeParse(conversationId).success) return { error: "Conversa inválida." };
    const { db } = await context();
    const { error } = await db.rpc("conversation_add_note", { p_conversation: conversationId, p_body: body });
    return error ? { error: rpcError(error.message) } : { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function transferConversation(conversationId: string, input: { toProfile: string | null; department: string | null; note?: string }): Promise<{ ok?: true; error?: string }> {
  try {
    if (!z.string().uuid().safeParse(conversationId).success) return { error: "Conversa inválida." };
    if (input.toProfile && !z.string().uuid().safeParse(input.toProfile).success) return { error: "Atendente inválido." };
    const { db } = await context();
    const { error } = await db.rpc("conversation_transfer", { p_conversation: conversationId, p_to_profile: input.toProfile, p_department: input.department, p_note: input.note ?? null });
    return error ? { error: rpcError(error.message) } : { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setConversationStatus(conversationId: string, status: ConversationStatus): Promise<{ ok?: true; error?: string }> {
  try {
    if (!z.string().uuid().safeParse(conversationId).success) return { error: "Conversa inválida." };
    const { db } = await context();
    const { error } = await db.rpc("conversation_set_status", { p_conversation: conversationId, p_status: status });
    return error ? { error: rpcError(error.message) } : { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Pessoas ativas da empresa, para transferir a conversa. */
export async function listInboxTeam(): Promise<Array<{ id: string; name: string }>> {
  try {
    const { db, companyId } = await context();
    const { data } = await db.from("profiles").select("id,full_name").eq("company_id", companyId).eq("status", "ativo").order("full_name");
    return (data ?? []).map(p => ({ id: p.id, name: p.full_name }));
  } catch {
    return [];
  }
}

/** Busca no texto das mensagens (histórico inteiro). Devolve a conversa e um trecho. */
export async function searchInboxHistory(term: string): Promise<{ results: Array<{ conversationId: string; snippet: string; at: string }>; error?: string }> {
  try {
    const q = term.trim();
    if (q.length < 3) return { results: [] };
    const { db, companyId } = await context();
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const { data, error } = await db.from("messages").select("conversation_id,body,sent_at")
      .eq("company_id", companyId).ilike("body", pattern).order("sent_at", { ascending: false }).limit(80);
    if (error) return { results: [], error: "Não foi possível buscar no histórico." };
    const seen = new Set<string>();
    const results: Array<{ conversationId: string; snippet: string; at: string }> = [];
    for (const m of data ?? []) {
      if (seen.has(m.conversation_id)) continue;
      seen.add(m.conversation_id);
      const body = String(m.body ?? "");
      const i = body.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, i - 30);
      results.push({ conversationId: m.conversation_id, snippet: (start > 0 ? "…" : "") + body.slice(start, start + 90), at: m.sent_at });
      if (results.length >= 30) break;
    }
    return { results };
  } catch (error) {
    return { results: [], error: error instanceof Error ? error.message : String(error) };
  }
}
