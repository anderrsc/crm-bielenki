import catalog from "./marquinhos-catalog.json";

export const MARQUINHOS_CATALOG = catalog;
export type CatalogPiece = typeof catalog.pieces[number];
export const normalizeProductName = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Calha de beiral tem preço de 1 piso (simples) e de 2 pisos na tabela.
// O piso vai no nome do produto: "Calha de beiral (2 pisos)".
export const TWO_FLOORS_SUFFIX = " (2 pisos)";
const twoFloorsPattern = /\s*\(2 pisos\)\s*$/i;
export const isBeiralProduct = (product: string) => normalizeProductName(product).startsWith("calha de beiral");
export const isTwoFloors = (product: string) => twoFloorsPattern.test(product);
export const withoutFloors = (product: string) => product.replace(twoFloorsPattern, "");
export const withFloors = (product: string, floors: 1 | 2) => withoutFloors(product) + (floors === 2 ? TWO_FLOORS_SUFFIX : "");

// Similar profiles are not interchangeable: match documented names/aliases only.
export function catalogPieceForProduct(product: string): CatalogPiece | undefined {
  const name = normalizeProductName(withoutFloors(product));
  // "Rufo" alone does not identify which of the documented profiles was sold.
  if (name === "rufo") return undefined;
  const commercial = catalog.extras.find(item => normalizeProductName(item.product) === name);
  if (commercial && name.startsWith("calha de beiral c/")) return catalog.pieces.find(piece => piece.id === "calha-beiral");
  return catalog.pieces.find(piece => [piece.name, ...piece.aliases].some(alias => normalizeProductName(alias) === name));
}
export function catalogModelUrl(piece: CatalogPiece) {
  return `${catalog.source}${piece.model}`;
}
export function catalogImagePath(piece: CatalogPiece) {
  return `/catalogo/pecas/${piece.id}.png`;
}
export function uniqueProductNames(names: string[]) {
  const seen = new Set<string>();
  return names.filter(name => {
    const key = normalizeProductName(name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
