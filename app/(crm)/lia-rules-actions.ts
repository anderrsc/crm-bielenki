"use server";
// Regras ensinadas à Lia pela gerência: interpretar a correção, propor, confirmar, nova versão e desfazer.
// Toda escrita passa pelas funções do banco (lia_rule_*), que checam o papel e gravam auditoria.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/encrypt";
import { aiChat, parseAiProvider } from "@/lib/ai/chat";
import { friendlyError } from "@/lib/friendly-error";
import { draftFromCorrection, INTERPRET_PROMPT, parseDraft, similarRules, type LiaRule, type RuleDraft } from "@/lib/ai/lia-learned-rules";

type Result<T = object> = ({ ok: true } & T) | { ok?: false; error: string };
const fail = (e: unknown) => ({ error: friendlyError(e instanceof Error ? e.message : String(e)) ?? "Erro inesperado." });
const COLS = "id,quando,instrucao,status,versao,anterior_id,pedido_original,exemplo,created_at,ativada_em";
export type LiaRuleRow = LiaRule & { pedido_original: string | null; exemplo: string | null; created_at: string; ativada_em: string | null };

async function context() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!profile?.company_id) throw new Error("Empresa não encontrada.");
  return { db, companyId: profile.company_id as string };
}

export async function listLiaRules(): Promise<Result<{ rules: LiaRuleRow[] }>> {
  try {
    const { db, companyId } = await context();
    const { data, error } = await db.from("ai_lia_rules").select(COLS).eq("company_id", companyId)
      .neq("status", "arquivada").order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(/does not exist|relation/i.test(error.message) ? "Falta aplicar a atualização do banco das regras da Lia." : error.message);
    return { ok: true, rules: (data ?? []) as LiaRuleRow[] };
  } catch (e) { return fail(e); }
}

const Pedido = z.string().trim().min(5, "Escreva a correção.").max(1500, "Correção longa demais.");

/** Lê a correção e devolve um rascunho para a gerência conferir. Não grava nada. */
export async function interpretCorrection(pedido: string, exemplo?: string | null): Promise<Result<{ draft: RuleDraft; similar: LiaRule[]; viaIa: boolean }>> {
  try {
    const p = Pedido.parse(pedido);
    const ex = typeof exemplo === "string" && exemplo.trim() ? exemplo.trim().slice(0, 2000) : null;
    const { db, companyId } = await context();
    const [{ data: cfg }, { data: ativas }] = await Promise.all([
      db.from("ai_agent_config").select("ai_provider,openai_model,groq_api_key,openai_api_key").eq("company_id", companyId).maybeSingle(),
      db.from("ai_lia_rules").select(COLS).eq("company_id", companyId).eq("status", "ativa").limit(200),
    ]);
    let draft: RuleDraft | null = null;
    try {
      const provider = parseAiProvider(cfg?.ai_provider);
      const stored = provider === "groq" ? (cfg?.groq_api_key ?? cfg?.openai_api_key) : cfg?.openai_api_key;
      const raw = await aiChat({ provider, model: cfg?.openai_model, apiKey: stored ? decryptSecret(stored) : null, temperature: 0, json: true, maxTokens: 300,
        messages: [{ role: "user", content: INTERPRET_PROMPT(p, ex) }] });
      draft = parseDraft(raw);
    } catch { /* sem IA agora: segue com a leitura simples */ }
    const viaIa = !!draft;
    draft ??= draftFromCorrection(p);
    return { ok: true, draft, similar: similarRules(draft, (ativas ?? []) as LiaRule[]), viaIa };
  } catch (e) { return e instanceof z.ZodError ? { error: e.issues[0].message } : fail(e); }
}

const Salvar = z.object({
  quando: z.string().trim().max(300).nullable(),
  instrucao: z.string().trim().min(5, "A instrução precisa ter ao menos 5 caracteres.").max(1000),
  pedido: z.string().trim().max(2000).nullable(),
  exemplo: z.string().trim().max(2000).nullable(),
  anterior: z.string().uuid().nullable(),
  ativar: z.boolean(),
});

/** Grava a regra (ou a nova versão de uma regra) e, se pedido, já confirma. */
export async function saveLiaRule(input: z.input<typeof Salvar>): Promise<Result<{ id: string }>> {
  try {
    const v = Salvar.parse(input);
    const { db } = await context();
    const { data: id, error } = await db.rpc("lia_rule_propose", { p_quando: v.quando || null, p_instrucao: v.instrucao, p_pedido: v.pedido, p_exemplo: v.exemplo, p_anterior: v.anterior });
    if (error) throw new Error(error.message);
    if (v.ativar) {
      const { error: actError } = await db.rpc("lia_rule_activate", { p_id: id });
      if (actError) throw new Error(actError.message);
    }
    revalidatePath("/central-ia");
    return { ok: true, id: id as string };
  } catch (e) { return e instanceof z.ZodError ? { error: e.issues[0].message } : fail(e); }
}

export async function setLiaRuleStatus(id: string, acao: "ativar" | "desfazer"): Promise<Result> {
  try {
    if (!z.string().uuid().safeParse(id).success) return { error: "Regra inválida." };
    const { db } = await context();
    const { error } = await db.rpc(acao === "ativar" ? "lia_rule_activate" : "lia_rule_archive", { p_id: id });
    if (error) throw new Error(error.message);
    revalidatePath("/central-ia");
    return { ok: true };
  } catch (e) { return fail(e); }
}
