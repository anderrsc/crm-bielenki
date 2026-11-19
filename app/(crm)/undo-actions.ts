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

/** Desfaz várias entradas de estoque de uma vez (seleção múltipla). */
export async function undoStockReceipts(form: FormData) {
  const back = safeBack(form.get("_back"), "/compras");
  const ids = form.getAll("movement_ids").map(String);
  const p = z.object({ ids: z.array(z.uuid()).min(1).max(200), reason: z.string().trim().min(3).max(500) }).safeParse({ ids, reason: form.get("reason") });
  // Nada marcado é orientação, não falha: volta com um aviso em vez de erro.
  if (!ids.length) redirect(`${q(back)}aviso=${encodeURIComponent("Marque ao menos uma entrada para desfazer.")}`);
  if (!p.success) redirect(`${q(back)}erro=${encodeURIComponent("Informe o motivo para desfazer as entradas")}`);
  const db = await createClient();
  const { data, error } = await db.rpc("undo_stock_receipts", { p_movement_ids: p.data.ids, p_reason: p.data.reason });
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(error.message)}`);
  for (const r of ["/compras", "/estoque", "/producao", "/producao/materiais-do-pedido", back.split("?")[0]]) revalidatePath(r);
  const r = (data ?? {}) as { undone?: number; skipped?: number };
  redirect(`${q(back)}ok=${encodeURIComponent(`${r.undone ?? 0} entrada(s) desfeita(s)${r.skipped ? `, ${r.skipped} já estavam desfeitas` : ""}`)}`);
}
