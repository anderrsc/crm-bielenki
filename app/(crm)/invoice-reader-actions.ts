"use server";
// Ler nota fiscal (PDF/foto) com IA para pré-preencher a Nova compra.
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/encrypt";
import { consumeAiQuota } from "@/lib/ai/rate-limit";
import { invoiceItems, onlyDigits, readInvoiceWithAi, readInvoiceWithClaude, readInvoiceWithGemini, type InvoiceItem } from "@/lib/ai/invoice-reader";

export type InvoiceResult =
  | { ok: true; items: InvoiceItem[]; supplierId: string | null; supplierName: string | null; supplierCnpj: string | null; number: string | null; total: number | null; dueDate: string | null; installments: { data: string | null; valor: number | null }[] }
  | { ok: false; error: string };

const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function readInvoice(form: FormData): Promise<InvoiceResult> {
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Escolha o PDF ou a foto da nota." };
    if (!TYPES.includes(file.type)) return { ok: false, error: "Envie PDF, JPG, PNG ou WEBP (foto do iPhone: exporte como JPG)." };
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: "Arquivo muito grande (máx. 10 MB)." };
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
    const { data: allowed } = await db.rpc("has_table_access", { resource: "purchase_orders", action: "insert" });
    if (allowed !== true) return { ok: false, error: "Sem permissão para lançar compras." };
    const { data: cfg } = await db.from("ai_agent_config").select("openai_api_key,openai_model,ai_provider,gemini_api_key,anthropic_api_key").maybeSingle();
    const claude = cfg?.anthropic_api_key as string | null | undefined;
    const gemini = cfg?.gemini_api_key as string | null | undefined;
    const openai = cfg?.openai_api_key as string | null | undefined;
    if (!claude && !gemini && !openai) return { ok: false, error: "Leitura de nota indisponível: cadastre a chave da Anthropic (Claude), do Google Gemini ou da OpenAI na Central de IA." };
    consumeAiQuota(`nota:${user.id}`);
    const payload = { name: file.name, type: file.type, base64: Buffer.from(await file.arrayBuffer()).toString("base64") };
    const model = cfg?.ai_provider === "openai" && cfg?.openai_model && !String(cfg.openai_model).includes("/") ? String(cfg.openai_model) : "gpt-4o";
    const data = claude ? await readInvoiceWithClaude(payload, decryptSecret(claude)) : gemini ? await readInvoiceWithGemini(payload, decryptSecret(gemini)) : await readInvoiceWithAi(payload, decryptSecret(openai!), model);
    const items = invoiceItems(data);
    if (!items.length) return { ok: false, error: "Não encontrei itens na nota. Tente uma foto mais nítida ou o PDF." };
    let supplierId: string | null = null;
    const cnpj = onlyDigits(data.fornecedor.cnpj);
    const { data: suppliers } = await db.from("suppliers").select("id,name,tax_id").is("deleted_at", null);
    const list = (suppliers ?? []) as { id: string; name: string; tax_id: string | null }[];
    if (cnpj.length >= 11) supplierId = list.find((s) => onlyDigits(s.tax_id) === cnpj)?.id ?? null;
    if (!supplierId && data.fornecedor.nome) {
      const n = data.fornecedor.nome.toLowerCase().split(/\s+/).slice(0, 2).join(" ");
      supplierId = list.find((s) => s.name.toLowerCase().startsWith(n))?.id ?? null;
    }
    const due = data.vencimentos.map((v) => v.data).filter(Boolean).sort()[0] ?? null;
    return { ok: true, items, supplierId, supplierName: data.fornecedor.nome, supplierCnpj: data.fornecedor.cnpj, number: data.numero_nota, total: data.valor_total, dueDate: due, installments: data.vencimentos };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Não foi possível ler a nota." };
  }
}
