// Abre o PDF do recibo de uma baixa (quem vê o financeiro da empresa).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { operationsDb } from "@/lib/operations";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return NextResponse.json({ error: "Pagamento inválido." }, { status: 400 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  // RLS: só recibos da própria empresa e para quem vê pagamentos.
  const { data: receipt } = await db.from("payment_receipts").select("company_id,receipt_number,pdf_path,status").eq("payment_id", paymentId).maybeSingle();
  if (!receipt) return NextResponse.json({ error: "Recibo não encontrado." }, { status: 404 });
  if (!receipt.pdf_path || !receipt.pdf_path.startsWith(`${receipt.company_id}/`)) return NextResponse.json({ error: "Recibo ainda sendo gerado. Tente em instantes." }, { status: 404 });
  const { data: file } = await operationsDb().storage.from("payment-receipts").download(receipt.pdf_path);
  if (!file) return NextResponse.json({ error: "Arquivo indisponível." }, { status: 404 });
  const name = `Recibo-${String(receipt.receipt_number).padStart(6, "0")}.pdf`;
  return new NextResponse(await file.arrayBuffer(), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
