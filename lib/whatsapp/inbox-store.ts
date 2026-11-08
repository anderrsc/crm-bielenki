// Grava conversas e mensagens do WhatsApp para a tela de Atendimento.
// Funciona com o cliente do Supabase do webhook (service role) ou do usuário.
import type { SupabaseClient } from "@supabase/supabase-js";
import { digitsOnly, samePhone } from "@/lib/whatsapp/phone";

export type MessageAuthor = "cliente" | "ana" | "equipe" | "automacao";
export type InboxConversation = { id: string; client_id: string | null; ai_paused: boolean; unread_count: number };

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

export async function getOrCreateConversation(db: SupabaseClient, companyId: string, phone: string, contactName?: string | null): Promise<InboxConversation> {
  const { data: found } = await db.from("conversations")
    .select("id,client_id,ai_paused,unread_count")
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
    return { id: found.id, client_id: found.client_id, ai_paused: !!found.ai_paused, unread_count: found.unread_count ?? 0 };
  }
  const client = await findClientByPhone(db, companyId, phone);
  const { data: created, error } = await db.from("conversations").insert({
    company_id: companyId, channel: "whatsapp", external_id: phone, phone,
    contact_name: contactName || null, client_id: client?.id ?? null, status: "aberta",
  }).select("id,client_id,ai_paused,unread_count").single();
  if (error || !created) throw new Error(`Conversa não criada: ${error?.message}`);
  return { id: created.id, client_id: created.client_id, ai_paused: !!created.ai_paused, unread_count: 0 };
}

/** Mensagem do cliente. Devolve null se já tinha sido gravada (reenvio do provedor). */
export async function recordInbound(db: SupabaseClient, p: {
  companyId: string; phone: string; contactName?: string | null; body: string; externalId?: string | null; at?: string;
}): Promise<InboxConversation | null> {
  const conversation = await getOrCreateConversation(db, p.companyId, p.phone, p.contactName);
  const at = p.at ?? new Date().toISOString();
  const { error } = await db.from("messages").insert({
    company_id: p.companyId, conversation_id: conversation.id, direction: "inbound", author: "cliente",
    sender_name: p.contactName || null, body: p.body, external_id: p.externalId || null, sent_at: at,
  });
  if (error?.code === "23505") return null;
  if (error) throw new Error(`Mensagem não gravada: ${error.message}`);
  await db.from("conversations").update({
    last_message_at: at, last_inbound_at: at, last_message_preview: preview(p.body),
    unread_count: conversation.unread_count + 1, status: "aberta", updated_at: at,
    ...(p.contactName ? { contact_name: p.contactName } : {}),
  }).eq("id", conversation.id);
  conversation.unread_count += 1;
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
