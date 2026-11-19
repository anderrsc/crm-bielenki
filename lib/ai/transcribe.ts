// Transcrição de áudio do WhatsApp (Google Gemini). Só no servidor: a chave nunca vai ao navegador.
// Se falhar, devolve ok:false com o motivo; quem chama NÃO pode fingir que ouviu o áudio.

export type Transcription = { ok: true; text: string } | { ok: false; reason: "sem_chave" | "chave_invalida" | "limite" | "vazio" | "falha" };

const PROMPT = "Transcreva fielmente este áudio de WhatsApp em português do Brasil. Devolva somente o texto falado, sem comentários, sem aspas e sem rótulos. Se não houver fala compreensível, devolva exatamente: [inaudível]";

/** WhatsApp envia nota de voz em OGG/Opus; o Gemini aceita "audio/ogg". */
export function audioMime(mimetype: string | null | undefined): string {
  const m = (mimetype ?? "").split(";")[0].trim().toLowerCase();
  return /^audio\/(ogg|mpeg|mp3|wav|aac|flac|aiff|mp4|webm)$/.test(m) ? (m === "audio/mp3" ? "audio/mpeg" : m === "audio/mp4" || m === "audio/webm" ? "audio/aac" : m) : "audio/ogg";
}

export async function transcribeAudio(audio: { base64: string; mimetype?: string | null }, apiKey: string | null | undefined, fetcher: typeof fetch = fetch): Promise<Transcription> {
  if (!apiKey) return { ok: false, reason: "sem_chave" };
  // ~25 MB de base64 é o limite prático de envio direto; nota de voz comum tem poucos KB.
  if (audio.base64.length > 25_000_000) return { ok: false, reason: "falha" };
  const send = (model: string) => fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", signal: AbortSignal.timeout(25_000),
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: PROMPT }, { inline_data: { mime_type: audioMime(audio.mimetype), data: audio.base64 } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 1500 },
    }),
  });
  try {
    let response = await send("gemini-flash-lite-latest");
    if (response.status === 404) response = await send("gemini-flash-latest");
    if (response.status === 403 || (response.status === 400 && /API key/i.test(await response.clone().text()))) return { ok: false, reason: "chave_invalida" };
    if (response.status === 429) return { ok: false, reason: "limite" };
    if (!response.ok) return { ok: false, reason: "falha" };
    const data = await response.json();
    const text = ((data.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string }>).map((p) => p.text ?? "").join("").trim();
    if (!text || /^\[?inaud[ií]vel\]?\.?$/i.test(text)) return { ok: false, reason: "vazio" };
    return { ok: true, text: text.slice(0, 2000) };
  } catch { return { ok: false, reason: "falha" }; }
}
