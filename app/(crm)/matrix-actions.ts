"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { MatrixRow } from "@/components/aluminum-matrix";

export async function getMatrixRows(): Promise<MatrixRow[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
  const db = await createClient();
  const { data: profile } = await db.from("profiles").select("company_id").single();
  if (!profile?.company_id) return [];

  const { data } = await db
    .from("aluminum_price_matrix")
    .select("id,thickness,cut_mm,price_per_meter")
    .eq("company_id", profile.company_id)
    .order("thickness")
    .order("cut_mm");

  return (data ?? []).map((r) => ({
    id: r.id,
    thickness: r.thickness,
    cut_mm: Number(r.cut_mm),
    price_per_meter: Number(r.price_per_meter),
  }));
}

export async function saveMatrixRow(row: {
  id?: string;
  thickness: string;
  cut_mm: number;
  price_per_meter: number;
}): Promise<{ id?: string; error?: string }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Supabase não configurado" };
  const db = await createClient();
  const { data: profile } = await db.from("profiles").select("company_id").single();
  if (!profile?.company_id) return { error: "Empresa não encontrada" };

  if (row.id) {
    const { error } = await db
      .from("aluminum_price_matrix")
      .update({ cut_mm: row.cut_mm, price_per_meter: row.price_per_meter })
      .eq("id", row.id)
      .eq("company_id", profile.company_id);
    if (error) return { error: error.message };
    revalidatePath("/configuracoes/tabela-calhas");
    return { id: row.id };
  } else {
    const { data, error } = await db
      .from("aluminum_price_matrix")
      .insert({ company_id: profile.company_id, thickness: row.thickness, cut_mm: row.cut_mm, price_per_meter: row.price_per_meter })
      .select("id")
      .single();
    if (error) return { error: error.message };
    revalidatePath("/configuracoes/tabela-calhas");
    return { id: data.id };
  }
}

export async function deleteMatrixRow(id: string): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const db = await createClient();
  await db.from("aluminum_price_matrix").delete().eq("id", id);
  revalidatePath("/configuracoes/tabela-calhas");
}
