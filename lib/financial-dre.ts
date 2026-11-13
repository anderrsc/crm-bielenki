// DRE gerencial: monta as 11 linhas a partir das linhas por mes/grupo/categoria vindas do banco.
export type DreLine = { month: string; grp: string; category: string; amount: number };
export type DreGroup = "receita" | "deducao" | "custo" | "comercial" | "administrativa" | "outras" | "financeiro";
export const DRE_GROUP_LABEL: Record<DreGroup, string> = {
  receita: "Receita", deducao: "Deduções e impostos sobre receita", custo: "Custos dos serviços e produtos vendidos",
  comercial: "Despesas comerciais", administrativa: "Despesas administrativas", outras: "Outras despesas operacionais", financeiro: "Resultado financeiro",
};
/** Linhas que cada tipo de conta pode usar. */
export const DRE_GROUPS_BY_TYPE: Record<"pagar" | "receber", DreGroup[]> = {
  receber: ["receita", "financeiro"],
  pagar: ["deducao", "custo", "comercial", "administrativa", "outras", "financeiro"],
};

export type DreRow = {
  key: string; label: string; kind: "total" | "group";
  /** Sinal de exibicao: despesas aparecem negativas. */
  values: number[]; total: number;
  details?: { category: string; values: number[]; total: number }[];
};

const cents = (n: number) => Math.round(n * 100);

export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.slice(0, 7).split("-").map(Number);
  const [ey, em] = end.slice(0, 7).split("-").map(Number);
  while ((y < ey || (y === ey && m <= em)) && out.length < 36) { out.push(`${y}-${String(m).padStart(2, "0")}-01`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

export function buildDre(lines: DreLine[], months: string[]): DreRow[] {
  const index = new Map(months.map((m, i) => [m.slice(0, 7), i]));
  const groups = new Map<string, Map<string, number[]>>();
  for (const line of lines) {
    const i = index.get(String(line.month).slice(0, 7));
    if (i === undefined) continue;
    const g = groups.get(line.grp) ?? groups.set(line.grp, new Map()).get(line.grp)!;
    const row = g.get(line.category) ?? g.set(line.category, months.map(() => 0)).get(line.category)!;
    row[i] += cents(Number(line.amount));
  }
  const sum = (grp: string) => months.map((_, i) => [...(groups.get(grp)?.values() ?? [])].reduce((s, v) => s + v[i], 0));
  const sub = (a: number[], ...rest: number[][]) => a.map((v, i) => rest.reduce((s, r) => s - r[i], v));
  const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
  const neg = (a: number[]) => a.map((v) => -v);
  const row = (key: string, label: string, values: number[], kind: "total" | "group", grp?: string, sign = 1): DreRow => ({
    key, label, kind, values: values.map((v) => v / 100), total: values.reduce((s, v) => s + v, 0) / 100,
    details: grp ? [...(groups.get(grp)?.entries() ?? [])].map(([category, v]) => ({ category, values: v.map((x) => (x * sign) / 100), total: (v.reduce((s, x) => s + x, 0) * sign) / 100 }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)) : undefined,
  });
  const receita = sum("receita"), deducao = sum("deducao"), custo = sum("custo"), comercial = sum("comercial"), adm = sum("administrativa"), outras = sum("outras"), fin = sum("financeiro");
  const liquida = sub(receita, deducao), bruto = sub(liquida, custo), operacional = sub(bruto, comercial, adm, outras), final = add(operacional, fin);
  return [
    row("receita_bruta", "1. Receita bruta", receita, "group", "receita"),
    row("deducoes", "2. Deduções e impostos sobre receita", neg(deducao), "group", "deducao", -1),
    row("receita_liquida", "3. Receita líquida", liquida, "total"),
    row("custos", "4. Custos dos serviços e produtos vendidos", neg(custo), "group", "custo", -1),
    row("lucro_bruto", "5. Lucro bruto", bruto, "total"),
    row("comerciais", "6. Despesas comerciais", neg(comercial), "group", "comercial", -1),
    row("administrativas", "7. Despesas administrativas", neg(adm), "group", "administrativa", -1),
    row("outras", "8. Outras despesas operacionais", neg(outras), "group", "outras", -1),
    row("operacional", "9. Resultado operacional", operacional, "total"),
    row("financeiro", "10. Resultado financeiro", fin, "group", "financeiro"),
    row("resultado", "11. Resultado gerencial do período", final, "total"),
  ];
}
