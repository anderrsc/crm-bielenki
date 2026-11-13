import type { SupabaseClient } from "@supabase/supabase-js";

export type FinancialCategory = { id: string; name: string; entry_type: "pagar" | "receber"; active: boolean; dre_group?: string | null; report_group?: string | null };
export type FinancialCostCenter = { id: string; name: string; active: boolean };

/** Page through definitions rather than silently relying on the API row cap. */
export async function loadFinancialClassifications(db: SupabaseClient) {
  async function all<T>(table: string, columns: string) {
    const rows: T[] = [];
    for (let start = 0; ; start += 200) {
      const { data, error } = await db.from(table).select(columns).order("name").order("id").range(start, start + 199);
      if (error) throw new Error("Não foi possível carregar as classificações financeiras.");
      rows.push(...(data ?? []) as T[]);
      if (!data || data.length < 200) return rows;
    }
  }
  const [categories, centers] = await Promise.all([
    all<FinancialCategory>("financial_categories", "id,name,entry_type,active,dre_group,report_group"),
    all<FinancialCostCenter>("financial_cost_centers", "id,name,active"),
  ]);
  return { categories, centers };
}
