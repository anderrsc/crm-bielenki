import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fiscalCsv, type LinhaFiscal } from "@/lib/fiscal/export";

// Simulações fiscais por item, em CSV para o contador conferir. Valores SIMULADOS (não são tributo devido).
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre novamente." }, { status: 401 });
  const { data: pode } = await db.rpc("has_table_access", { resource: "fiscal", action: "select" });
  if (pode !== true) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const de = request.nextUrl.searchParams.get("de") ?? new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const ate = request.nextUrl.searchParams.get("ate") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });
  const { data, error } = await db.from("fiscal_calculation_items")
    .select("numero,produto,estado,base,cbs,ibs_uf,ibs_mun,ibs,is_valor,calc:fiscal_calculations!inner(created_at,data_fato_gerador,origem,simulado,versao_app,versao_db,quote:quotes(quote_number))")
    .gte("calc.created_at", `${de}T00:00:00-03:00`).lte("calc.created_at", `${ate}T23:59:59-03:00`).limit(20000);
  if (error) return NextResponse.json({ error: "Não foi possível exportar." }, { status: 500 });
  return new NextResponse(fiscalCsv((data ?? []) as unknown as LinhaFiscal[]), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="simulacoes-fiscais-${de}-a-${ate}.csv"` },
  });
}
