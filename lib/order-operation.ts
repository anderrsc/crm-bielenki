import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderOperation, Person } from "@/components/order-operation-card";

export type OrderOperationData = { op: OrderOperation; people: Person[]; canUpdate: boolean; isManager: boolean; history: { action: string; at: string; who: string | null; detail: string | null }[] };

const ACTION_LABEL: Record<string, string> = {
  DECISAO_MEDIDAS: "Definiu a conferência de medidas", NOVA_CONFERENCIA: "Pediu nova conferência de medidas", CONFERENCIA_AGENDADA: "Agendou a conferência",
  CONFERENCIA_CONCLUIDA: "Registrou o resultado da conferência", MEDIDAS_VALIDADAS: "Validou as medidas", LIBERADO_CORTE: "Liberou para corte",
};
const RESULT_LABEL: Record<string, string> = { conferidas: "medidas conferidas", alteradas: "medidas alteradas", revisar_orcamento: "revisar orçamento", nova_visita: "nova visita necessária" };

/** Etapa operacional de um pedido, com o historico (quem, quando) e o que o usuario pode fazer. */
export async function loadOrderOperation(db: SupabaseClient, orderId: string): Promise<OrderOperationData | null> {
  const [order, check, people, canUpdate, roles, logs] = await Promise.all([
    db.from("orders").select("id,op_stage,cut_released_at").eq("id", orderId).maybeSingle(),
    db.from("order_measure_checks").select("status,scheduled_at,notes,responsible:profiles!order_measure_checks_responsible_id_fkey(full_name)").eq("order_id", orderId).in("status", ["pendente", "agendada"]).maybeSingle(),
    db.from("profiles").select("id,full_name").eq("status", "ativo").order("full_name"),
    db.rpc("has_table_access", { resource: "orders", action: "update" }),
    db.rpc("current_user_roles"),
    db.from("audit_logs").select("action,created_at,new_data,profile:profiles(full_name)").eq("table_name", "order_operations").eq("record_id", orderId).order("created_at", { ascending: false }).limit(20),
  ]);
  // Banco ainda sem a migration, ou pedido antigo fora do fluxo: nao mostra nada.
  if (order.error || !order.data?.op_stage) return null;
  const c = check.data as unknown as { status: string; scheduled_at: string | null; notes: string | null; responsible: { full_name?: string } | null } | null;
  const history = ((logs.data ?? []) as unknown as { action: string; created_at: string; new_data: Record<string, unknown> | null; profile: { full_name?: string } | null }[]).map((l) => {
    const d = l.new_data ?? {};
    const detail = l.action === "DECISAO_MEDIDAS" ? (d.precisa_conferencia ? "precisa de conferência" : "medidas já conferidas")
      : l.action === "CONFERENCIA_CONCLUIDA" ? [RESULT_LABEL[String(d.resultado)] ?? null, d.observacoes ? String(d.observacoes) : null].filter(Boolean).join(" · ")
      : d.observacoes ? String(d.observacoes) : null;
    return { action: ACTION_LABEL[l.action] ?? l.action, at: l.created_at, who: l.profile?.full_name ?? null, detail: detail || null };
  });
  return {
    op: { order_id: orderId, op_stage: order.data.op_stage, cut_released_at: order.data.cut_released_at, check: c ? { status: c.status, scheduled_at: c.scheduled_at, notes: c.notes, responsible_name: c.responsible?.full_name ?? null } : null },
    people: (people.data ?? []) as Person[], canUpdate: canUpdate.data === true,
    isManager: ((roles.data as string[] | null) ?? []).some((r) => r === "administrador" || r === "gerente"), history,
  };
}
