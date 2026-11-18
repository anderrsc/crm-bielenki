// Lê nota fiscal (PDF ou foto do DANFE) com IA e devolve os dados para pré-preencher
// a Nova compra. Nada é salvo aqui: a pessoa confere e cadastra.
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
  let parsed: unknown;
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}"); } catch { throw new Error("A IA respondeu em formato inesperado. Tente outra foto."); }
  return invoiceSchema.parse(parsed);
}
