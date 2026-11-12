import type { FinancialCategory, FinancialCostCenter } from "@/lib/financial-classification";

export function FinancialClassificationFields({ categories, centers, type, categoryId = "", centerId = "" }: {
  categories: FinancialCategory[]; centers: FinancialCostCenter[]; type: "pagar" | "receber"; categoryId?: string | null; centerId?: string | null;
}) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <label className="block"><span className="label">Categoria financeira</span><select name="category_id" className="field" defaultValue={categoryId ?? ""}>
      <option value="">Sem classificação</option>
      {categories.filter(c => c.entry_type === type && (c.active || c.id === categoryId)).map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (inativa)"}</option>)}
    </select></label>
    <label className="block"><span className="label">Centro de custos</span><select name="cost_center_id" className="field" defaultValue={centerId ?? ""}>
      <option value="">Sem classificação</option>
      {centers.filter(c => c.active || c.id === centerId).map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (inativo)"}</option>)}
    </select></label>
  </div>;
}
