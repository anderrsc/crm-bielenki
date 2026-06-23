"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { PriceRow } from "@/components/pricing-spreadsheet";

export async function bulkSavePrices(
  rows: PriceRow[],
  deleteIds: string[]
): Promise<{ error?: string } | void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Supabase não configurado" };
  const db = await createClient();

  // Validações
  for (const r of rows) {
    if (!r.product?.trim()) return { error: `Produto sem nome na linha ${rows.indexOf(r) + 1}` };
    if (r.unit_price < 0) return { error: `Preço negativo em: ${r.product}` };
    if (r.margin_pct < 0 || r.margin_pct > 100) return { error: `Margem inválida em: ${r.product}` };
    if (r.max_discount_pct < 0 || r.max_discount_pct > 100) return { error: `Desconto inválido em: ${r.product}` };
  }

  // Deletes
  if (deleteIds.length) {
    const { error } = await db.from("gutter_prices").delete().in("id", deleteIds);
    if (error) return { error: error.message };
  }

  // Upserts via RPC bulk_save_prices
  if (rows.length) {
    const payload = rows.map(r => ({
      id: r.id.startsWith("new-") ? null : r.id,
      product: r.product.trim(),
      category: r.category,
      thickness: r.thickness,
      cut_mm: Number(r.cut_mm),
      unit: r.unit,
      color: r.color || null,
      unit_price: Number(r.unit_price) || 0,
      labor_price: Number(r.labor_price) || 0,
      paint_price: Number(r.paint_price) || 0,
      install_price: Number(r.install_price) || 0,
      freight_price: Number(r.freight_price) || 0,
      min_price: Number(r.min_price) || 0,
      margin_pct: Number(r.margin_pct) || 0,
      max_discount_pct: Number(r.max_discount_pct) || 0,
      notes: r.notes?.trim() || null,
      active: Boolean(r.active),
    }));

    const { error } = await db.rpc("bulk_save_prices", { p_rows: payload });
    if (error) return { error: error.message };
  }

  revalidatePath("/configuracoes/tabela-calhas");
  revalidatePath("/tabela-calhas");
  revalidatePath("/orcamentos/calhas");
}

export async function deletePriceRow(id: string): Promise<{ error?: string } | void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const db = await createClient();
  const { error } = await db.from("gutter_prices").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/configuracoes/tabela-calhas");
}

export async function addPriceRow(): Promise<{ error?: string } | void> {
  // handled client-side — row is added locally before bulk save
}

export async function getAllPrices(): Promise<PriceRow[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
  const db = await createClient();
  const { data: profile } = await db.from("profiles").select("company_id").single();
  if (!profile?.company_id) return [];

  const { data } = await db
    .from("gutter_prices")
    .select("id,product,category,thickness,cut_mm,unit,color,unit_price,labor_price,paint_price,install_price,freight_price,min_price,margin_pct,max_discount_pct,notes,active")
    .eq("company_id", profile.company_id)
    .order("category")
    .order("product")
    .order("thickness");

  return (data ?? []).map(r => ({
    id: r.id,
    product: r.product ?? "",
    category: r.category ?? "Calhas Padrão",
    thickness: r.thickness ?? "0.50",
    cut_mm: Number(r.cut_mm) || 200,
    unit: r.unit ?? "metro",
    color: r.color ?? null,
    unit_price: Number(r.unit_price) || 0,
    labor_price: Number(r.labor_price) || 0,
    paint_price: Number(r.paint_price) || 0,
    install_price: Number(r.install_price) || 0,
    freight_price: Number(r.freight_price) || 0,
    min_price: Number(r.min_price) || 0,
    margin_pct: Number(r.margin_pct) || 0,
    max_discount_pct: Number(r.max_discount_pct) || 0,
    notes: r.notes ?? null,
    active: Boolean(r.active),
  }));
}
