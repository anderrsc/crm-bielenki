import { expect, test, vi } from "vitest";
import { audioMime, transcribeAudio } from "@/lib/ai/transcribe";

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const ok = (text: string) => reply(200, { candidates: [{ content: { parts: [{ text }] } }] });

test("transcreve a nota de voz e envia o áudio ao Gemini sem expor a chave na URL", async () => {
  const f = ok("Quero um orçamento de calha para a minha casa.");
  const r = await transcribeAudio({ base64: "QUJD", mimetype: "audio/ogg; codecs=opus" }, "chave-teste", f);
  expect(r).toEqual({ ok: true, text: "Quero um orçamento de calha para a minha casa." });
  const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
  expect(url).not.toContain("chave-teste");
  expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("chave-teste");
  expect(JSON.parse(init.body as string).contents[0].parts[1].inline_data.mime_type).toBe("audio/ogg");
});

test("falhas viram motivo claro, nunca texto inventado", async () => {
  expect(await transcribeAudio({ base64: "QUJD" }, null)).toEqual({ ok: false, reason: "sem_chave" });
  expect(await transcribeAudio({ base64: "QUJD" }, "k", reply(403, {}))).toEqual({ ok: false, reason: "chave_invalida" });
  expect(await transcribeAudio({ base64: "QUJD" }, "k", reply(429, {}))).toEqual({ ok: false, reason: "limite" });
  expect(await transcribeAudio({ base64: "QUJD" }, "k", reply(500, {}))).toEqual({ ok: false, reason: "falha" });
  expect(await transcribeAudio({ base64: "QUJD" }, "k", ok("[inaudível]"))).toEqual({ ok: false, reason: "vazio" });
  expect(await transcribeAudio({ base64: "QUJD" }, "k", vi.fn(async () => { throw new Error("rede"); }) as unknown as typeof fetch)).toEqual({ ok: false, reason: "falha" });
});

test("tipo do áudio padroniza para o que o Gemini aceita", () => {
  expect(audioMime("audio/ogg; codecs=opus")).toBe("audio/ogg");
  expect(audioMime("audio/mp3")).toBe("audio/mpeg");
  expect(audioMime(null)).toBe("audio/ogg");
});
