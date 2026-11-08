import { MARQUINHOS_CATALOG, catalogPieceForProduct, isBeiralProduct, isTwoFloors, normalizeProductName, withoutFloors } from "./gutter-catalog";
import { normalizeGutterColor, sameThickness, type GutterPrice } from "./gutters";

export type GutterQuoteRates = {
  matrix: { thickness: string; cut_mm: number; price_per_meter: number }[];
  paints: { color: string; price_per_meter: number }[];
};

export const automaticPaintPrefix = "Mão de obra e materiais necessários para pintura na cor ";

const natural = "aluminio natural";
const colorKey = (color: string | null | undefined) => normalizeProductName(normalizeGutterColor(color));

// Pintura: preço único por metro para qualquer cor (definido pela Marquinhos).
export const PAINT_PRICE_PER_METER = 40;

export function paintMeterPrice(_rates: GutterQuoteRates, color: string): number | undefined {
  if (colorKey(color) === natural) return undefined;
  return PAINT_PRICE_PER_METER;
}

export function automaticPaintItems(items: { color: string; quantity: number; meters: number }[], rates: GutterQuoteRates) {
  const byColor = new Map<string, { color: string; meters: number }>();
  for (const item of items) {
    const key = colorKey(item.color).replace(/^pintura /, "");
    const meters = item.quantity * item.meters;
    if (key === natural || !Number.isFinite(meters) || meters <= 0) continue;
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
  // "200 mm", "200,0 mm", "1.000 mm" → 200 / 200 / 1000
  const cut = Math.round(parseFloat(item.cut.replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) || 0);
  const product = normalizeProductName(item.product);
  const matches = prices.filter(row =>
    row.active && normalizeProductName(row.product) === product &&
    sameThickness(row.thickness, item.thickness) && row.cut_mm === cut
  );
  const naturalRate = matches.find(row => colorKey(row.color) === natural);

  if (catalogPieceForProduct(item.product)?.id === "calha-beiral" || isBeiralProduct(item.product)) {
    const commercial = (version: string) => {
      const row = MARQUINHOS_CATALOG.extras.find(extra => normalizeProductName(extra.product) === normalizeProductName(`Calha de beiral c/ ${cut} mm — ${version}`));
      return row ? Number(row.price) : undefined;
    };
    const naturalRow = (name: string) => prices.find(row =>
      row.active && normalizeProductName(row.product) === normalizeProductName(name) &&
      sameThickness(row.thickness, item.thickness) && row.cut_mm === cut && colorKey(row.color) === natural);
    const simpleRow = naturalRow(withoutFloors(item.product));
    const simple = simpleRow ? Number(simpleRow.unit_price) : commercial("Simples");
    if (!isTwoFloors(item.product)) return simple;
    // 2 pisos: linha própria na tabela; senão simples + diferença da tabela comercial.
    const twoRow = naturalRow(item.product);
    if (twoRow) return Number(twoRow.unit_price);
    const two = commercial("Dois pisos"), simpleCommercial = commercial("Simples");
    if (simpleRow && two !== undefined && simpleCommercial !== undefined) return Number(simpleRow.unit_price) + two - simpleCommercial;
    return two;
  }

  const base = rates.matrix.find(row => sameThickness(row.thickness, item.thickness) && row.cut_mm === cut);
  // Matriz com preço 0 (linha criada vazia) não vale: cai no preço da tabela; sem preço nenhum = undefined (aviso), nunca R$ 0.
  const matrixPrice = base ? Number(base.price_per_meter) : 0;
  if (matrixPrice > 0) return matrixPrice;
  const tablePrice = naturalRate ? Number(naturalRate.unit_price) : 0;
  return tablePrice > 0 ? tablePrice : undefined;
}
