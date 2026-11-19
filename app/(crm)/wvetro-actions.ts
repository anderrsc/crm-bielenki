"use server";
// Importar a proposta do WVetro (PDF) para o Orçamento de esquadrias.
// Lê pelo texto do PDF; se não der (PDF escaneado ou outro layout), usa a IA da Central de IA.
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { selectOwnProfile } from "@/lib/own-profile";
import { decryptSecret } from "@/lib/encrypt";
import { consumeAiQuota } from "@/lib/ai/rate-limit";
import { pdfRows } from "@/lib/pdf-text";
import { parseWvetroRows, proposalNotes, toWindowItems, type WindowFormItem, type WvetroProposal } from "@/lib/wvetro-proposal";
import { readProposalWithClaude, readProposalWithGemini } from "@/lib/ai/proposal-reader";
import { formatBrazilianPhone, formatRegistrationName } from "@/lib/brazilian-input";

export type ProposalResult =
  | { ok: true; proposal: WvetroProposal; items: WindowFormItem[]; metragens: (number | null)[]; notes: string; client: { id: string; name: string } | null; via: "texto" | "ia" }
  | { ok: false; error: string };

const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

async function findClient(db: Awaited<ReturnType<typeof createClient>>, name: string | null) {
  const target = norm(name ?? "");
  if (target.length < 3) return null;
  const words = target.split(" ");
  // Busca pelo começo de cada palavra (o cadastro pode ter ou não acento) e confere o nome inteiro sem acento e sem caixa.
  const parts = [...new Set(words.filter((w) => w.length >= 3).map((w) => w.slice(0, 3)))].slice(0, 4);
  if (!parts.length) return null;
  const { data } = await db.from("clients").select("id,name").eq("status", "ativo").or(parts.map((p) => `name.ilike.%${p}%`).join(",")).limit(300);
  const list = (data ?? []) as { id: string; name: string }[];
  return list.find((c) => norm(c.name) === target)
    ?? list.find((c) => { const n = norm(c.name).split(" "); return n[0] === words[0] && n[n.length - 1] === words[words.length - 1]; })
    ?? null;
}

export async function readWvetroProposal(form: FormData): Promise<ProposalResult> {
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Escolha o PDF da proposta." };
    if (!TYPES.includes(file.type)) return { ok: false, error: "Envie o PDF da proposta (ou uma foto em JPG/PNG)." };
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: "Arquivo muito grande (máx. 10 MB)." };
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
    const { data: allowed } = await db.rpc("has_table_access", { resource: "quotes", action: "insert" });
    if (allowed !== true) return { ok: false, error: "Sem permissão para criar orçamentos." };

    const bytes = new Uint8Array(await file.arrayBuffer());
    let proposal: WvetroProposal | null = null;
    let via: "texto" | "ia" = "texto";
    if (file.type === "application/pdf") {
      try { proposal = parseWvetroRows(await pdfRows(bytes.slice())); } catch { proposal = null; }
    }
    if (!proposal?.itens.length) {
      const { data: cfg } = await db.from("ai_agent_config").select("gemini_api_key,anthropic_api_key").maybeSingle();
      const claude = cfg?.anthropic_api_key as string | null | undefined;
      const gemini = cfg?.gemini_api_key as string | null | undefined;
      if (!claude && !gemini) return { ok: false, error: "Não consegui ler os itens pelo texto do PDF. Para ler com IA, cadastre a chave da Anthropic (Claude) ou do Gemini na Central de IA." };
      consumeAiQuota(`proposta:${user.id}`);
      const payload = { type: file.type, base64: Buffer.from(bytes).toString("base64") };
      proposal = claude ? await readProposalWithClaude(payload, decryptSecret(claude)) : await readProposalWithGemini(payload, decryptSecret(gemini!));
      via = "ia";
    }
    if (!proposal.itens.length) return { ok: false, error: "Não encontrei itens nesta proposta. Confira se é o PDF do WVetro." };
    return {
      ok: true, proposal, via,
      items: toWindowItems(proposal),
      metragens: proposal.itens.map((i) => i.metragem),
      notes: proposalNotes(proposal),
      client: await findClient(db, proposal.cliente.nome),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Não foi possível ler a proposta." };
  }
}

const clientSchema = z.object({
  nome: z.string().trim().min(2).max(200),
  telefone: z.string().nullable(), celular: z.string().nullable(), email: z.string().nullable(),
  endereco: z.string().nullable(), bairro: z.string().nullable(), cidade: z.string().nullable(),
  uf: z.string().nullable(), cep: z.string().nullable(), documento: z.string().nullable(),
  numero: z.string().nullable(),
});

/** Cadastra o cliente da proposta quando ele ainda não existe no sistema. */
export async function createClientFromProposal(input: z.input<typeof clientSchema>): Promise<{ ok: true; client: { id: string; name: string } } | { ok: false; error: string }> {
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "A proposta não traz o nome do cliente." };
  const c = parsed.data;
  const db = await createClient();
  const { data: profile } = await selectOwnProfile<{ company_id: string | null }>(db, "company_id");
  if (!profile?.company_id) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const name = formatRegistrationName(c.nome);
  const existing = await findClient(db, name);
  if (existing) return { ok: true, client: existing };
  const phone = c.celular || c.telefone;
  const address = c.endereco && !/^s\/?n$/i.test(c.endereco) ? formatRegistrationName(c.endereco) : null;
  const { data, error } = await db.from("clients").insert({
    company_id: profile.company_id,
    name,
    phone: phone ? formatBrazilianPhone(phone) : null,
    email: c.email && /@/.test(c.email) ? c.email.toLowerCase() : null,
    tax_id: c.documento || null,
    address,
    neighborhood: c.bairro ? formatRegistrationName(c.bairro) : null,
    city: c.cidade ? formatRegistrationName(c.cidade) : null,
    state: c.uf && /^[A-Za-z]{2}$/.test(c.uf) ? c.uf.toUpperCase() : null,
    postal_code: c.cep && /^\d{8}$/.test(c.cep) ? c.cep : null,
    notes: c.numero ? `Cadastrado pela proposta WVetro nº ${c.numero}.` : "Cadastrado por proposta WVetro.",
  }).select("id,name").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Não foi possível cadastrar o cliente." };
  return { ok: true, client: data as { id: string; name: string } };
}
