import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export async function addQuotePdfCredit(pdf: Uint8Array, company: string, author: string) {
  const document = await PDFDocument.load(pdf, { updateMetadata: false });
  const lastPage = document.getPage(document.getPageCount() - 1);
  const font = await document.embedFont(StandardFonts.Helvetica);

  // These coordinates fit inside the quote's 10 mm bottom margin.
  const left = (12 * 72) / 25.4;
  const right = lastPage.getWidth() - left;
  const size = 6;
  const color = rgb(0.37, 0.37, 0.40);

  lastPage.drawLine({
    start: { x: left, y: 23 },
    end: { x: right, y: 23 },
    thickness: 0.45,
    color: rgb(0.88, 0.88, 0.90),
  });
  lastPage.drawText(company, { x: left, y: 13, font, size, color });
  lastPage.drawText(author, { x: right - font.widthOfTextAtSize(author, size), y: 13, font, size, color });

  return document.save();
}
