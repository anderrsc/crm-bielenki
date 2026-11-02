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
