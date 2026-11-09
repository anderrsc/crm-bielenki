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
  if (get("buttonsResponseMessage")) return { text: str(get("buttonsResponseMessage")!.selectedDisplayText), media: null };
  if (get("listResponseMessage")) return { text: str(get("listResponseMessage")!.title), media: null };
  if (get("ephemeralMessage")) return evolutionMessageText((get("ephemeralMessage")!.message ?? {}) as Record<string, unknown>);
  if (get("viewOnceMessageV2")) return evolutionMessageText((get("viewOnceMessageV2")!.message ?? {}) as Record<string, unknown>);
  return { text: "", media: null };
}

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
