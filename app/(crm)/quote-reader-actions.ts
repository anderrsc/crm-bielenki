"use server";
// Lê orçamento antigo de calhas (PDF/foto) com IA para pré-preencher o formulário.
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/encrypt";
import { consumeAiQuota } from "@/lib/ai/rate-limit";
import { readQuoteWithClaude, readQuoteWithGemini, quoteItems, type ImportedGutterItem, type ImportedSpecialItem } from "@/lib/ai/quote-reader";

export type QuoteReadResult =
  | { ok: true; items: ImportedGutterItem[]; specialItems: ImportedSpecialItem[]; clientName: string | null; clientPhone: string | null; clientId: string | null; validUntil: string | null }
  | { ok: false; error: string };

const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function readQuotePdf(form: FormData): Promise<QuoteReadResult> {
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Escolha o PDF ou foto do orçamento." };
    if (!TYPES.includes(file.type)) return { ok: false, error: "Envie PDF, JPG ou PNG." };
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: "Arquivo muito grande (máx. 10 MB)." };

    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };

    const { data: cfg } = await db.from("ai_agent_config").select("anthropic_api_key,gemini_api_key").maybeSingle();
    const claude = cfg?.anthropic_api_key as string | null | undefined;
    const gemini = cfg?.gemini_api_key as string | null | undefined;
    if (!claude && !gemini) return { ok: false, error: "Leitura indisponível: cadastre a chave da Anthropic ou do Gemini na Central de IA." };

    consumeAiQuota(`orcamento:${user.id}`);
    const payload = { name: file.name, type: file.type, base64: Buffer.from(await file.arrayBuffer()).toString("base64") };
    const data = claude ? await readQuoteWithClaude(payload, decryptSecret(claude)) : await readQuoteWithGemini(payload, decryptSecret(gemini!));
    const { items, specialItems } = quoteItems(data);
    if (!items.length && !specialItems.length) return { ok: false, error: "Não encontrei itens no orçamento. Tente uma foto mais nítida ou o PDF." };

    // Tenta localizar o cliente pelo telefone ou nome
    let clientId: string | null = null;
    if (data.client_phone || data.client_name) {
      const { data: clients } = await db.from("clients").select("id,name,phone").eq("status", "ativo").is("deleted_at", null);
      const list = (clients ?? []) as { id: string; name: string; phone: string | null }[];
      if (data.client_phone) {
        const digits = data.client_phone.replace(/\D/g, "");
        clientId = list.find((c) => (c.phone ?? "").replace(/\D/g, "").endsWith(digits.slice(-8)))?.id ?? null;
      }
      if (!clientId && data.client_name) {
        const n = data.client_name.toLowerCase().split(/\s+/).slice(0, 2).join(" ");
        clientId = list.find((c) => c.name.toLowerCase().startsWith(n))?.id ?? null;
      }
    }

    return { ok: true, items, specialItems, clientName: data.client_name, clientPhone: data.client_phone, clientId, validUntil: data.valid_until };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Não foi possível ler o orçamento." };
  }
}
