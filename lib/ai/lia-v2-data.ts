// Carrega dados do motor LIA V2 para a Central de Controle (server-side only).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LiaRuleRow, LiaKnowledgeBlockRow, LiaActionRequestRow, LiaAuditRow } from "@/lib/ai/lia-types";

export type LiaV2Data = {
  rules: LiaRuleRow[];
  blocks: LiaKnowledgeBlockRow[];
  requests: LiaActionRequestRow[];
  auditEvents: LiaAuditRow[];
  stats: {
    total: number;
    active: number;
    pending: number;
    pendingApprovals: number;
    blocks: number;
  };
};

export async function loadLiaV2Data(db: SupabaseClient, companyId: string): Promise<LiaV2Data> {
  const [rulesRes, blocksRes, requestsRes, auditRes] = await Promise.all([
    db.from("lia_rules")
      .select("id,rule_number,block_id,category,title,name,is_active,autonomy_level,risk_level,validation_status,description,created_at,updated_at")
      .eq("company_id", companyId)
      .order("rule_number", { ascending: true, nullsFirst: false })
      .limit(1100),
    db.from("lia_knowledge_blocks")
      .select("id,block_number,category,rule_range_start,rule_range_end,content,is_active,version,updated_at")
      .eq("company_id", companyId)
      .order("block_number", { ascending: true }),
    db.from("lia_action_requests")
      .select("id,request_type,title,description,status,approver_role,payload_json,expires_at,decided_at,rejection_reason,created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("lia_audit_events")
      .select("id,event_type,actor_role,target_type,outcome,details,created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const rules = (rulesRes.data ?? []) as LiaRuleRow[];
  const blocks = (blocksRes.data ?? []) as LiaKnowledgeBlockRow[];
  const requests = (requestsRes.data ?? []) as LiaActionRequestRow[];
  const auditEvents = (auditRes.data ?? []) as LiaAuditRow[];

  return {
    rules,
    blocks,
    requests,
    auditEvents,
    stats: {
      total: rules.length,
      active: rules.filter(r => r.is_active).length,
      pending: rules.filter(r => r.validation_status === "pending").length,
      pendingApprovals: requests.filter(r => r.status === "pending").length,
      blocks: blocks.length,
    },
  };
}
