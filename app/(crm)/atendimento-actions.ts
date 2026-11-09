"use server";
// Tela de Atendimento (estilo Octadesk): conversas do WhatsApp + ficha do cliente.
import { createClient as createAdmin } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { firstName } from "@/lib/seller-name";
import { todayISO } from "@/lib/utils";
import { autoLinkClients, recordOutbound } from "@/lib/whatsapp/inbox-store";
import { syncAgendaNames } from "@/lib/whatsapp/evolution-history";
import { decryptSecret } from "@/lib/encrypt";
import { cleanContactName, formatBrPhone, digitsOnly } from "@/lib/whatsapp/phone";
import { sendWhatsAppText, whatsappCredentials } from "@/lib/whatsapp/send";

export type InboxItem = {
  id: string; name: string; phone: string; clientId: string | null; clientName: string | null;
  preview: string; lastAt: string | null; unread: number; aiPaused: boolean; assignedName: string | null;
};
export type InboxMessage = {
  id: string; direction: "inbound" | "outbound"; author: string | null; senderName: string | null;
  body: string; at: string; failed: boolean; error: string | null; pending?: boolean;
};
export type ClientPanel = {
  client: { id: string; name: string; phone: string | null; email: string | null; city: string | null; address: string | null; notes: string | null; created_at: string };
  resumo: { feitos: number; enviados: number; fechados: number; valorFechado: number; recebido: number; aReceber: number; vencido: number };
  orcamentos: Array<{ id: string; numero: string; status: string; total: number; data: string; fechado: boolean }>;
  contas: Array<{ id: string; descricao: string; total: number; pago: number; aberto: number; vencimento: string | null; status: string; vencida: boolean }>;
  pagamentos: Array<{ valor: number; data: string; forma: string | null; descricao: string }>;
  pipeline: { etapa: string | null; valor: number | null; proximaAcao: string | null; data: string | null } | null;
};
export type TriageInfo = { resumo: string | null; dados: Record<string, unknown> } | null;
export type ConversationDetail = { conversation: InboxItem; messages: InboxMessage[]; panel: ClientPanel | null; triage: TriageInfo; windowOpen: boolean };

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
  ai_paused: boolean | null; assigned_to: string | null; last_inbound_at?: string | null;
  clients?: { name: string } | null; profiles?: { full_name: string } | null;
};
const CONV_COLUMNS = "id,contact_name,phone,external_id,client_id,last_message_preview,last_message_at,last_inbound_at,created_at,unread_count,ai_paused,assigned_to,clients(name),profiles:assigned_to(full_name)";

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
  };
}

const agendaSyncedAt = new Map<string, number>();
/** Nomes da agenda do celular, no máximo a cada 6 h (só quem pode ver a configuração da Evolution). */
async function refreshAgendaNames(db: Awaited<ReturnType<typeof context>>["db"], companyId: string) {
  if (Date.now() - (agendaSyncedAt.get(companyId) ?? 0) < 6 * 3600_000) return 0;
  agendaSyncedAt.set(companyId, Date.now());
  const { data: cfg } = await db.from("ai_agent_config").select("evolution_api_url,evolution_api_key,evolution_instance,wpp_provider").eq("company_id", companyId).maybeSingle();
  const key = cfg?.evolution_api_key ? decryptSecret(cfg.evolution_api_key) : "";
  if (!cfg?.evolution_api_url || !key) return 0;
  return syncAgendaNames(db, companyId, cfg.evolution_api_url, key, cfg.evolution_instance || "crm");
}

export async function loadInbox(): Promise<{ items: InboxItem[]; error?: string }> {
  try {
    const { db, companyId } = await context();
    // Sempre puxa do cadastro: liga conversas a clientes e, de tempos em tempos, os nomes da agenda.
    await Promise.all([autoLinkClients(db, companyId).catch(() => 0), refreshAgendaNames(db, companyId).catch(() => 0)]);
    const { data, error } = await db.from("conversations").select(CONV_COLUMNS)
      .eq("company_id", companyId).eq("channel", "whatsapp").not("last_message_at", "is", null)
      .order("last_message_at", { ascending: false }).limit(150);
    if (error) return { items: [], error: /column|does not exist/i.test(error.message) ? "Falta aplicar a atualização do banco do Atendimento (migração 20261108000000)." : error.message };
    return { items: ((data ?? []) as unknown as ConvRow[]).map(toItem) };
  } catch (error) {
    return { items: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadConversation(conversationId: string): Promise<ConversationDetail | { error: string }> {
  try {
    if (!z.string().uuid().safeParse(conversationId).success) return { error: "Conversa inválida." };
    const { db, companyId } = await context();
    const { data: conv, error } = await db.from("conversations").select(CONV_COLUMNS).eq("id", conversationId).eq("company_id", companyId).single();
    if (error || !conv) return { error: "Conversa não encontrada." };
    const row = conv as unknown as ConvRow;
    const [{ data: msgs }, panel, triage] = await Promise.all([
      db.from("messages").select("id,direction,author,sender_name,body,sent_at,delivery_status,error_message")
        .eq("conversation_id", conversationId).order("sent_at", { ascending: false }).limit(200),
      row.client_id ? loadClientPanel(db, companyId, row.client_id) : Promise.resolve(null),
      loadTriage(db, companyId, row.phone || row.external_id || ""),
    ]);
    if ((row.unread_count ?? 0) > 0) await db.from("conversations").update({ unread_count: 0 }).eq("id", conversationId);
    const messages: InboxMessage[] = (msgs ?? []).reverse().map((m) => ({
      id: m.id, direction: m.direction === "outbound" ? "outbound" : "inbound", author: m.author, senderName: m.sender_name,
      body: m.body ?? "", at: m.sent_at, pending: ["uploading","processing"].includes(m.delivery_status), failed: m.delivery_status === "falhou", error: m.error_message,
    }));
    const lastInbound = row.last_inbound_at ?? [...messages].reverse().find((m) => m.direction === "inbound")?.at ?? null;
    const windowOpen = !!lastInbound && Date.now() - new Date(lastInbound).getTime() < 24 * 60 * 60_000;
    return { conversation: { ...toItem(row), unread: 0 }, messages, panel, triage, windowOpen };
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
  const [clientRes, quotesRes, entriesRes, leadRes] = await Promise.all([
    db.from("clients").select("id,name,phone,whatsapp,email,city,neighborhood,address,notes,created_at").eq("id", clientId).eq("company_id", companyId).maybeSingle(),
    db.from("quotes").select("id,quote_number,status,total,created_at,approved_at,sale_id").eq("client_id", clientId).eq("company_id", companyId).order("created_at", { ascending: false }).limit(30),
    db.from("financial_entries").select("id,description,total_amount,paid_amount,open_amount,due_date,status").eq("client_id", clientId).eq("company_id", companyId).eq("entry_type", "receber").neq("status", "cancelado").order("due_date", { ascending: true }).limit(50),
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
export async function sendInboxMessage(conversationId: string, text: string, opts: { unsigned?: boolean } = {}): Promise<{ ok?: true; error?: string }> {
  try {
    const body = text.trim();
    if (!body) return { error: "Mensagem vazia." };
    if (!z.string().uuid().safeParse(conversationId).success) return { error: "Conversa inválida." };
    const { db, user, companyId, myName } = await context();
    const { data: conv } = await db.from("conversations").select("id,phone,external_id").eq("id", conversationId).eq("company_id", companyId).single();
    if (!conv) return { error: "Conversa não encontrada." };
    const to = digitsOnly(conv.phone || conv.external_id);
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "SUPABASE_SERVICE_ROLE_KEY não configurada no servidor." };
    // A config do WhatsApp tem segredos: lida com a chave de serviço, só desta empresa.
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const [{ data: cfg }, { data: company }] = await Promise.all([
      admin.from("ai_agent_config").select("*").eq("company_id", companyId).maybeSingle(),
      admin.from("companies").select("whatsapp_phone_number_id").eq("id", companyId).maybeSingle(),
    ]);
    // Sem assinatura só para o que o cliente precisa copiar inteiro (ex.: Pix copia e cola).
    const signed = opts.unsigned ? body : `*${myName}:*\n${body}`;
    let externalId: string | null = null;
    let failure: string | null = null;
    try {
      externalId = await sendWhatsAppText(whatsappCredentials(cfg, { companyPhoneNumberId: company?.whatsapp_phone_number_id }), to, signed);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    await recordOutbound(db, { companyId, conversationId, body: signed, author: "equipe", senderName: myName, sentBy: user.id, externalId, deliveryStatus: failure ? "falhou" : "enviada", error: failure });
    // Quem responde assume a conversa: a Lia para de responder esse cliente.
    await db.from("conversations").update({ ai_paused: true, assigned_to: user.id, unread_count: 0 }).eq("id", conversationId);
    return failure ? { error: failure } : { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Devolve a conversa para a Lia (ou assume de novo). */
export async function setConversationAi(conversationId: string, aiOn: boolean): Promise<{ ok?: true; error?: string }> {
  try {
    const { db, user, companyId } = await context();
    const { error } = await db.from("conversations")
      .update(aiOn ? { ai_paused: false, assigned_to: null } : { ai_paused: true, assigned_to: user.id })
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
    const cleanName = name.trim();
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
    const { db } = await context();
    const { error } = await db.rpc("approve_quote", { p_quote_id: quoteId, p_due_date: dueDate || null });
    if (error) return { error: error.message };
    revalidatePath("/orcamentos"); revalidatePath("/financeiro"); revalidatePath("/pipeline");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
