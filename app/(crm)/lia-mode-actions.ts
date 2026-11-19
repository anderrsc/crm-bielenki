"use server";
// Modo de trabalho da Lia (Central de IA) e histórico das decisões dela.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseLiaHours, parseLiaMode, type LiaHours, type LiaMode } from "@/lib/ai/lia-mode";

export type LiaDecisionRow = { id: string; decisao: string; motivo: string; modo: string | null; phone: string | null; at: string; conversationId: string | null };
export type LiaSettings = { mode: LiaMode; hours: LiaHours; dailyLimit: number; canEdit: boolean; decisions: LiaDecisionRow[] };

async function context() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!profile?.company_id) throw new Error("Empresa não encontrada.");
  return { db, companyId: profile.company_id as string };
}

export async function loadLiaSettings(): Promise<LiaSettings | { error: string }> {
  try {
    const { db, companyId } = await context();
    const [{ data: cfg }, { data: rows, error }] = await Promise.all([
      db.from("ai_agent_config").select("lia_mode,lia_hours,lia_daily_limit").eq("company_id", companyId).maybeSingle(),
      db.from("ai_decisions").select("id,decisao,motivo,modo,phone,created_at,conversation_id").eq("company_id", companyId).order("created_at", { ascending: false }).limit(40),
    ]);
    if (error) return { error: "Registro de decisões ainda não disponível." };
    return {
      mode: parseLiaMode(cfg?.lia_mode), hours: parseLiaHours(cfg?.lia_hours), dailyLimit: Number(cfg?.lia_daily_limit ?? 200),
      // A config só é visível (RLS) para administrador e gerente.
      canEdit: !!cfg,
      decisions: (rows ?? []).map(r => ({ id: r.id, decisao: r.decisao, motivo: r.motivo, modo: r.modo, phone: r.phone, at: r.created_at, conversationId: r.conversation_id })),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const Input = z.object({
  mode: z.enum(["assistente", "semiautomatica", "automatica"]),
  hours: z.object({ inicio: z.string(), fim: z.string(), dias: z.array(z.number().int().min(0).max(6)).min(1) }).nullable(),
  dailyLimit: z.number().int().min(1).max(5000),
});

export async function saveLiaSettings(input: { mode: LiaMode; hours: LiaHours; dailyLimit: number }): Promise<{ ok?: true; error?: string }> {
  try {
    const parsed = Input.safeParse(input);
    if (!parsed.success) return { error: "Dados inválidos." };
    const hours = parsed.data.hours ? parseLiaHours(parsed.data.hours) : null;
    if (parsed.data.hours && !hours) return { error: "Horário inválido. Use HH:MM e escolha ao menos um dia." };
    const { db, companyId } = await context();
    const { data, error } = await db.from("ai_agent_config")
      .update({ lia_mode: parsed.data.mode, lia_hours: hours, lia_daily_limit: parsed.data.dailyLimit, updated_at: new Date().toISOString() })
      .eq("company_id", companyId).select("id");
    if (error) return { error: "Não foi possível salvar o modo da Lia." };
    if (!data?.length) return { error: "Só administrador ou gerente pode mudar o modo da Lia." };
    revalidatePath("/central-ia");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export type LiaFollowups = { enabled: boolean; dailyLimit: number; sentToday: number; canEdit: boolean };

export async function loadLiaFollowups(): Promise<LiaFollowups | { error: string }> {
  try {
    const { db, companyId } = await context();
    const { data: cfg, error } = await db.from("ai_agent_config").select("lia_followups_enabled,lia_followups_daily_limit").eq("company_id", companyId).maybeSingle();
    if (error) return { error: "O acompanhamento automático ainda não foi ativado no banco." };
    const day = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())}T00:00:00-03:00`).toISOString();
    const { count } = await db.from("lia_automation_executions").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("kind", "followup").eq("status", "enviada").gte("created_at", day);
    return { enabled: cfg?.lia_followups_enabled === true, dailyLimit: Number(cfg?.lia_followups_daily_limit ?? 15), sentToday: count ?? 0, canEdit: !!cfg };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

export async function saveLiaFollowups(input: { enabled: boolean; dailyLimit: number }): Promise<{ ok?: true; error?: string }> {
  try {
    const p = z.object({ enabled: z.boolean(), dailyLimit: z.number().int().min(1).max(100) }).safeParse(input);
    if (!p.success) return { error: "Limite por dia de 1 a 100." };
    const { db, companyId } = await context();
    const { data, error } = await db.from("ai_agent_config").update({ lia_followups_enabled: p.data.enabled, lia_followups_daily_limit: p.data.dailyLimit, updated_at: new Date().toISOString() }).eq("company_id", companyId).select("id");
    if (error) return { error: "Não foi possível salvar." };
    if (!data?.length) return { error: "Só administrador ou gerente pode mudar o acompanhamento." };
    revalidatePath("/central-ia");
    return { ok: true };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}
