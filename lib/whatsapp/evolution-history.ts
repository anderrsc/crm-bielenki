// Importa para o Atendimento o histórico que a Evolution já guardou (sincronizado do celular).
// Vai página por página (mais nova primeiro); reimportar não duplica (external_id).
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeExternalUrl } from "@/lib/safe-url";
import { getOrCreateConversation } from "@/lib/whatsapp/inbox-store";
import { cleanContactName, phoneKey } from "@/lib/whatsapp/phone";
import { evolutionContact, evolutionMessageText } from "@/lib/whatsapp/message-text";

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

/** Recuperação curta para a abertura/atualização do Atendimento; nunca executa a IA. */
export async function syncRecentEvolutionMessages(db: SupabaseClient, companyId: string, base: string, key: string, instance: string, channelId?: string | null, opts: { maxPages?: number } = {}) {
  // Recupera da mais nova para a mais antiga até chegar no que o CRM já tem: depois de
  // o servidor ficar fora do ar, nada fica para trás (e não lê o histórico inteiro à toa).
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 1, 20));
  let inserted = 0, conversations = 0, pages = 0;
  for (let n = 1; n <= maxPages; n++) {
    const page = await fetchEvolutionMessages(base, key, instance, n);
    const records = page.messages?.records ?? [];
    const r = await importHistoryPage(db, companyId, records, channelId);
    inserted += r.inserted; conversations += r.conversations; pages = n;
    const total = Number(page.messages?.pages ?? 1);
    if (!r.inserted || records.length < HISTORY_PAGE_SIZE || n >= total) break;
  }
  return { inserted, conversations, pages };
}

/** Mensagem clara para os erros mais comuns do servidor do WhatsApp. */
export function evolutionErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/HTTP 401|HTTP 403/.test(msg)) return "A chave da Evolution está errada. Cole de novo a chave (AUTHENTICATION_API_KEY) na Central de IA e salve.";
  if (/HTTP 404/.test(msg)) return "O número não existe mais no servidor do WhatsApp. Conecte de novo lendo o QR.";
  if (/fetch failed|ECONNREFUSED|timeout|aborted|ENOTFOUND/i.test(msg)) return "O servidor do WhatsApp não respondeu. Confira se o PC/servidor da Evolution está ligado e com internet.";
  return msg;
}

/** Grava uma página de mensagens. Devolve quantas eram novas e quantas conversas tocou. */
export async function importHistoryPage(db: SupabaseClient, companyId: string, records: EvoRecord[], channelId?: string | null) {
  type Row = { phone: string; external_id: string; direction: "inbound" | "outbound"; author: string; sender_name: string | null; body: string; sent_at: string; contact: string | null };
  const rows: Row[] = [];
  // Contas "@lid" sem numero: usa a ligacao lid -> telefone ja conhecida, senao fica com o lid.
  const links = new Map<string, string>();
  const lidPhones = new Map<string, string>();
  const lids = [...new Set(records.map((r) => evolutionContact(r.key)?.lid).filter((v): v is string => !!v))];
  for (let i = 0; i < lids.length; i += 200) {
    const { data } = await db.from("whatsapp_lid_map").select("lid,phone").eq("company_id", companyId).in("lid", lids.slice(i, i + 200));
    for (const m of data ?? []) lidPhones.set(m.lid as string, m.phone as string);
  }
  for (const r of records) {
    const contact = evolutionContact(r.key);
    if (contact?.lid && contact.phone) links.set(contact.lid, contact.phone);
    const phone = contact?.phone ?? (contact?.lid ? lidPhones.get(contact.lid) ?? contact.lid : null);
    const id = typeof r.key?.id === "string" ? r.key.id : "";
    const { text } = evolutionMessageText(r.message);
    const ts = Number(r.messageTimestamp);
    if (!phone || !id || !text || !Number.isFinite(ts) || ts <= 0) continue;
    const fromMe = r.key?.fromMe === true;
    rows.push({
      phone, external_id: id, body: text, sent_at: new Date(ts * 1000).toISOString(),
      direction: fromMe ? "outbound" : "inbound",
      author: fromMe ? "equipe" : "cliente",
      sender_name: fromMe ? (text.match(SIGNATURE)?.[1]?.trim() || "Equipe (celular)") : cleanContactName(r.pushName),
      contact: fromMe ? null : cleanContactName(r.pushName),
    });
  }
  // Lid com numero descoberto nesta pagina: registra e junta a conversa que estava so com o lid.
  for (const [lid, phone] of links) {
    if (lidPhones.get(lid) !== phone) await db.rpc("link_whatsapp_lid", { p_company: companyId, p_lid: lid, p_phone: phone }).then(() => undefined, () => undefined);
  }
  if (!rows.length) return { inserted: 0, conversations: 0 };

  // Já importadas não duplicam; corrige a data dos ecos antigos gravados ao reconectar.
  const known = new Set<string>();
  const corrected = new Map<string, string>();
  const ids = rows.map((r) => r.external_id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("messages").select("id,external_id,conversation_id,direction,sent_at").eq("company_id", companyId).in("external_id", ids.slice(i, i + 200));
    if (error) throw new Error(`Histórico não consultado: ${error.message}`);
    for (const m of data ?? []) {
      known.add(m.external_id as string);
      const original = rows.find((r) => r.external_id === m.external_id);
      if (original?.direction === "outbound" && m.direction === "outbound" && m.sent_at && new Date(m.sent_at).getTime() !== new Date(original.sent_at).getTime()) {
        const { error: correctionError } = await db.from("messages").update({ sent_at: original.sent_at })
          .eq("company_id", companyId).eq("id", m.id).eq("sent_at", m.sent_at);
        if (correctionError) throw new Error(`Data da mensagem não corrigida: ${correctionError.message}`);
        corrected.set(original.phone, m.conversation_id as string);
      }
    }
  }
  const fresh = rows.filter((r) => !known.has(r.external_id));
  if (!fresh.length && !corrected.size) return { inserted: 0, conversations: 0 };

  // Uma conversa por telefone; as que já existiam no WhatsApp são da equipe (a Ana não entra).
  const convByPhone = new Map<string, string>(corrected);
  for (const phone of new Set(fresh.map((r) => r.phone))) {
    const contact = fresh.find((r) => r.phone === phone && r.contact)?.contact ?? null;
    const conv = await getOrCreateConversation(db, companyId, phone, contact, { aiPaused: true, channelId });
    convByPhone.set(phone, conv.id);
  }

  // Envio do CRM/Lia que ficou sem confirmação (tempo esgotado): o eco que a reconciliação traz
  // confirma aquela mensagem, em vez de entrar como uma segunda igual na tela.
  const confirmed = new Set<string>();
  for (const [phone, convId] of convByPhone) {
    const echoes = fresh.filter((r) => r.phone === phone && r.direction === "outbound");
    if (!echoes.length) continue;
    const { data: pending, error: pendingError } = await db.from("messages").select("id,body,sent_at")
      .eq("company_id", companyId).eq("conversation_id", convId).eq("direction", "outbound").is("external_id", null)
      .in("delivery_status", ["enviando", "desconhecido"]);
    if (pendingError) throw new Error(`Envios sem confirmação não consultados: ${pendingError.message}`);
    const open = [...(pending ?? [])] as Array<{ id: string; body: string; sent_at: string }>;
    for (const echo of echoes) {
      const i = open.findIndex((m) => m.body === echo.body && Math.abs(Date.parse(m.sent_at) - Date.parse(echo.sent_at)) <= 15 * 60_000);
      if (i < 0) continue;
      const [match] = open.splice(i, 1);
      const { error: confirmError } = await db.from("messages").update({ external_id: echo.external_id, delivery_status: "enviada", error_message: null })
        .eq("company_id", companyId).eq("id", match.id).is("external_id", null);
      if (confirmError) throw new Error(`Envio não confirmado: ${confirmError.message}`);
      confirmed.add(echo.external_id);
    }
  }

  // Recebidas que entraram agora, por conversa: contam como não lidas se ainda não foram vistas.
  const recovered = new Map<string, string[]>();
  const counted = (row: { conversation_id?: string; direction: string; sent_at: string }) => {
    if (row.direction !== "inbound" || !row.conversation_id) return;
    recovered.set(row.conversation_id, [...(recovered.get(row.conversation_id) ?? []), row.sent_at]);
  };
  const toInsert = fresh.filter((r) => !confirmed.has(r.external_id));
  for (let i = 0; i < toInsert.length; i += 200) {
    const rows = toInsert.slice(i, i + 200).map((r) => ({
      company_id: companyId, conversation_id: convByPhone.get(r.phone), direction: r.direction, author: r.author,
      sender_name: r.sender_name, body: r.body, external_id: r.external_id, sent_at: r.sent_at, delivery_status: r.direction === "outbound" ? "enviada" : null,
    }));
    const { error } = await db.from("messages").insert(rows);
    // Uma repetida recusava o lote inteiro: grava uma a uma, pulando so as repetidas.
    if (error?.code === "23505") {
      for (const row of rows) {
        const { error: one } = await db.from("messages").insert(row);
        if (one && one.code !== "23505") throw new Error(`Mensagens não gravadas: ${one.message}`);
        if (!one) counted(row);
      }
    } else if (error) throw new Error(`Mensagens não gravadas: ${error.message}`);
    else rows.forEach(counted);
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
      ...(!cleanContactName(conv?.contact_name) && contact ? { contact_name: contact } : {}),
    }).eq("id", convId);
    const ats = recovered.get(convId);
    if (ats?.length) {
      const { error: unreadError } = await db.rpc("inbox_count_recovered", { p_conversation: convId, p_company: companyId, p_ats: ats });
      if (unreadError) throw new Error(`Não lidas não atualizadas: ${unreadError.message}`);
    }
  }
  return { inserted: toInsert.length, conversations: convByPhone.size };
}

/**
 * Nomes salvos na agenda do celular (a Evolution guarda em findContacts).
 * Passa por cima do nome de perfil; nome que é só número vira o telefone formatado na tela.
 */
export async function syncAgendaNames(db: SupabaseClient, companyId: string, base: string, apiKey: string, instance: string) {
  const url = safeExternalUrl(base);
  if (!url) throw new Error("Endereço da Evolution inválido.");
  const response = await fetch(`${url}/chat/findContacts/${encodeURIComponent(instance)}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(25_000),
    headers: { apikey: apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ where: {} }),
  });
  if (!response.ok) throw new Error(`Evolution HTTP ${response.status} ao ler a agenda.`);
  const contacts = await response.json() as Array<{ remoteJid?: string; id?: string; pushName?: string | null; name?: string | null }>;
  const names = agendaNameMap(Array.isArray(contacts) ? contacts : []);
  return applyAgendaNames(db, companyId, names);
}

export function agendaNameMap(contacts: Array<{ remoteJid?: string; id?: string; pushName?: string | null; name?: string | null }>) {
  const names = new Map<string, string>();
  for (const c of contacts) {
    const jid = String(c.remoteJid ?? c.id ?? "");
    if (!jid.endsWith("@s.whatsapp.net")) continue;
    const name = cleanContactName(c.name) ?? cleanContactName(c.pushName);
    if (name) names.set(phoneKey(jid.split("@")[0]), name);
  }
  return names;
}

export async function applyAgendaNames(db: SupabaseClient, companyId: string, names: Map<string, string>) {
  const { data } = await db.from("conversations").select("id,phone,external_id,contact_name").eq("company_id", companyId).eq("channel", "whatsapp");
  const changes: Array<{ id: string; contact_name: string | null }> = [];
  for (const c of (data ?? []) as Array<{ id: string; phone: string | null; external_id: string | null; contact_name: string | null }>) {
    const agenda = names.get(phoneKey(c.phone || c.external_id));
    const next = agenda ?? cleanContactName(c.contact_name);
    if (next !== c.contact_name) changes.push({ id: c.id, contact_name: next });
  }
  for (let i = 0; i < changes.length; i += 25) {
    await Promise.all(changes.slice(i, i + 25).map((ch) => db.from("conversations").update({ contact_name: ch.contact_name }).eq("id", ch.id)));
  }
  return changes.length;
}
