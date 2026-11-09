// Monta o texto das conversas (cliente × equipe) em pedaços que cabem na IA gratuita.
export const LEARN_CHUNKS = 6;
const CHUNK_CHARS = 14000;

type Msg = { conversation_id: string; direction: string; author: string | null; sender_name: string | null; body: string | null; sent_at: string };

export function buildTranscripts(messages: Msg[]): string[] {
  const byConv = new Map<string, Msg[]>();
  for (const m of messages) {
    const list = byConv.get(m.conversation_id) ?? [];
    list.push(m); byConv.set(m.conversation_id, list);
  }
  const blocks: string[] = [];
  for (const list of byConv.values()) {
    // Só conversas em que a equipe respondeu servem de exemplo.
    if (!list.some((m) => m.author === "equipe") || !list.some((m) => m.author === "cliente")) continue;
    const lines = list.sort((a, b) => a.sent_at.localeCompare(b.sent_at)).map((m) => {
      const body = (m.body ?? "").replace(/^\*[^*\n]{1,40}:\*\s*\n?/, "").replace(/\d{4,}[\d\s-]*/g, "#").replace(/\s+/g, " ").trim().slice(0, 300);
      return body ? `${m.author === "equipe" ? "Equipe" : "Cliente"}: ${body}` : "";
    }).filter(Boolean);
    if (lines.length >= 2) blocks.push(lines.join("\n"));
  }
  const chunks: string[] = [];
  let cur = "";
  for (const b of blocks) {
    if (cur && cur.length + b.length > CHUNK_CHARS) { chunks.push(cur); cur = ""; }
    cur += (cur ? "\n\n=== nova conversa ===\n" : "") + b.slice(0, CHUNK_CHARS);
  }
  if (cur) chunks.push(cur);
  return chunks.slice(0, LEARN_CHUNKS);
}
