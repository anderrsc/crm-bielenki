import { catalogImagePath, catalogModelUrl, catalogPieceForProduct } from "@/lib/gutter-catalog";

export function GutterPiecePreview({ product }: { product: string }) {
  const piece = catalogPieceForProduct(product);
  if (!piece) return null;
  return <a href={catalogModelUrl(piece)} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-surface p-2 text-xs">
    {/* Original isometric drawing supplied in the PDF catalog. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={catalogImagePath(piece)} alt={`Peça ${piece.code}: ${piece.name}`} width={100} height={58} className="h-14 w-24 object-contain" />
    <span><b>Peça {piece.code} · {piece.name}</b><br /><span className="text-forest underline">Abrir modelo 3D interativo ↗</span></span>
  </a>;
}
