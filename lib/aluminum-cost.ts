export const ALUMINUM_WEIGHT_ROWS: { thickness: number; cut: number; kg: number }[] = [
  ...[[200,.271],[250,.339],[300,.406],[330,.448],[400,.542],[500,.678],[600,.813],[700,.949],[800,1.084],[1000,1.355],[1200,1.626]].map(([cut,kg])=>({thickness:.5,cut,kg})),
  ...[[300,.488],[400,.650],[500,.813],[600,.976],[1000,1.626],[1200,1.951]].map(([cut,kg])=>({thickness:.6,cut,kg})),
  ...[[300,.569],[400,.759],[500,.948],[600,1.138],[800,1.518],[1000,1.897],[1200,2.276]].map(([cut,kg])=>({thickness:.7,cut,kg})),
];
export type AluminumCalculation = {
  configured?: boolean; kg: number; price_per_kg: number; total_cost: number; excluded_items?: number;
  lines?: { product: string; thickness_mm: number; cut_mm: number; meters: number; kg_per_meter?: number; kg?: number; cost?: number; method: string }[];
  one_mm?: { kg: number; waste_kg: number; utilization_pct: number; patterns: { coil_width_mm: number; coil_meters: number; kg: number; waste_mm: number; cuts: { cut_mm: number; strips: number }[] }[] };
};
export const kgText = (value: number) => Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
