import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { catalogModelUrl, catalogPieceForProduct } from "./gutter-catalog";

export async function quotePieceMedia(product: string, embed: boolean) {
  const piece = catalogPieceForProduct(product);
  if (!piece) return null;
  const url = catalogModelUrl(piece);
  const [qr, drawing] = await Promise.all([
    QRCode.toDataURL(url, { errorCorrectionLevel: "M", width: 192, margin: 4 }),
    embed ? readFile(path.join(process.cwd(), "public", "catalogo", "pecas-impressao", `${piece.id}.png`)) : null,
  ]);
  return { piece, url, qr, image: drawing ? `data:image/png;base64,${drawing.toString("base64")}` : `/catalogo/pecas-impressao/${piece.id}.png` };
}
