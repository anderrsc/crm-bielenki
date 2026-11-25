// Abre o arquivo (nota/orçamento do fornecedor) anexado a uma compra. A permissão é a da própria
// compra: se a pessoa não enxerga a compra (RLS), não abre o arquivo.
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Compra inválida." }, { status: 400 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const { data: po } = await db.from("purchase_orders").select("company_id,attachment_path,attachment_name,attachment_type").eq("id", id).maybeSingle();
  if (!po?.attachment_path || !String(po.attachment_path).startsWith(`${po.company_id}/`)) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "not_configured" }, { status: 500 });
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: file } = await admin.storage.from("compras").download(po.attachment_path);
  if (!file) return NextResponse.json({ error: "Arquivo indisponível." }, { status: 404 });
  const type = /^(application\/pdf|image\/(jpeg|png|webp))$/.test(po.attachment_type ?? "") ? po.attachment_type! : "application/octet-stream";
  const name = (po.attachment_name || "arquivo").replace(/[^\w.\- ]/g, "_");
  return new NextResponse(await file.arrayBuffer(), { headers: { "Content-Type": type, "Content-Disposition": `${type === "application/octet-stream" ? "attachment" : "inline"}; filename="${name}"`, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
