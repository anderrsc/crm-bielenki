"use server";
// Server actions do motor LIA V2: ligar/desligar regra, atualizar bloco, aprovar/rejeitar pedido.
import { revalidatePath } from "next/cache";
import { getAuthUser, getRequestClient } from "@/lib/supabase/server";
import type { LiaRuleRow, LiaKnowledgeBlockRow, LiaActionRequestRow, LiaAuditRow, AutonomyLevel, RiskLevel } from "@/lib/ai/lia-types";

async function getProfileAndCompany() {
  const db = await getRequestClient();
  const user = await getAuthUser();
  if (!user) throw new Error("Não autenticado");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).eq("active", true).single();
  if (!profile?.company_id) throw new Error("Empresa não encontrada");
  const { data: roles, error } = await db.rpc("current_user_roles");
  if (error) throw new Error("Não foi possível verificar as permissões");
  const role = (roles as string[] | null)?.find(r => r === "administrador" || r === "gerente") ?? null;
  return { db, user, profile: { ...profile, role } };
}

function isManager(role: string | null) {
  return role === "gerente" || role === "administrador";
}

/** Lista todas as regras da empresa agrupadas por bloco. */
export async function listLiaRules(): Promise<{ data: LiaRuleRow[]; error?: string }> {
  try {
    const { db, profile } = await getProfileAndCompany();
    const { data, error } = await db
      .from("lia_rules")
      .select("id,rule_number,block_id,category,title,name,is_active,autonomy_level,risk_level,validation_status,description,created_at,updated_at")
      .eq("company_id", profile.company_id)
      .order("rule_number", { ascending: true, nullsFirst: false })
      .limit(1100);
    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as LiaRuleRow[] };
  } catch (e) {
    return { data: [], error: String(e) };
  }
}

/** Ativa ou desativa uma regra (somente gerente/administrador). */
export async function toggleLiaRule(ruleId: string, active: boolean): Promise<{ error?: string }> {
  try {
    const { db, user, profile } = await getProfileAndCompany();
    if (!isManager(profile.role)) return { error: "Somente gerente ou administrador pode alterar regras." };
    const { error } = await db
      .from("lia_rules")
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq("id", ruleId)
      .eq("company_id", profile.company_id);
    if (error) return { error: error.message };
    await db.from("lia_audit_events").insert({
      company_id: profile.company_id,
      event_type: active ? "rule_enabled" : "rule_disabled",
      actor_id: user.id,
      actor_role: profile.role,
      target_type: "rule",
      target_id: ruleId,
      rule_id: ruleId,
      outcome: "changed",
      details: { is_active: active },
    });
    revalidatePath("/central-ia");
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/** Atualiza o nível de autonomia de uma regra. */
export async function updateRuleAutonomy(
  ruleId: string,
  autonomy: AutonomyLevel,
  risk: RiskLevel,
): Promise<{ error?: string }> {
  try {
    const { db, user, profile } = await getProfileAndCompany();
    if (!isManager(profile.role)) return { error: "Somente gerente ou administrador pode alterar regras." };
    const { error } = await db
      .from("lia_rules")
      .update({ autonomy_level: autonomy, risk_level: risk, updated_at: new Date().toISOString() })
      .eq("id", ruleId)
      .eq("company_id", profile.company_id);
    if (error) return { error: error.message };
    await db.from("lia_audit_events").insert({
      company_id: profile.company_id,
      event_type: "rule_updated",
      actor_id: user.id,
      actor_role: profile.role,
      target_type: "rule",
      target_id: ruleId,
      rule_id: ruleId,
      outcome: "changed",
      details: { autonomy_level: autonomy, risk_level: risk },
    });
    revalidatePath("/central-ia");
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/** Lê os blocos de conhecimento da empresa. */
export async function listKnowledgeBlocks(): Promise<{ data: LiaKnowledgeBlockRow[]; error?: string }> {
  try {
    const { db, profile } = await getProfileAndCompany();
    const { data, error } = await db
      .from("lia_knowledge_blocks")
      .select("id,block_number,category,rule_range_start,rule_range_end,content,is_active,version,updated_at")
      .eq("company_id", profile.company_id)
      .order("block_number", { ascending: true });
    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as LiaKnowledgeBlockRow[] };
  } catch (e) {
    return { data: [], error: String(e) };
  }
}

/** Atualiza o conteúdo de um bloco de conhecimento. */
export async function updateKnowledgeBlock(blockId: string, content: string): Promise<{ error?: string }> {
  try {
    const { db, user, profile } = await getProfileAndCompany();
    if (!isManager(profile.role)) return { error: "Somente gerente ou administrador pode editar o conhecimento." };
    const trimmed = content.trim();
    if (!trimmed) return { error: "Conteúdo não pode estar vazio." };
    if (trimmed.length > 8000) return { error: "Conteúdo muito longo (máximo 8000 caracteres)." };
    const { data: existing } = await db.from("lia_knowledge_blocks").select("version").eq("id", blockId).eq("company_id", profile.company_id).single();
    if (!existing) return { error: "Bloco não encontrado." };
    const { error } = await db
      .from("lia_knowledge_blocks")
      .update({ content: trimmed, version: (existing.version ?? 1) + 1, updated_at: new Date().toISOString() })
      .eq("id", blockId)
      .eq("company_id", profile.company_id);
    if (error) return { error: error.message };
    await db.from("lia_audit_events").insert({
      company_id: profile.company_id,
      event_type: "kb_updated",
      actor_id: user.id,
      actor_role: profile.role,
      target_type: "knowledge_block",
      target_id: blockId,
      outcome: "changed",
      details: { new_version: (existing.version ?? 1) + 1 },
    });
    revalidatePath("/central-ia");
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/** Lista pedidos de aprovação pendentes. */
export async function listActionRequests(status?: string): Promise<{ data: LiaActionRequestRow[]; error?: string }> {
  try {
    const { db, profile } = await getProfileAndCompany();
    let q = db
      .from("lia_action_requests")
      .select("id,request_type,title,description,status,approver_role,payload_json,expires_at,decided_at,rejection_reason,created_at,requested_by")
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as LiaActionRequestRow[] };
  } catch (e) {
    return { data: [], error: String(e) };
  }
}

/** Aprova ou rejeita um pedido (somente gerente/administrador). */
export async function decideActionRequest(
  requestId: string,
  decision: "approved" | "rejected",
  rejectionReason?: string,
): Promise<{ error?: string }> {
  try {
    const { db, user, profile } = await getProfileAndCompany();
    if (!isManager(profile.role)) return { error: "Somente gerente ou administrador pode aprovar ou rejeitar pedidos." };
    const now = new Date().toISOString();
    const { error } = await db
      .from("lia_action_requests")
      .update({ status: decision, approved_by: user.id, decided_at: now, rejection_reason: decision === "rejected" ? (rejectionReason ?? null) : null, updated_at: now })
      .eq("id", requestId)
      .eq("company_id", profile.company_id)
      .eq("status", "pending");
    if (error) return { error: error.message };
    await db.from("lia_audit_events").insert({
      company_id: profile.company_id,
      event_type: "approval_decided",
      actor_id: user.id,
      actor_role: profile.role,
      target_type: "approval",
      target_id: requestId,
      action_request_id: requestId,
      outcome: decision === "approved" ? "approved" : "rejected",
      details: { rejection_reason: rejectionReason ?? null },
    });
    revalidatePath("/central-ia");
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/** Lê eventos de auditoria. */
export async function listAuditEvents(limit = 50): Promise<{ data: LiaAuditRow[]; error?: string }> {
  try {
    const { db, profile } = await getProfileAndCompany();
    const { data, error } = await db
      .from("lia_audit_events")
      .select("id,event_type,actor_role,target_type,outcome,details,created_at")
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as LiaAuditRow[] };
  } catch (e) {
    return { data: [], error: String(e) };
  }
}
