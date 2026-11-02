import catalog from "./marquinhos-catalog.json";

export const MARQUINHOS_CATALOG = catalog;
export type CatalogPiece = typeof catalog.pieces[number];
export const normalizeProductName = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Similar profiles are not interchangeable: match documented names/aliases only.
export function catalogPieceForProduct(product: string): CatalogPiece | undefined {
  const name = normalizeProductName(product);
  return catalog.pieces.find(piece => [piece.name, ...piece.aliases].some(alias => normalizeProductName(alias) === name));
}
export function catalogModelUrl(piece: CatalogPiece) {
  return `${catalog.source}pecas-3d.html#${piece.id}`;
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
