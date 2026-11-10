import type { SupabaseClient } from "@supabase/supabase-js";

export type SaleSummary = { id: string; company_id: string; sale_number: string; client_id: string; total: number; paid_amount: number; open_amount: number; financial_status: string; operational_status: string; client: { name: string; phone: string | null } | null };
export type SaleOrder = { id: string; order_number: string; operational_status: string; next_action: string | null; blocked_reason: string | null };
export type SaleEntry = { id: string; description: string; total_amount: number; paid_amount: number; open_amount: number; due_date: string | null; status: string; interest_amount: number; discount_amount: number; installment_count: number; first_installment_due_date: string | null };
export type SaleChecklistItem = { id: string; title: string; status: string; completed_at: string | null; sort_order: number };
export type SaleMeasurement = { id: string; measurement_number: string | null; status: string; scheduled_at: string | null };
export type SaleWorkspaceData = {
  sale: SaleSummary; order: SaleOrder | null; quote: { id: string; quote_number: string } | null;
  entries: SaleEntry[]; checklist: SaleChecklistItem[]; measurements: SaleMeasurement[];
  access: Record<string, boolean>; warnings: string[];
};

/** All relations belong to this sale, with both user RLS and explicit company filters. */
export async function loadSaleWorkspace(db: SupabaseClient, id: string): Promise<SaleWorkspaceData | null> {
  const { data, error } = await db.from("sales")
    .select("id,company_id,sale_number,client_id,total,paid_amount,open_amount,financial_status,operational_status,client:clients(name,phone)").eq("id", id).single();
  if (error || !data) return null;
  const sale = data as unknown as SaleSummary;
  const rights = [
    ["financial_entries", "select"], ["financial_entries", "update"], ["payments", "insert"], ["orders", "select"], ["quotes", "select"],
    ["measurements", "select"], ["order_checklist_items", "select"], ["order_checklist_items", "update"], ["clients", "select"],
  ];
  let permissionError = false;
  const permissions = await Promise.all(rights.map(async ([resource, action]) => {
    const result = await db.rpc("has_table_access", { resource, action });
    if (result.error) permissionError = true;
    return [`${resource}:${action}`, !result.error && result.data === true] as const;
  }));
  const access = Object.fromEntries(permissions);
  const empty = { data: [], error: null };
  const [orderResult, quoteResult, entriesResult] = await Promise.all([
    access["orders:select"] ? db.from("orders").select("id,order_number,operational_status,next_action,blocked_reason").eq("sale_id", id).eq("company_id", sale.company_id).maybeSingle() : { data: null, error: null },
    access["quotes:select"] ? db.from("quotes").select("id,quote_number").eq("sale_id", id).eq("company_id", sale.company_id).maybeSingle() : { data: null, error: null },
    access["financial_entries:select"] ? db.from("financial_entries").select("id,description,total_amount,paid_amount,open_amount,due_date,status,interest_amount,discount_amount,installment_count,first_installment_due_date").eq("sale_id", id).eq("company_id", sale.company_id).eq("entry_type", "receber").order("due_date").order("id") : empty,
  ]);
  const order = orderResult.data as SaleOrder | null;
  const quote = quoteResult.data as SaleWorkspaceData["quote"];
  const measurementFilter = [order && `order_id.eq.${order.id}`, quote && `quote_id.eq.${quote.id}`].filter(Boolean).join(",");
  const [checklistResult, measurementsResult] = await Promise.all([
    order && access["order_checklist_items:select"] ? db.from("order_checklist_items").select("id,title,status,completed_at,sort_order").eq("order_id", order.id).eq("company_id", sale.company_id).order("sort_order") : empty,
    measurementFilter && access["measurements:select"] ? db.from("measurements").select("id,measurement_number,status,scheduled_at").eq("company_id", sale.company_id).or(measurementFilter).order("created_at", { ascending: false }) : empty,
  ]);
  const warnings = [
    permissionError && "Não foi possível verificar todas as permissões desta venda.",
    orderResult.error && "Não foi possível carregar o pedido.", quoteResult.error && "Não foi possível carregar o orçamento.",
    entriesResult.error && "Não foi possível carregar as contas a receber.", checklistResult.error && "Não foi possível carregar as etapas do pedido.",
    measurementsResult.error && "Não foi possível carregar as medições.",
  ].filter(Boolean) as string[];
  return { sale, order, quote, entries: (entriesResult.data ?? []) as SaleEntry[], checklist: (checklistResult.data ?? []) as SaleChecklistItem[], measurements: (measurementsResult.data ?? []) as SaleMeasurement[], access, warnings };
}
