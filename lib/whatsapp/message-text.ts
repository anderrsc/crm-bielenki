// Texto exibível de uma mensagem do WhatsApp no formato da Evolution/Baileys.
// Mídia vira um rótulo ("[áudio]"), com a legenda quando houver.

type Msg = Record<string, unknown> | null | undefined;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function evolutionMessageText(message: Msg): { text: string; media: string | null } {
  const m = (message ?? {}) as Record<string, Record<string, unknown> | string | undefined>;
  const get = (k: string) => (m[k] && typeof m[k] === "object" ? (m[k] as Record<string, unknown>) : null);
  if (str(m.conversation)) return { text: str(m.conversation), media: null };
  if (get("extendedTextMessage")) return { text: str(get("extendedTextMessage")!.text), media: null };
  const withCaption = (label: string, k: string, media: string) => {
    const caption = str(get(k)?.caption);
    return { text: caption ? `[${label}] ${caption}` : `[${label}]`, media };
  };
  if (get("imageMessage")) return withCaption("foto", "imageMessage", "image");
  if (get("videoMessage")) return withCaption("vídeo", "videoMessage", "video");
  if (get("documentMessage")) {
    const name = str(get("documentMessage")!.fileName);
    return { text: `[documento${name ? `: ${name}` : ""}]${str(get("documentMessage")!.caption) ? ` ${str(get("documentMessage")!.caption)}` : ""}`, media: "document" };
  }
  if (get("documentWithCaptionMessage")) {
    const inner = (get("documentWithCaptionMessage")!.message ?? {}) as Record<string, unknown>;
    return evolutionMessageText(inner);
  }
  if (get("audioMessage")) return { text: "[áudio]", media: "audio" };
  if (get("stickerMessage")) return { text: "[figurinha]", media: "sticker" };
  if (get("locationMessage")) return { text: "[localização]", media: "location" };
  if (get("contactMessage")) return { text: `[contato: ${str(get("contactMessage")!.displayName)}]`, media: "contact" };
  // Mensagens de empresas (modelo, botões, lista, interativa): mostra o texto principal.
  const tpl = get("templateMessage");
  if (tpl) {
    const h = (tpl.hydratedTemplate ?? (tpl.hydratedFourRowTemplate as unknown)) as Record<string, unknown> | undefined;
    const t = str(h?.hydratedContentText) || str((tpl.fourRowTemplate as Record<string, unknown> | undefined)?.content);
    if (t) return { text: t, media: null };
  }
  const inter = get("interactiveMessage");
  if (inter) {
    const t = str((inter.body as Record<string, unknown> | undefined)?.text) || str((inter.header as Record<string, unknown> | undefined)?.title);
    if (t) return { text: t, media: null };
  }
  if (get("buttonsMessage")) { const t = str(get("buttonsMessage")!.contentText); if (t) return { text: t, media: null }; }
  if (get("listMessage")) { const t = str(get("listMessage")!.description) || str(get("listMessage")!.title); if (t) return { text: t, media: null }; }
  if (get("templateButtonReplyMessage")) return { text: str(get("templateButtonReplyMessage")!.selectedDisplayText), media: null };
  if (get("buttonsResponseMessage")) return { text: str(get("buttonsResponseMessage")!.selectedDisplayText), media: null };
  if (get("listResponseMessage")) return { text: str(get("listResponseMessage")!.title), media: null };
  if (get("ephemeralMessage")) return evolutionMessageText((get("ephemeralMessage")!.message ?? {}) as Record<string, unknown>);
  if (get("viewOnceMessageV2")) return evolutionMessageText((get("viewOnceMessageV2")!.message ?? {}) as Record<string, unknown>);
  // Envelopes que só embrulham a mensagem real: cada foto de um álbum chega como associatedChildMessage.
  for (const k of ["associatedChildMessage", "viewOnceMessage", "viewOnceMessageV2Extension"]) {
    if (get(k)) return evolutionMessageText((get(k)!.message ?? {}) as Record<string, unknown>);
  }
  return { text: "", media: null };
}

/** Reação (👍) a outra mensagem. emoji vazio = reação removida. */
export function evolutionReaction(message: Msg): { targetId: string; emoji: string } | null {
  const r = (message as Record<string, unknown> | null | undefined)?.reactionMessage as Record<string, unknown> | undefined;
  const key = r?.key as Record<string, unknown> | undefined;
  const targetId = typeof key?.id === "string" ? key.id : "";
  if (!r || !targetId) return null;
  return { targetId, emoji: str(r.text).slice(0, 16) };
}

/** Mensagem que esta responde (citação): id no WhatsApp e um trecho legível. */
export function evolutionQuote(message: Msg, recordContext?: unknown): { id: string; preview: string } | null {
  const m = (message ?? {}) as Record<string, unknown>;
  const contexts: unknown[] = [recordContext];
  for (const v of Object.values(m)) if (v && typeof v === "object") contexts.push((v as Record<string, unknown>).contextInfo);
  for (const c of contexts) {
    const ctx = c as Record<string, unknown> | null | undefined;
    const id = typeof ctx?.stanzaId === "string" ? ctx.stanzaId : "";
    if (!id) continue;
    const quoted = evolutionMessageText(ctx?.quotedMessage as Msg).text.replace(SIGNATURE_PREFIX, "").replace(/\s+/g, " ").trim();
    return { id, preview: quoted.slice(0, 160) };
  }
  return null;
}
const SIGNATURE_PREFIX = /^\*[^*\n]{1,40}:\*\s*/;

/** Número do contato a partir da chave da mensagem (inclui contas "@lid"). Null para grupo/status. */
export function evolutionJidPhone(key: Record<string, unknown> | undefined | null): string | null {
  const jid = str(key?.remoteJid);
  if (!jid || /@g\.us$|@broadcast$|^status@|@newsletter$/.test(jid)) return null;
  if (/@s\.whatsapp\.net$|@c\.us$/.test(jid)) return jid.split("@")[0];
  if (jid.endsWith("@lid")) {
    const alt = [key?.remoteJidAlt, key?.senderPn, key?.participantPn].find((v) => typeof v === "string" && /@s\.whatsapp\.net$/.test(v));
    return alt ? String(alt).split("@")[0] : null;
  }
  return null;
}

/**
 * Contato da mensagem: o telefone quando a Evolution informa, senao o identificador "NNN@lid"
 * (contas novas do WhatsApp chegam assim, muitas vezes sem o numero). Null para grupo/status.
 * lid vem preenchido sempre que a conversa for "@lid", para registrar a ligacao lid -> telefone.
 */
export function evolutionContact(key: Record<string, unknown> | undefined | null): { id: string; phone: string | null; lid: string | null } | null {
  const jid = str(key?.remoteJid);
  if (!jid || /@g\.us$|@broadcast$|^status@|@newsletter$/.test(jid)) return null;
  const phone = evolutionJidPhone(key);
  const lid = /^\d{5,25}@lid$/.test(jid) ? jid : null;
  if (phone) return { id: phone, phone, lid };
  return lid ? { id: lid, phone: null, lid } : null;
}

/** Conversa identificada so pelo "@lid" (sem numero de telefone conhecido). */
export const isLidContact = (value: string | null | undefined) => /@lid$/.test(String(value ?? ""));
