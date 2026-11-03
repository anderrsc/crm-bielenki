import { catalogPieceForProduct, normalizeProductName } from "./gutter-catalog";
import { normalizeGutterColor, sameThickness, type GutterPrice } from "./gutters";

export type GutterQuoteRates = {
  matrix: { thickness: string; cut_mm: number; price_per_meter: number }[];
  paints: { color: string; price_per_meter: number }[];
};

type Piece = { product: string; thickness: string; cut: string; color: string };

export function fabricatedMeterPrice(prices: GutterPrice[], rates: GutterQuoteRates, item: Piece): number | undefined {
  const cut = Number(item.cut.replace(/\D/g, ""));
  const product = normalizeProductName(item.product);
  const color = normalizeProductName(normalizeGutterColor(item.color));
  const natural = "aluminio natural";
  const matches = prices.filter(row =>
    row.active && normalizeProductName(row.product) === product &&
    sameThickness(row.thickness, item.thickness) && row.cut_mm === cut
  );
  const exact = matches.find(row => normalizeProductName(normalizeGutterColor(row.color)) === color);
  const paint = color === natural ? 0 : Number(rates.paints.find(row =>
    normalizeProductName(normalizeGutterColor(row.color)) === color
  )?.price_per_meter ?? 0);

  if (catalogPieceForProduct(item.product)?.id === "calha-beiral" || product.startsWith("calha de beiral")) {
    if (exact) return Number(exact.unit_price);
    const base = matches.find(row => normalizeProductName(normalizeGutterColor(row.color)) === natural);
    return base ? Number(base.unit_price) + paint : undefined;
  }

  const base = rates.matrix.find(row => sameThickness(row.thickness, item.thickness) && row.cut_mm === cut);
  return base ? Number(base.price_per_meter) + paint : exact ? Number(exact.unit_price) : undefined;
}
