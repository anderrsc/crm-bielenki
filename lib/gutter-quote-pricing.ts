import { MARQUINHOS_CATALOG, catalogPieceForProduct, normalizeProductName } from "./gutter-catalog";
import { normalizeGutterColor, sameThickness, type GutterPrice } from "./gutters";

export type GutterQuoteRates = {
  matrix: { thickness: string; cut_mm: number; price_per_meter: number }[];
  paints: { color: string; price_per_meter: number }[];
};

export const automaticPaintPrefix = "Mão de obra e materiais necessários para pintura na cor ";

const natural = "aluminio natural";
const colorKey = (color: string | null | undefined) => normalizeProductName(normalizeGutterColor(color));

export function paintMeterPrice(rates: GutterQuoteRates, color: string): number | undefined {
  if (colorKey(color) === natural) return undefined;
  const key = colorKey(color).replace(/^pintura /, "");
  const rate = rates.paints.find(row => colorKey(row.color).replace(/^pintura /, "") === key);
  return rate ? Number(rate.price_per_meter) : undefined;
}

export function automaticPaintItems(items: { color: string; quantity: number; meters: number }[], rates: GutterQuoteRates) {
  const byColor = new Map<string, { color: string; meters: number }>();
  for (const item of items) {
    const key = colorKey(item.color).replace(/^pintura /, "");
    const meters = item.quantity * item.meters;
    if (key === natural || meters <= 0) continue;
    const previous = byColor.get(key);
    byColor.set(key, {
      color: normalizeGutterColor(item.color).replace(/^Pintura\s+/i, ""),
      meters: (previous?.meters ?? 0) + meters,
    });
  }
  return [...byColor.values()].map(({ color, meters }) => {
    const rate = paintMeterPrice(rates, color);
    return {
      product: automaticPaintPrefix + color,
      description: "",
      item_type: "Serviços" as const,
      unit: "metro",
      quantity: meters,
      unit_price: rate ?? 0,
      rateMissing: rate === undefined,
    };
  });
}

type Piece = { product: string; thickness: string; cut: string; color: string };

export function fabricatedMeterPrice(prices: GutterPrice[], rates: GutterQuoteRates, item: Piece): number | undefined {
  const cut = Number(item.cut.replace(/\D/g, ""));
  const product = normalizeProductName(item.product);
  const matches = prices.filter(row =>
    row.active && normalizeProductName(row.product) === product &&
    sameThickness(row.thickness, item.thickness) && row.cut_mm === cut
  );
  const naturalRate = matches.find(row => colorKey(row.color) === natural);

  if (catalogPieceForProduct(item.product)?.id === "calha-beiral" || product.startsWith("calha de beiral")) {
    if (naturalRate) return Number(naturalRate.unit_price);
    // Sem linha na tabela: preço comercial da versão simples para o corte.
    const commercial = MARQUINHOS_CATALOG.extras.find(extra => normalizeProductName(extra.product) === normalizeProductName(`Calha de beiral c/ ${cut} mm — Simples`));
    return commercial ? Number(commercial.price) : undefined;
  }

  const base = rates.matrix.find(row => sameThickness(row.thickness, item.thickness) && row.cut_mm === cut);
  return base ? Number(base.price_per_meter) : naturalRate ? Number(naturalRate.unit_price) : undefined;
}
