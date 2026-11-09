"use server";
// Regras da Ana (preenchidas pelo dono) e aprendizado a partir das conversas da equipe.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/encrypt";
import { aiChat, aiErrorMessage, parseAiProvider } from "@/lib/ai/chat";
import { ANA_RULES_TEMPLATE, rulesWithoutLearned, withLearned } from "@/lib/ai/ana-rules";
import { buildTranscripts, LEARN_CHUNKS } from "@/lib/ai/ana-learn";

type Result<T = object> = ({ ok: true } & T) | { ok?: false; error: string };
const fail = (e: unknown) => ({ error: e instanceof Error ? aiErrorMessage(e) : String(e) });

async function context() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!profile?.company_id) throw new Error("Empresa não encontrada.");
  const { data: cfg } = await db.from("ai_agent_config").select("system_prompt,ai_provider,openai_model,groq_api_key,openai_api_key").eq("company_id", profile.company_id).maybeSingle();
  return { db, companyId: profile.company_id as string, cfg };
}

export async function getAnaRules(): Promise<Result<{ rules: string; hasLearned: boolean }>> {
  try {
    const { cfg } = await context();
    const rules = (cfg?.system_prompt as string | null)?.trim() || ANA_RULES_TEMPLATE;
    return { ok: true, rules, hasLearned: rules !== rulesWithoutLearned(rules) };
  } catch (e) { return fail(e); }
}

export async function saveAnaRules(rules: string): Promise<Result> {
  try {
    const { db, companyId } = await context();
    const { error } = await db.from("ai_agent_config").upsert({ company_id: companyId, system_prompt: rules.slice(0, 20000), updated_at: new Date().toISOString() }, { onConflict: "company_id" });
    if (error) throw new Error(error.message);
    revalidatePath("/central-ia");
    return { ok: true };
  } catch (e) { return fail(e); }
}

async function ask(cfg: Awaited<ReturnType<typeof context>>["cfg"], prompt: string, maxTokens: number) {
  const provider = parseAiProvider(cfg?.ai_provider);
  const stored = provider === "groq" ? (cfg?.groq_api_key ?? cfg?.openai_api_key) : cfg?.openai_api_key;
  return aiChat({ provider, model: cfg?.openai_model, apiKey: stored ? decryptSecret(stored) : null, temperature: 0.2, maxTokens, messages: [{ role: "user", content: prompt }] });
}

/** Lê um pedaço das últimas 1000 mensagens e anota como a equipe atende. */
export async function learnChunk(index: number): Promise<Result<{ notes: string; chunks: number; messages: number }>> {
  try {
    const { db, companyId, cfg } = await context();
    const { data } = await db.from("messages").select("conversation_id,direction,author,sender_name,body,sent_at")
      .eq("company_id", companyId).in("author", ["cliente", "equipe"]).order("sent_at", { ascending: false }).limit(1000);
    const chunks = buildTranscripts((data ?? []) as never);
    const chunk = chunks[index];
    if (!chunk) return { ok: true, notes: "", chunks: chunks.length, messages: data?.length ?? 0 };
    const notes = await ask(cfg, `Abaixo estão conversas reais de WhatsApp de uma empresa de calhas, rufos, peças dobradas e esquadrias de alumínio (Marquinhos, Jaraguá do Sul). "Equipe" são os atendentes.
Anote, em tópicos curtos em português, o que serve para treinar uma atendente nova:
1) Perguntas que os clientes mais fazem e como a equipe responde (sem valores em R$).
2) O que a equipe pergunta ao cliente para cada tipo de pedido (peça avulsa, calha, rufo, esquadria etc.).
3) Jeito de falar da equipe (cumprimento, tamanho das mensagens, expressões).
4) Informações fixas da empresa que aparecem (cidades atendidas, retirada/entrega, visita técnica, prazos).
Não invente nada que não esteja nas conversas. Não copie nomes nem telefones de clientes.

CONVERSAS:
${chunk}`, 900);
    return { ok: true, notes: notes.trim(), chunks: Math.min(chunks.length, LEARN_CHUNKS), messages: data?.length ?? 0 };
  } catch (e) { return fail(e); }
}

/** Junta as anotações em um guia curto e grava junto das regras. */
export async function learnFinish(notes: string[]): Promise<Result<{ learned: string }>> {
  try {
    const { db, companyId, cfg } = await context();
    const joined = notes.filter(Boolean).join("\n\n---\n\n").slice(0, 14000);
    if (!joined) throw new Error("Não achei conversas da equipe para aprender.");
    const learned = (await ask(cfg, `Junte as anotações abaixo (tiradas de conversas reais da equipe) num guia CURTO para a atendente virtual Ana, em tópicos, sem repetir, no máximo 40 linhas. Seções: "Dúvidas comuns e como responder", "O que perguntar por tipo de pedido", "Jeito de falar", "Informações da empresa". Sem valores em R$, sem nomes ou telefones de clientes, nada inventado.

ANOTAÇÕES:
${joined}`, 1400)).trim();
    const current = (cfg?.system_prompt as string | null)?.trim() || ANA_RULES_TEMPLATE;
    const { error } = await db.from("ai_agent_config").upsert({ company_id: companyId, system_prompt: withLearned(current, learned).slice(0, 20000), updated_at: new Date().toISOString() }, { onConflict: "company_id" });
    if (error) throw new Error(error.message);
    revalidatePath("/central-ia");
    return { ok: true, learned };
  } catch (e) { return fail(e); }
}
