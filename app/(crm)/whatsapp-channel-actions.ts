"use server";
// Números de WhatsApp da empresa (canais). Cada usuário pode conectar um número lendo o
// QR; as conversas desse número ficam com ele, com quem ele autorizar e com a gerência.
// Cadastros (clientes, orçamentos…) continuam centralizados.
import { randomBytes } from "node:crypto";
import { waitingSince } from "@/lib/inbox-waiting";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient as createAdmin, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret } from "@/lib/encrypt";
import { ensureEvolutionInstance, evolutionLogout, evolutionOwnerPhone, evolutionQr, evolutionRestart, evolutionState } from "@/lib/whatsapp/evolution";
import { syncRecentEvolutionMessages } from "@/lib/whatsapp/evolution-history";

type Result<T = object> = ({ ok: true } & T) | { ok?: false; error: string };
const fail = (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) });
export type ChannelRow = {
  id: string; name: string; provider: string; instance: string | null; phone: string | null; isDefault: boolean; shared: boolean;
  active: boolean; status: string | null; lastEventAt: string | null; lastRestartAt: string | null; lastSyncAt: string | null;
  ownerId: string | null; ownerName: string | null; mine: boolean; canManage: boolean; members: Array<{ id: string; name: string }>;
  /** Saúde do número (últimas 24 h / 7 dias). */
  lastInboundAt: string | null; failed24h: number; unconfirmed24h: number; waitingOver2h: number;
};

async function context() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!profile?.company_id) throw new Error("Empresa não encontrada.");
  const { data: roles } = await db.rpc("current_user_roles");
  const manager = Array.isArray(roles) && roles.some((r: string) => r === "administrador" || r === "gerente");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Servidor sem configuração.");
  const admin: SupabaseClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return { db, admin, userId: user.id, companyId: profile.company_id as string, manager };
}

/** Servidor da Evolution da empresa (o mesmo do PC) — os números novos são instâncias nele. */
async function server(admin: SupabaseClient, companyId: string) {
  const { data: cfg } = await admin.from("ai_agent_config").select("evolution_api_url,evolution_api_key").eq("company_id", companyId).maybeSingle();
  const url = typeof cfg?.evolution_api_url === "string" ? cfg.evolution_api_url : "";
  const key = cfg?.evolution_api_key ? decryptSecret(String(cfg.evolution_api_key)) : "";
  if (!url || !key) throw new Error("O servidor do WhatsApp (Evolution) ainda não está conectado. Conecte o número principal na Central de IA primeiro.");
  return { url, key };
}

async function webhookUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}/api/whatsapp/webhook`;
}

async function ownChannel(ctx: Awaited<ReturnType<typeof context>>, id: string) {
  if (!z.uuid().safeParse(id).success) throw new Error("Canal inválido.");
  const { data: ch } = await ctx.admin.from("whatsapp_channels").select("*").eq("id", id).eq("company_id", ctx.companyId).is("deleted_at", null).maybeSingle();
  if (!ch) throw new Error("Número não encontrado.");
  const canManage = ctx.manager || ch.owner_id === ctx.userId;
  return { ch, canManage };
}

/** Resumo consolidado de saúde de todos os canais (view v_whatsapp_health_summary). */
export type WhatsappHealthSummary = Array<{
  channel_id: string;
  channel_name: string;
  current_status: string | null;
  last_connection_event: string | null;
  last_connection_event_at: string | null;
  events_last_24h: number;
  errors_last_24h: number;
}>;

export async function loadWhatsappHealthSummary(): Promise<Result<{ summary: WhatsappHealthSummary }>> {
  try {
    const ctx = await context();
    const { data, error } = await ctx.db.from("v_whatsapp_health_summary").select("*");
    if (error) return fail(error);
    return { ok: true, summary: (data ?? []) as WhatsappHealthSummary };
  } catch (e) { return fail(e); }
}

export async function listWhatsappChannels(): Promise<Result<{ channels: ChannelRow[]; team: Array<{ id: string; name: string }>; manager: boolean }>> {
  try {
    const ctx = await context();
    // Empresa com WhatsApp conectado mas sem o "número principal" na lista (ex.: conectou depois da
    // atualização): cria o principal a partir da conexão existente, sem mexer em conversas.
    const { data: hasDefault } = await ctx.admin.from("whatsapp_channels").select("id").eq("company_id", ctx.companyId).eq("is_default", true).is("deleted_at", null).maybeSingle();
    if (!hasDefault) {
      const { data: cfg } = await ctx.admin.from("ai_agent_config").select("evolution_instance,evolution_api_url,wpp_provider,whatsapp_number_id").eq("company_id", ctx.companyId).maybeSingle();
      const evolution = cfg?.wpp_provider === "evolution" || !!cfg?.evolution_api_url;
      if (cfg && (evolution || cfg.whatsapp_number_id)) {
        await ctx.admin.from("whatsapp_channels").insert({ company_id: ctx.companyId, name: "WhatsApp principal", provider: evolution ? "evolution" : "meta",
          instance: evolution ? (cfg.evolution_instance || "crm") : null, phone_number_id: evolution ? null : cfg.whatsapp_number_id, is_default: true, shared: true, owner_id: null, status: "migrado" })
          .then(() => undefined, () => undefined);
      }
    }
    const [{ data: visible }, { data: chans }, { data: members }, { data: team }] = await Promise.all([
      ctx.db.rpc("my_whatsapp_channels"),
      ctx.admin.from("whatsapp_channels").select("id,name,provider,instance,phone_display,phone_number_id,is_default,shared,active,status,last_event_at,last_message_event_at,last_restart_at,last_sync_at,owner_id").eq("company_id", ctx.companyId).is("deleted_at", null).order("is_default", { ascending: false }).order("created_at"),
      ctx.admin.from("whatsapp_channel_members").select("channel_id,profile_id").eq("company_id", ctx.companyId),
      ctx.admin.from("profiles").select("id,full_name").eq("company_id", ctx.companyId).eq("status", "ativo").order("full_name"),
    ]);
    // Saúde por número: última mensagem recebida, envios com problema e clientes esperando.
    const sinceDay = new Date(Date.now() - 24 * 3600_000).toISOString();
    const sinceWeek = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const [{ data: bad }, { data: recent }] = await Promise.all([
      ctx.admin.from("messages").select("delivery_status,conversation:conversations!inner(channel_id)").eq("company_id", ctx.companyId).eq("direction", "outbound").in("delivery_status", ["falhou", "desconhecido"]).gte("sent_at", sinceDay).limit(2000),
      ctx.admin.from("conversations").select("channel_id,last_inbound_at,last_message_at,status,archived_at").eq("company_id", ctx.companyId).not("last_inbound_at", "is", null).gte("last_inbound_at", sinceWeek).limit(3000),
    ]);
    const health = new Map<string, { last: string | null; failed: number; unconfirmed: number; waiting: number }>();
    const slot = (id: string | null) => { const k = id ?? "none"; if (!health.has(k)) health.set(k, { last: null, failed: 0, unconfirmed: 0, waiting: 0 }); return health.get(k)!; };
    for (const m of (bad ?? []) as unknown as Array<{ delivery_status: string; conversation: { channel_id: string | null } | { channel_id: string | null }[] | null }>) {
      const conv = Array.isArray(m.conversation) ? m.conversation[0] : m.conversation;
      const h = slot(conv?.channel_id ?? null);
      if (m.delivery_status === "falhou") h.failed++; else h.unconfirmed++;
    }
    for (const c of (recent ?? []) as Array<{ channel_id: string | null; last_inbound_at: string; last_message_at: string | null; status: string | null; archived_at: string | null }>) {
      const h = slot(c.channel_id);
      if (!h.last || c.last_inbound_at > h.last) h.last = c.last_inbound_at;
      const waiting = waitingSince(c.last_inbound_at, c.last_message_at);
      if (waiting && !c.archived_at && c.status !== "resolvida" && Date.now() - Date.parse(waiting) > 2 * 3600_000) h.waiting++;
    }
    const names = new Map(((team ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name || "Usuário"]));
    const allowed = new Set((visible as string[] | null) ?? []);
    const channels = ((chans ?? []) as Array<Record<string, any>>).filter((c) => allowed.has(c.id)).map((c) => ({
      id: c.id, name: c.name, provider: c.provider, instance: c.instance, phone: c.phone_display ?? c.phone_number_id ?? null,
      isDefault: !!c.is_default, shared: !!c.shared, active: !!c.active, status: c.status ?? null, lastEventAt: c.last_message_event_at ?? c.last_event_at ?? null, lastRestartAt: c.last_restart_at ?? null, lastSyncAt: c.last_sync_at ?? null,
      ownerId: c.owner_id ?? null, ownerName: c.owner_id ? names.get(c.owner_id) ?? null : null, mine: c.owner_id === ctx.userId,
      canManage: ctx.manager || c.owner_id === ctx.userId,
      lastInboundAt: health.get(c.id)?.last ?? null, failed24h: health.get(c.id)?.failed ?? 0, unconfirmed24h: health.get(c.id)?.unconfirmed ?? 0, waitingOver2h: health.get(c.id)?.waiting ?? 0,
      members: ((members ?? []) as Array<{ channel_id: string; profile_id: string }>).filter((m) => m.channel_id === c.id).map((m) => ({ id: m.profile_id, name: names.get(m.profile_id) ?? "Usuário" })),
    }));
    return { ok: true, channels, team: [...names].map(([id, name]) => ({ id, name })), manager: ctx.manager };
  } catch (e) { return fail(e); }
}

/** Adiciona um número: cria a instância no servidor da empresa e devolve o canal para ler o QR. */
export async function addWhatsappChannel(name: string): Promise<Result<{ id: string }>> {
  try {
    const ctx = await context();
    const label = name.trim().slice(0, 60);
    if (label.length < 2) return { error: "Dê um nome ao número (ex.: WhatsApp Esquadrias)." };
    const { data: access } = await ctx.db.rpc("has_table_access", { resource: "conversations", action: "select" });
    if (access !== true) return { error: "Seu usuário não tem acesso ao Atendimento." };
    const { url, key } = await server(ctx.admin, ctx.companyId);
    const slug = label.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "numero";
    const instance = `crm-${slug}-${randomBytes(3).toString("hex")}`;
    const hook = randomBytes(24).toString("hex");
    const { data: ch, error } = await ctx.admin.from("whatsapp_channels").insert({
      company_id: ctx.companyId, name: label, provider: "evolution", instance, webhook_secret: encryptSecret(hook),
      owner_id: ctx.userId, created_by: ctx.userId, shared: false, status: "aguardando_qr",
    }).select("id").single();
    if (error || !ch) return { error: error?.message ?? "Não foi possível criar o número." };
    try { await ensureEvolutionInstance(url, key, instance, await webhookUrl(), hook); }
    catch (e) {
      await ctx.admin.from("whatsapp_channels").update({ deleted_at: new Date().toISOString(), active: false, status: "erro_criacao" }).eq("id", ch.id);
      throw e;
    }
    await ctx.admin.from("audit_logs").insert({ company_id: ctx.companyId, profile_id: ctx.userId, table_name: "whatsapp_channels", record_id: ch.id, action: "CREATE", new_data: { name: label, instance } });
    revalidatePath("/atendimento/canais");
    return { ok: true, id: ch.id };
  } catch (e) { return fail(e); }
}

/** QR para ler no celular (ou estado "open" quando já conectou). */
export async function whatsappChannelQr(id: string): Promise<Result<{ state: string; qr: string | null; pairingCode: string | null; phone: string | null }>> {
  try {
    const ctx = await context();
    const { ch, canManage } = await ownChannel(ctx, id);
    if (!canManage) return { error: "Só quem conectou o número ou a gerência pode ver o QR." };
    if (ch.provider !== "evolution") return { error: "Este número usa a API oficial da Meta (sem QR)." };
    const { url, key } = await server(ctx.admin, ctx.companyId);
    const apiUrl = ch.api_url || url; const apiKey = ch.api_key ? decryptSecret(ch.api_key) : key;
    const state = await evolutionState(apiUrl, apiKey, ch.instance);
    if (state === "open") {
      const phone = await evolutionOwnerPhone(apiUrl, apiKey, ch.instance).catch(() => null);
      await ctx.admin.from("whatsapp_channels").update({ status: "open", active: true, ...(phone ? { phone_display: phone } : {}), updated_at: new Date().toISOString() }).eq("id", ch.id);
      return { ok: true, state, qr: null, pairingCode: null, phone: phone ?? ch.phone_display ?? null };
    }
    const { qr, pairingCode } = await evolutionQr(apiUrl, apiKey, ch.instance);
    await ctx.admin.from("whatsapp_channels").update({ status: state }).eq("id", ch.id);
    return { ok: true, state, qr, pairingCode, phone: null };
  } catch (e) { return fail(e); }
}

/**
 * Reinicia a conexão do número sem desconectar (não pede QR). Resolve quando o número aparece
 * conectado mas as mensagens pararam de entrar. Depois busca as mensagens recentes.
 */
export async function restartWhatsappChannel(id: string): Promise<Result<{ state: string; inserted: number }>> {
  try {
    const ctx = await context();
    const { ch, canManage } = await ownChannel(ctx, id);
    if (!canManage) return { error: "Só quem conectou o número ou a gerência pode reiniciar." };
    if (ch.provider !== "evolution") return { error: "Este número usa a API oficial da Meta (não precisa reiniciar)." };
    const { url, key } = await server(ctx.admin, ctx.companyId);
    const apiUrl = ch.api_url || url; const apiKey = ch.api_key ? decryptSecret(ch.api_key) : key;
    await evolutionRestart(apiUrl, apiKey, ch.instance);
    const at = new Date().toISOString();
    await ctx.admin.from("whatsapp_channels").update({ last_restart_at: at, updated_at: at }).eq("id", ch.id);
    await ctx.admin.from("audit_logs").insert({ company_id: ctx.companyId, profile_id: ctx.userId, table_name: "whatsapp_channels", record_id: ch.id, action: "RESTART", new_data: { name: ch.name } });
    // A conexão volta em poucos segundos; espera um pouco e já traz o que chegou.
    let state = "connecting";
    for (let i = 0; i < 6 && state !== "open"; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      state = await evolutionState(apiUrl, apiKey, ch.instance).catch(() => "connecting");
    }
    let inserted = 0;
    if (state === "open") inserted = (await syncRecentEvolutionMessages(ctx.admin, ctx.companyId, apiUrl, apiKey, ch.instance, ch.id, { maxPages: 5 }).catch(() => ({ inserted: 0 }))).inserted;
    await ctx.admin.from("whatsapp_channels").update({ status: state }).eq("id", ch.id);
    revalidatePath("/atendimento/canais"); revalidatePath("/atendimento");
    return { ok: true, state, inserted };
  } catch (e) { return fail(e); }
}

export async function setWhatsappChannelAccess(id: string, profileId: string, allow: boolean): Promise<Result> {
  try {
    const ctx = await context();
    if (!z.uuid().safeParse(profileId).success) return { error: "Usuário inválido." };
    const { error } = await ctx.db.rpc("set_whatsapp_channel_access", { p_channel: id, p_profile: profileId, p_allow: allow });
    if (error) return { error: error.message };
    revalidatePath("/atendimento/canais");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function renameWhatsappChannel(id: string, name: string): Promise<Result> {
  try {
    const ctx = await context();
    const { ch, canManage } = await ownChannel(ctx, id);
    if (!canManage) return { error: "Só quem conectou o número ou a gerência pode alterar." };
    const label = name.trim().slice(0, 60);
    if (label.length < 2) return { error: "Nome muito curto." };
    await ctx.admin.from("whatsapp_channels").update({ name: label, updated_at: new Date().toISOString() }).eq("id", ch.id);
    revalidatePath("/atendimento/canais");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Desconecta o número (o histórico continua no CRM). O número principal fica na Central de IA. */
export async function disconnectWhatsappChannel(id: string): Promise<Result> {
  try {
    const ctx = await context();
    const { ch, canManage } = await ownChannel(ctx, id);
    if (!canManage) return { error: "Só quem conectou o número ou a gerência pode desconectar." };
    if (ch.is_default) return { error: "O número principal é desconectado pela Central de IA." };
    if (ch.provider === "evolution") {
      const { url, key } = await server(ctx.admin, ctx.companyId);
      await evolutionLogout(ch.api_url || url, ch.api_key ? decryptSecret(ch.api_key) : key, ch.instance).catch(() => undefined);
    }
    await ctx.admin.from("whatsapp_channels").update({ active: false, status: "desconectado", updated_at: new Date().toISOString() }).eq("id", ch.id);
    await ctx.admin.from("audit_logs").insert({ company_id: ctx.companyId, profile_id: ctx.userId, table_name: "whatsapp_channels", record_id: ch.id, action: "DISCONNECT", new_data: { name: ch.name } });
    revalidatePath("/atendimento/canais");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export type ChannelMessage = { id: string; direction: "inbound" | "outbound"; author: string | null; body: string; at: string; status: string | null; contact: string; conversationId: string };

/** Últimas mensagens de um número (para conferir se está recebendo e enviando). Respeita o acesso de quem vê. */
export async function channelRecentMessages(id: string): Promise<Result<{ messages: ChannelMessage[] }>> {
  try {
    if (!z.uuid().safeParse(id).success) return { error: "Número inválido." };
    const ctx = await context();
    const { data, error } = await ctx.db.from("messages")
      .select("id,direction,author,body,sent_at,delivery_status,conversation_id,conversation:conversations!inner(channel_id,contact_name,phone)")
      .eq("company_id", ctx.companyId).eq("conversation.channel_id", id)
      .order("sent_at", { ascending: false }).limit(12);
    if (error) return { error: error.message };
    type Row = { id: string; direction: string; author: string | null; body: string | null; sent_at: string; delivery_status: string | null; conversation_id: string; conversation: { contact_name: string | null; phone: string | null } | Array<{ contact_name: string | null; phone: string | null }> | null };
    const messages = ((data ?? []) as unknown as Row[]).map((m) => {
      const c = Array.isArray(m.conversation) ? m.conversation[0] : m.conversation;
      return { id: m.id, direction: m.direction === "outbound" ? "outbound" as const : "inbound" as const, author: m.author, body: (m.body ?? "").replace(/^\*[^*\n]{1,40}:\*\s*\n?/, "").slice(0, 140), at: m.sent_at, status: m.delivery_status, contact: c?.contact_name || c?.phone || "Contato", conversationId: m.conversation_id };
    });
    return { ok: true, messages };
  } catch (e) { return fail(e); }
}
