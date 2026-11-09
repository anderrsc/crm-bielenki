// Importa para o Atendimento o histórico que a Evolution já guardou (sincronizado do celular).
// Vai página por página (mais nova primeiro); reimportar não duplica (external_id).
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeExternalUrl } from "@/lib/safe-url";
import { getOrCreateConversation } from "@/lib/whatsapp/inbox-store";
import { evolutionJidPhone, evolutionMessageText } from "@/lib/whatsapp/message-text";

export const HISTORY_PAGE_SIZE = 400;
const SIGNATURE = /^\*([^*\n]{1,40}):\*\s*\n?/;

type EvoRecord = { key?: Record<string, unknown>; pushName?: string | null; message?: Record<string, unknown> | null; messageTimestamp?: number | string };
type EvoPage = { messages?: { total?: number; pages?: number; currentPage?: number; records?: EvoRecord[] } };

export async function fetchEvolutionMessages(base: string, apiKey: string, instance: string, page: number): Promise<EvoPage> {
  const url = safeExternalUrl(base);
  if (!url) throw new Error("Endereço da Evolution inválido.");
  const response = await fetch(`${url}/chat/findMessages/${encodeURIComponent(instance)}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(25_000),
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ where: {}, page, offset: HISTORY_PAGE_SIZE }),
  });
  if (!response.ok) throw new Error(`Evolution HTTP ${response.status} ao ler o histórico.`);
  return response.json();
}

const preview = (body: string) => body.replace(SIGNATURE, "").replace(/\s+/g, " ").trim().slice(0, 120);

/** Grava uma página de mensagens. Devolve quantas eram novas e quantas conversas tocou. */
export async function importHistoryPage(db: SupabaseClient, companyId: string, records: EvoRecord[]) {
  type Row = { phone: string; external_id: string; direction: "inbound" | "outbound"; author: string; sender_name: string | null; body: string; sent_at: string; contact: string | null };
  const rows: Row[] = [];
  for (const r of records) {
    const phone = evolutionJidPhone(r.key);
    const id = typeof r.key?.id === "string" ? r.key.id : "";
    const { text } = evolutionMessageText(r.message);
    const ts = Number(r.messageTimestamp);
    if (!phone || !id || !text || !Number.isFinite(ts) || ts <= 0) continue;
    const fromMe = r.key?.fromMe === true;
    rows.push({
      phone, external_id: id, body: text, sent_at: new Date(ts * 1000).toISOString(),
      direction: fromMe ? "outbound" : "inbound",
      author: fromMe ? "equipe" : "cliente",
      sender_name: fromMe ? (text.match(SIGNATURE)?.[1]?.trim() || "Equipe (celular)") : (r.pushName || null),
      contact: fromMe ? null : (r.pushName || null),
    });
  }
  if (!rows.length) return { inserted: 0, conversations: 0 };

  // Já importadas (ou que chegaram pelo webhook) ficam de fora.
  const known = new Set<string>();
  const ids = rows.map((r) => r.external_id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("messages").select("external_id").eq("company_id", companyId).in("external_id", ids.slice(i, i + 200));
    for (const m of data ?? []) known.add(m.external_id as string);
  }
  const fresh = rows.filter((r) => !known.has(r.external_id));
  if (!fresh.length) return { inserted: 0, conversations: 0 };

  // Uma conversa por telefone; as que já existiam no WhatsApp são da equipe (a Ana não entra).
  const convByPhone = new Map<string, string>();
  for (const phone of new Set(fresh.map((r) => r.phone))) {
    const contact = fresh.find((r) => r.phone === phone && r.contact)?.contact ?? null;
    const conv = await getOrCreateConversation(db, companyId, phone, contact, { aiPaused: true });
    convByPhone.set(phone, conv.id);
  }

  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await db.from("messages").insert(fresh.slice(i, i + 200).map((r) => ({
      company_id: companyId, conversation_id: convByPhone.get(r.phone), direction: r.direction, author: r.author,
      sender_name: r.sender_name, body: r.body, external_id: r.external_id, sent_at: r.sent_at, delivery_status: r.direction === "outbound" ? "enviada" : null,
    })));
    if (error && error.code !== "23505") throw new Error(`Mensagens não gravadas: ${error.message}`);
  }

  // Atualiza o resumo de cada conversa com a mensagem mais recente que ela tem.
  for (const [phone, convId] of convByPhone) {
    const [{ data: last }, { data: lastIn }, { data: conv }] = await Promise.all([
      db.from("messages").select("body,sent_at").eq("conversation_id", convId).order("sent_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("messages").select("sent_at").eq("conversation_id", convId).eq("direction", "inbound").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("conversations").select("contact_name").eq("id", convId).maybeSingle(),
    ]);
    const contact = fresh.find((r) => r.phone === phone && r.contact)?.contact;
    await db.from("conversations").update({
      last_message_at: last?.sent_at ?? null, last_message_preview: last ? preview(last.body) : null,
      last_inbound_at: lastIn?.sent_at ?? null,
      ...(!conv?.contact_name && contact ? { contact_name: contact } : {}),
    }).eq("id", convId);
  }
  return { inserted: fresh.length, conversations: convByPhone.size };
}
