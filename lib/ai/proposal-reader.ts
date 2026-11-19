// Reserva para propostas de esquadria que não dão para ler pelo texto (PDF escaneado,
// foto ou outro layout): a IA devolve os mesmos campos do leitor do WVetro.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { WvetroProposal } from "@/lib/wvetro-proposal";

const num = z.preprocess((v) => {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const s = v.replace(/[R$\s]/g, "");
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}, z.number().nullable());
const str = z.string().nullable().catch(null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null);

const schema = z.object({
  numero: str, emissao: date, validade: date, vendedor: str,
  cliente: z.object({ nome: str, telefone: str, celular: str, email: str, endereco: str, bairro: str, cidade: str, uf: str, cep: str, documento: str })
    .catch({ nome: null, telefone: null, celular: null, email: null, endereco: null, bairro: null, cidade: null, uf: null, cep: null, documento: null }),
  itens: z.array(z.object({
    ambiente: z.string().catch(""), produto: z.string().catch(""), linha: z.string().catch(""),
    corEsquadria: z.string().catch(""), corAcessorio: z.string().catch(""), vidro: z.string().catch(""),
    quantidade: num.catch(null), largura: num.catch(null), altura: num.catch(null), metragem: num.catch(null),
    observacoes: z.string().catch(""), variaveis: z.array(z.string()).catch([]),
  })).catch([]),
  total: num.catch(null),
  observacoes: z.array(z.string()).catch([]),
});

const PROMPT = `Você lê propostas de esquadrias de alumínio (geralmente impressas pelo sistema WVetro) de uma empresa de calhas e esquadrias.
Responda SOMENTE um JSON neste formato:
{"numero":string|null,"emissao":"AAAA-MM-DD"|null,"validade":"AAAA-MM-DD"|null,"vendedor":string|null,
"cliente":{"nome":string|null,"telefone":string|null,"celular":string|null,"email":string|null,"endereco":string|null,"bairro":string|null,"cidade":string|null,"uf":string|null,"cep":string|null,"documento":string|null},
"itens":[{"ambiente":string,"produto":string,"linha":string,"corEsquadria":string,"corAcessorio":string,"vidro":string,"quantidade":number,"largura":number,"altura":number,"metragem":number|null,"observacoes":string,"variaveis":[string]}],
"total":number|null,"observacoes":[string]}
Regras: o cliente é quem recebe a proposta (não a empresa emissora). Largura e altura em milímetros, como impresso.
Liste TODOS os itens, na ordem. Use ponto como separador decimal. "observacoes" do item é o texto de "Observações deste item";
"observacoes" geral são as linhas do quadro de observações do final. Se algo não estiver legível, use null ou "". Não invente itens nem valores.`;

function toProposal(text: string): WvetroProposal {
  let raw: unknown;
  try { raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "").replace(/^[^{]*/, "").replace(/[^}]*$/, "") || "{}"); }
  catch { throw new Error("A IA respondeu em formato inesperado. Tente de novo."); }
  const d = schema.parse(raw);
  return {
    ...d,
    itens: d.itens.map((i, index) => ({
      n: index + 1, ambiente: i.ambiente, produto: i.produto, linha: i.linha, corEsquadria: i.corEsquadria, corAcessorio: i.corAcessorio,
      vidro: i.vidro, quantidade: i.quantidade ?? 0, largura: i.largura ?? 0, altura: i.altura ?? 0, metragem: i.metragem,
      observacoes: i.observacoes, variaveis: i.variaveis,
    })).filter((i) => i.produto.trim() && i.quantidade > 0),
  };
}

export async function readProposalWithClaude(file: { type: string; base64: string }, apiKey: string): Promise<WvetroProposal> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 });
  const media: Anthropic.ContentBlockParam = file.type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.base64 } }
    : { type: "image", source: { type: "base64", media_type: file.type as "image/jpeg" | "image/png" | "image/webp", data: file.base64 } };
  try {
    const response = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: [media, { type: "text", text: PROMPT }] }],
    });
    if (response.stop_reason === "refusal") throw new Error("A IA não conseguiu ler esta proposta.");
    return toProposal(response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(""));
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error("Chave da Anthropic inválida. Confira na Central de IA.");
    if (error instanceof Anthropic.RateLimitError) throw new Error("Limite da Anthropic atingido. Tente de novo em alguns minutos.");
    if (error instanceof Anthropic.APIError) throw new Error(`A IA não conseguiu ler a proposta (${error.status ?? "erro"}).`);
    throw error;
  }
}

export async function readProposalWithGemini(file: { type: string; base64: string }, apiKey: string): Promise<WvetroProposal> {
  const send = (model: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: PROMPT }, { inline_data: { mime_type: file.type, data: file.base64 } }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 12000 },
    }),
  });
  let response = await send("gemini-flash-latest");
  if (response.status === 404) response = await send("gemini-flash-lite-latest");
  if (!response.ok) {
    if (response.status === 403 || (response.status === 400 && /API key/i.test(await response.clone().text()))) throw new Error("Chave do Gemini inválida. Confira na Central de IA.");
    if (response.status === 429) throw new Error("Limite do Gemini atingido. Tente de novo em alguns minutos.");
    throw new Error(`A IA não conseguiu ler a proposta (${response.status}).`);
  }
  const data = await response.json();
  return toProposal((data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join(""));
}
