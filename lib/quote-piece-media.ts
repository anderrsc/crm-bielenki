import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { catalogImagePath, catalogModelUrl, catalogPieceForProduct } from "./gutter-catalog";

export async function quotePieceMedia(product: string, embed: boolean) {
  const piece = catalogPieceForProduct(product);
  if (!piece) return null;
  const url = catalogModelUrl(piece);
  const [qr, drawing, installed] = await Promise.all([
    QRCode.toDataURL(url, { errorCorrectionLevel: "M", width: 192, margin: 4 }),
    embed ? readFile(path.join(process.cwd(), "public", "catalogo", "pecas", `${piece.id}.png`)) : null,
    embed ? readFile(path.join(process.cwd(), "public", "catalogo", "obra", `${piece.id}.png`)) : null,
  ]);
  return { piece, url, qr, image: drawing ? `data:image/png;base64,${drawing.toString("base64")}` : catalogImagePath(piece), installed: installed ? `data:image/png;base64,${installed.toString("base64")}` : `/catalogo/obra/${piece.id}.png` };
}
