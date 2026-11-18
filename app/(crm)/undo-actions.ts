"use server";
// Desfazer: voltar etapa da produção e desfazer entrada de material no estoque.
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { q, safeBack } from "@/lib/back-url";

export async function productionStepBack(form: FormData) {
  const p = z.object({ id: z.uuid(), reason: z.string().trim().min(3).max(500) }).safeParse(Object.fromEntries(form));
  const back = `/producao/${p.success ? p.data.id : ""}`;
  if (!p.success) redirect(`${q(back)}erro=${encodeURIComponent("Informe o motivo para voltar a etapa")}`);
  const db = await createClient();
  const { error } = await db.rpc("production_step_back", { p_production_order_id: p.data.id, p_reason: p.data.reason });
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/producao"); revalidatePath(back);
  redirect(`${q(back)}aviso=${encodeURIComponent("Etapa reaberta")}`);
}

export async function undoStockReceipt(form: FormData) {
  const back = safeBack(form.get("_back"), "/compras");
  const p = z.object({ movement_id: z.uuid(), reason: z.string().trim().min(3).max(500) }).safeParse(Object.fromEntries(form));
  if (!p.success) redirect(`${q(back)}erro=${encodeURIComponent("Informe o motivo para desfazer a entrada")}`);
  const db = await createClient();
  const { error } = await db.rpc("undo_stock_receipt", { p_movement_id: p.data.movement_id, p_reason: p.data.reason });
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(error.message)}`);
  for (const r of ["/compras", "/estoque", "/producao", "/producao/materiais-do-pedido", back.split("?")[0]]) revalidatePath(r);
  redirect(`${q(back)}ok=${encodeURIComponent("Entrada no estoque desfeita")}`);
}
