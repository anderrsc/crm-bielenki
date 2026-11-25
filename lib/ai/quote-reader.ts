// Lê orçamento antigo de calhas (PDF/foto) com IA e devolve itens para pré-preencher o formulário.
// Nada é salvo aqui: a pessoa confere e confirma.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const num = z.preprocess((v) => {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const s = v.replace(/[R$\s]/g, "");
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}, z.number().nonnegative().nullable());

const extractedItemSchema = z.object({
  kind: z.enum(["fabricado", "especial"]).catch("especial"),
  // Fabricated (calhas, rufos, pingadeiras)
  category: z.string().nullable().catch(null),
  product: z.string().nullable().catch(null),
  thickness: z.string().nullable().catch(null),
  cut: z.string().nullable().catch(null),
  color: z.string().nullable().catch(null),
  meters_total: num.catch(null),
  // Special (condutores, acessórios, serviços, itens especiais)
  item_type: z.string().nullable().catch(null),
  special_product: z.string().nullable().catch(null),
  special_unit: z.string().nullable().catch(null),
  quantity: num.catch(1),
  // Common
  value_total: num.catch(0),
});

const quoteSchema = z.object({
  client_name: z.string().nullable().catch(null),
  client_phone: z.string().nullable().catch(null),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  items: z.array(extractedItemSchema).catch([]),
});

export type QuoteData = z.infer<typeof quoteSchema>;
export type ExtractedItem = z.infer<typeof extractedItemSchema>;

const PROMPT = `Você lê orçamentos antigos de uma fábrica de calhas e rufos em alumínio (Marquinhos Calhas).
Extraia os dados e responda SOMENTE um JSON neste formato exato:
{"client_name":string|null,"client_phone":string|null,"valid_until":"AAAA-MM-DD"|null,"items":[...]}

Para cada item do orçamento identifique:
- "kind": "fabricado" para calhas, rufos e pingadeiras; "especial" para acessórios, condutores, serviços e outros
- Para FABRICADOS: "category" (exatamente: "Calhas", "Rufos" ou "Pingadeiras"), "product" (use a lista abaixo), "thickness" (ex: "0.5mm"), "cut" (ex: "350 mm"), "color" (ex: "Aluminio Natural"), "meters_total" (total de metros da linha), "value_total" (valor total da linha)
- Para ESPECIAIS: "item_type" (exatamente: "Condutores", "Acessórios", "Serviços" ou "Itens Especiais"), "special_product" (use a lista abaixo), "special_unit" (ex: "unidade" ou "metro"), "quantity" (quantidade), "value_total" (valor total)

Produtos FABRICADOS aceitos:
  Calhas: "Calha de Beiral", "Calha Platibanda", "Calha Coletora", "Calha Água Furtada"
  Rufos: "Rufo com Pingadeira", "Rufo Chapéu", "Rufo de Acabamento", "Rufo de Cumeeira", "Rufo Sobre Calha", "Rufo para Chaminé"
  Pingadeiras: "Pingadeira", "Pingadeira de Marquise"

Produtos ESPECIAIS aceitos:
  Acessórios: "Tubo Vedante PU MS40"
  Itens Especiais: "Suporte viga U (galpão)", "Chapa Lisa", "Manta asfáltica"

Mapeamentos comuns:
  "CALHA DE BEIRAL", "CALHA BEIRAL" → category "Calhas", product "Calha de Beiral"
  "CALHA PLATIBANDA" → category "Calhas", product "Calha Platibanda"
  "RUFO" (genérico ou de acabamento) → category "Rufos", product "Rufo de Acabamento"
  "RUFO COM PINGADEIRA" → category "Rufos", product "Rufo com Pingadeira"
  "TUBO VEDANTE", "P.U", "PU", "VEDANTE" → item_type "Acessórios", special_product "Tubo Vedante PU MS40"
  "CONDUTOR", "CANO DE CHUVA" → item_type "Condutores"

Formatos:
  Espessuras: "0.5mm", "0.6mm", "0.7mm", "1.0mm" (normalize: "0,5" ou "0.5" vira "0.5mm")
  Cortes C/: extraia o número e adicione " mm" se necessário. "C/350MM" → "350 mm", "C/300" → "300 mm"
  Cores: "Aluminio Natural" (natural/aluminio/sem cor especificada), "Pintura Branco", "Pintura Preto", "Pintura Marrom", "Pintura Cinza"
  Use ponto como separador decimal nos valores numéricos.

Se algo não estiver legível use null. Não invente itens. Mapeie TODOS os itens do orçamento.`;

function parseJson(text: string): QuoteData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "") || "{}");
  } catch {
    throw new Error("A IA respondeu em formato inesperado.");
  }
  return quoteSchema.parse(parsed);
}

export async function readQuoteWithClaude(file: { name: string; type: string; base64: string }, apiKey: string): Promise<QuoteData> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000 });
  const media: Anthropic.ContentBlockParam = file.type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.base64 } }
    : { type: "image", source: { type: "base64", media_type: file.type as "image/jpeg" | "image/png" | "image/webp", data: file.base64 } };
  try {
    const response = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: [media, { type: "text", text: PROMPT }] }],
    });
    if (response.stop_reason === "refusal") throw new Error("A IA não conseguiu ler este orçamento.");
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return parseJson(text.trim().replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error("Chave da Anthropic inválida. Confira na Central de IA.");
    if (error instanceof Anthropic.RateLimitError) throw new Error("Limite da Anthropic atingido. Tente de novo em alguns minutos.");
    if (error instanceof Anthropic.APIError) throw new Error(`A IA não conseguiu ler o orçamento (${error.status ?? "erro"}).`);
    throw error;
  }
}

export async function readQuoteWithGemini(file: { name: string; type: string; base64: string }, apiKey: string): Promise<QuoteData> {
  const send = (model: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: PROMPT }, { inline_data: { mime_type: file.type, data: file.base64 } }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 4000 },
    }),
  });
  let response = await send("gemini-flash-lite-latest");
  if (response.status === 404) response = await send("gemini-flash-latest");
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    if ((response.status === 400 && /API key/i.test(text)) || response.status === 403) throw new Error("Chave do Gemini inválida. Confira na Central de IA.");
    if (response.status === 429) throw new Error("Limite do Gemini atingido. Tente de novo em alguns minutos.");
    throw new Error(`A IA não conseguiu ler o orçamento (${response.status}). ${text}`);
  }
  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  return parseJson(text);
}

export type ImportedGutterItem = {
  category: string;
  product: string;
  thickness: string;
  cut: string;
  color: string;
  quantity: number;
  meters: number;
  unit_price: number;
};

export type ImportedSpecialItem = {
  item_type: string;
  product: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
};

export function quoteItems(data: QuoteData): { items: ImportedGutterItem[]; specialItems: ImportedSpecialItem[] } {
  const items: ImportedGutterItem[] = [];
  const specialItems: ImportedSpecialItem[] = [];
  for (const raw of data.items) {
    if (raw.kind === "fabricado" && raw.category && raw.product) {
      const meters = Math.max(0.001, raw.meters_total ?? 1);
      const unit_price = Math.round(((raw.value_total ?? 0) / meters) * 100) / 100;
      items.push({
        category: raw.category,
        product: raw.product,
        thickness: raw.thickness ?? "0.5mm",
        cut: raw.cut ?? "200 mm",
        color: raw.color ?? "Aluminio Natural",
        quantity: 1,
        meters,
        unit_price,
      });
    } else {
      const qty = Math.max(1, raw.quantity ?? 1);
      const unit_price = Math.round(((raw.value_total ?? 0) / qty) * 100) / 100;
      specialItems.push({
        item_type: raw.item_type ?? "Itens Especiais",
        product: raw.special_product ?? "Tubo Vedante PU MS40",
        description: "",
        unit: raw.special_unit ?? "unidade",
        quantity: qty,
        unit_price,
      });
    }
  }
  return { items, specialItems };
}
