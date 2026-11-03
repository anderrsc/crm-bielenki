import type { GutterQuoteRates } from "./gutter-quote-pricing";
import type { GutterPrice } from "./gutters";

type Db = Awaited<ReturnType<typeof import("./supabase/server").createClient>>;
export async function loadActiveGutterPrices(db: Db): Promise<GutterPrice[]> {
  const prices: GutterPrice[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await db.from("gutter_prices")
      .select("id,product,category,unit,thickness,cut_mm,color,unit_price,notes,active")
      .eq("active", true).order("id").range(start, start + 499);
    if (error) throw new Error(`Não foi possível carregar os preços: ${error.message}`);
    prices.push(...(data ?? []) as GutterPrice[]);
    if (!data || data.length < 500) return prices;
  }
}

export async function loadGutterQuoteRates(db: Db): Promise<GutterQuoteRates> {
  const [matrix, paints] = await Promise.all([
    db.from("aluminum_price_matrix").select("thickness,cut_mm,price_per_meter").order("updated_at", { ascending: false }).order("id"),
    db.from("pricing_paints").select("color,price_per_meter").eq("active", true).order("color"),
  ]);
  if (matrix.error || paints.error) {
    throw new Error(`Não foi possível carregar a tabela de preços: ${matrix.error?.message ?? paints.error?.message}`);
  }
  return { matrix: matrix.data ?? [], paints: paints.data ?? [] };
}
