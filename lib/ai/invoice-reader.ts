// Lê nota fiscal (PDF ou foto do DANFE) com IA e devolve os dados para pré-preencher
// a Nova compra. Nada é salvo aqui: a pessoa confere e cadastra.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const INVOICE_TYPES = ["Perfil", "Acessório", "Componentes para calhas", "Componentes para esquadrias", "Alumínio bobina", "Cano", "Material elétrico/eletrônico", "Outro"] as const;

const num = z.preprocess((v) => {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const s = v.replace(/[R$\s]/g, "");
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}, z.number().nullable());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null);

export const invoiceSchema = z.object({
  fornecedor: z.object({ nome: z.string().nullable().catch(null), cnpj: z.string().nullable().catch(null) }).catch({ nome: null, cnpj: null }),
  numero_nota: z.string().nullable().catch(null),
  data_emissao: date,
  itens: z.array(z.object({
    descricao: z.string().catch(""),
    quantidade: num.catch(null),
    unidade: z.string().nullable().catch(null),
    valor_unitario: num.catch(null),
    valor_total: num.catch(null),
    tipo: z.string().nullable().catch(null),
  })).catch([]),
  valor_total: num.catch(null),
  vencimentos: z.array(z.object({ data: date, valor: num.catch(null) })).catch([]),
});
export type InvoiceData = z.infer<typeof invoiceSchema>;

export type InvoiceItem = { category: string; description: string; quantity: number; unit_price: number };

/** Itens prontos para o formulário: tipo válido, quantidade e unitário coerentes. */
export function invoiceItems(data: InvoiceData): InvoiceItem[] {
  return data.itens.filter((i) => i.descricao.trim()).map((i) => {
    const qty = i.quantidade && i.quantidade > 0 ? i.quantidade : 1;
    const unit = i.valor_unitario && i.valor_unitario >= 0 ? i.valor_unitario : i.valor_total ? i.valor_total / qty : 0;
    const tipo = (INVOICE_TYPES as readonly string[]).includes(i.tipo ?? "") ? i.tipo! : guessType(i.descricao);
    return { category: tipo, description: i.descricao.trim().slice(0, 300), quantity: Math.round(qty * 1000) / 1000, unit_price: Math.round(unit * 10000) / 10000 };
  });
}

export function guessType(desc: string): string {
  const d = desc.toLowerCase();
  if (/bobina/.test(d)) return "Alumínio bobina";
  if (/\bperfil|\bperf\b/.test(d)) return "Perfil";
  if (/\bcano|\btubo|\bpvc/.test(d)) return "Cano";
  if (/calha|rufo|condutor|pingadeira/.test(d)) return "Componentes para calhas";
  if (/esquadr|roldana|fecho|puxador|escova|vidro/.test(d)) return "Componentes para esquadrias";
  if (/motor|fio|cabo|eletr|sensor|controle/.test(d)) return "Material elétrico/eletrônico";
  if (/parafuso|rebite|silicone|veda|acess|bucha/.test(d)) return "Acessório";
  return "Outro";
}

export const onlyDigits = (s?: string | null) => (s ?? "").replace(/\D/g, "");

const PROMPT = `Você lê notas fiscais brasileiras (DANFE/NF-e) de compras de uma fábrica de calhas e esquadrias de alumínio.
Extraia os dados e responda SOMENTE um JSON neste formato:
{"fornecedor":{"nome":string|null,"cnpj":string|null},"numero_nota":string|null,"data_emissao":"AAAA-MM-DD"|null,
"itens":[{"descricao":string,"quantidade":number,"unidade":string|null,"valor_unitario":number,"valor_total":number,"tipo":string}],
"valor_total":number|null,"vencimentos":[{"data":"AAAA-MM-DD","valor":number}]}
Regras: o fornecedor é o EMITENTE da nota (não o destinatário). Use ponto como separador decimal. Liste TODOS os itens da tabela de produtos, na ordem.
"tipo" deve ser exatamente um de: ${INVOICE_TYPES.join(", ")}. "vencimentos" vem das duplicatas/fatura (vazio se não houver).
Se algo não estiver legível, use null. Não invente itens.`;

function parseInvoiceJson(text: string): InvoiceData {
  let parsed: unknown;
  try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "") || "{}"); } catch { throw new Error("A IA respondeu em formato inesperado. Tente outra foto."); }
  return invoiceSchema.parse(parsed);
}

/** Claude Haiku 5.5: lê PDF e imagem direto; o mais barato por nota. */
export async function readInvoiceWithClaude(file: { name: string; type: string; base64: string }, apiKey: string): Promise<InvoiceData> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000 });
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
    if (response.stop_reason === "refusal") throw new Error("A IA não conseguiu ler esta nota.");
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return parseInvoiceJson(text.trim().replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error("Chave da Anthropic inválida. Confira na Central de IA.");
    if (error instanceof Anthropic.RateLimitError) throw new Error("Limite da Anthropic atingido. Tente de novo em alguns minutos.");
    if (error instanceof Anthropic.APIError) throw new Error(`A IA não conseguiu ler a nota (${error.status ?? "erro"}).`);
    throw error;
  }
}

/** Google Gemini: lê PDF e imagem direto e é bem mais barato que a OpenAI. */
export async function readInvoiceWithGemini(file: { name: string; type: string; base64: string }, apiKey: string): Promise<InvoiceData> {
  const send = (model: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: PROMPT }, { inline_data: { mime_type: file.type, data: file.base64 } }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8000 },
    }),
  });
  let response = await send("gemini-flash-lite-latest");
  if (response.status === 404) response = await send("gemini-flash-latest");
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    if (response.status === 400 && /API key/i.test(text) || response.status === 403) throw new Error("Chave do Gemini inválida. Confira na Central de IA.");
    if (response.status === 429) throw new Error("Limite do Gemini atingido. Tente de novo em alguns minutos.");
    throw new Error(`A IA não conseguiu ler a nota (${response.status}). ${text}`);
  }
  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  return parseInvoiceJson(text);
}

export async function readInvoiceWithAi(file: { name: string; type: string; base64: string }, apiKey: string, model = "gpt-4o"): Promise<InvoiceData> {
  const content: unknown[] = [{ type: "text", text: PROMPT }];
  if (file.type === "application/pdf") content.push({ type: "file", file: { filename: file.name || "nota.pdf", file_data: `data:application/pdf;base64,${file.base64}` } });
  else content.push({ type: "image_url", image_url: { url: `data:${file.type};base64,${file.base64}`, detail: "high" } });
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 4000, response_format: { type: "json_object" }, messages: [{ role: "user", content }] }),
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    if (response.status === 401) throw new Error("Chave da OpenAI inválida. Confira na Central de IA.");
    if (response.status === 429) throw new Error("Limite da OpenAI atingido. Tente de novo em alguns minutos.");
    throw new Error(`A IA não conseguiu ler a nota (${response.status}). ${text}`);
  }
  const data = await response.json();
  return parseInvoiceJson(data.choices?.[0]?.message?.content ?? "{}");
}
