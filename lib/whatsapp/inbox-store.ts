// Grava conversas e mensagens do WhatsApp para a tela de Atendimento.
// Funciona com o cliente do Supabase do webhook (service role) ou do usuário.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanContactName, digitsOnly, phoneKey, samePhone } from "@/lib/whatsapp/phone";

export type MessageAuthor = "cliente" | "ana" | "equipe" | "automacao";
export type InboxConversation = { id: string; client_id: string | null; ai_paused: boolean; unread_count: number; contact_name?: string | null; generation?: string };

const preview = (body: string) => body.replace(/^\*[^*\n]{1,40}:\*\s*\n?/, "").replace(/\s+/g, " ").trim().slice(0, 120);

/** Cliente do cadastro com o mesmo telefone (DDD + 8 últimos dígitos). */
export async function findClientByPhone(db: SupabaseClient, companyId: string, phone: string): Promise<{ id: string; name: string } | null> {
  const last4 = digitsOnly(phone).slice(-4);
  if (last4.length < 4) return null;
  const { data } = await db.from("clients")
    .select("id,name,phone,whatsapp")
    .eq("company_id", companyId)
    .or(`phone.ilike.%${last4},whatsapp.ilike.%${last4}`)
    .limit(50);
  const hit = (data ?? []).find((c: { phone?: string | null; whatsapp?: string | null }) => samePhone(c.phone, phone) || samePhone(c.whatsapp, phone));
  return hit ? { id: hit.id, name: hit.name } : null;
}

/**
 * Liga sozinho as conversas sem cliente ao cadastro com o mesmo telefone/WhatsApp.
 * Roda ao abrir o Atendimento: cliente cadastrado ou editado depois já aparece ligado.
 */
export async function autoLinkClients(db: SupabaseClient, companyId: string): Promise<number> {
  const [{ data: convs }, { data: clients }] = await Promise.all([
    db.from("conversations").select("id,phone,external_id").eq("company_id", companyId).eq("channel", "whatsapp").is("client_id", null).limit(3000),
    db.from("clients").select("id,phone,whatsapp").eq("company_id", companyId).limit(10000),
  ]);
  if (!convs?.length || !clients?.length) return 0;
  const byKey = new Map<string, string>();
  for (const c of clients as Array<{ id: string; phone: string | null; whatsapp: string | null }>) {
    for (const v of [c.whatsapp, c.phone]) {
      const k = phoneKey(v);
      if (k.length >= 10 && !byKey.has(k)) byKey.set(k, c.id);
    }
  }
  const links = (convs as Array<{ id: string; phone: string | null; external_id: string | null }>)
    .map((c) => ({ id: c.id, client: byKey.get(phoneKey(c.phone || c.external_id)) }))
    .filter((l): l is { id: string; client: string } => !!l.client);
  for (let i = 0; i < links.length; i += 25) {
    await Promise.all(links.slice(i, i + 25).map((l) => db.from("conversations").update({ client_id: l.client }).eq("id", l.id).is("client_id", null)));
  }
  return links.length;
}

export async function getOrCreateConversation(db: SupabaseClient, companyId: string, phone: string, contactName?: string | null, opts: { aiPaused?: boolean } = {}): Promise<InboxConversation> {
  const { data: found } = await db.from("conversations")
    .select("id,client_id,ai_paused,unread_count,contact_name")
    .eq("company_id", companyId).eq("channel", "whatsapp").eq("external_id", phone)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (found) {
    if (!found.client_id) {
      const client = await findClientByPhone(db, companyId, phone);
      if (client) {
        await db.from("conversations").update({ client_id: client.id }).eq("id", found.id);
        found.client_id = client.id;
      }
    }
    return { id: found.id, client_id: found.client_id, ai_paused: !!found.ai_paused, unread_count: found.unread_count ?? 0, contact_name: cleanContactName(found.contact_name) };
  }
  const client = await findClientByPhone(db, companyId, phone);
  const { data: created, error } = await db.from("conversations").insert({
    company_id: companyId, channel: "whatsapp", external_id: phone, phone,
    contact_name: cleanContactName(contactName), client_id: client?.id ?? null, status: "aberta",
    ...(opts.aiPaused ? { ai_paused: true } : {}),
  }).select("id,client_id,ai_paused,unread_count,contact_name").single();
  if (error || !created) throw new Error(`Conversa não criada: ${error?.message}`);
  return { id: created.id, client_id: created.client_id, ai_paused: !!created.ai_paused, unread_count: 0, contact_name: cleanContactName(created.contact_name) };
}

/** Mensagem do cliente. Devolve null se já tinha sido gravada (reenvio do provedor). */
export async function recordInbound(db: SupabaseClient, p: {
  companyId: string; phone: string; contactName?: string | null; body: string; externalId?: string | null; at?: string; historical?: boolean;
}): Promise<InboxConversation | null> {
  const conversation = await getOrCreateConversation(db, p.companyId, p.phone, p.contactName);
  const at = p.at ?? new Date().toISOString();
  const { error } = await db.from("messages").insert({
    company_id: p.companyId, conversation_id: conversation.id, direction: "inbound", author: "cliente",
    sender_name: p.contactName || null, body: p.body, external_id: p.externalId || null, sent_at: at,
  });
  if (error?.code === "23505") return null;
  if (error) throw new Error(`Mensagem não gravada: ${error.message}`);
  const generation = crypto.randomUUID();
  const { error: counterError } = await db.rpc("inbox_receive", {
    p_id: conversation.id, p_company: p.companyId, p_at: at, p_preview: preview(p.body),
    p_generation: generation, p_historical: !!p.historical,
  });
  if (counterError) throw new Error(`Contagem não atualizada: ${counterError.message}`);
  conversation.generation = generation;
  conversation.unread_count += p.historical ? 0 : 1;
  return conversation;
}

export async function recordOutbound(db: SupabaseClient, p: {
  companyId: string; conversationId: string; body: string; author: MessageAuthor; senderName?: string | null;
  sentBy?: string | null; externalId?: string | null; deliveryStatus?: "enviada" | "falhou"; error?: string | null;
}) {
  const at = new Date().toISOString();
  const { data, error } = await db.from("messages").insert({
    company_id: p.companyId, conversation_id: p.conversationId, direction: "outbound", author: p.author,
    sender_name: p.senderName || null, sent_by: p.sentBy || null, body: p.body, external_id: p.externalId || null,
    delivery_status: p.deliveryStatus ?? "enviada", error_message: p.error || null, sent_at: at,
  }).select("id").single();
  if (error) throw new Error(`Mensagem não gravada: ${error.message}`);
  await db.from("conversations").update({ last_message_at: at, last_message_preview: preview(p.body), updated_at: at }).eq("id", p.conversationId);
  return data.id as string;
}
