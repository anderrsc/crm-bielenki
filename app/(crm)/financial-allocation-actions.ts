"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/friendly-error";

const base = "/financeiro/rateios";
const rowSchema = z.object({
  order_id: z.uuid().or(z.literal("")).default(""),
  cost_center_id: z.uuid().or(z.literal("")).default(""),
  amount: z.number().positive().optional(),
  percent: z.number().positive().max(100).optional(),
}).refine((r) => r.order_id || r.cost_center_id, "Informe a obra ou o centro de custos");

/** Grava (ou remove, com lista vazia) o rateio de uma conta. A soma e conferida no banco. */
export async function saveFinancialAllocations(form: FormData) {
  const entryId = String(form.get("entry_id") || "");
  if (!z.uuid().safeParse(entryId).success) redirect(`${base}?erro=Conta+inválida`);
  const back = `${base}?conta=${entryId}`;
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("rows") || "[]")); } catch { redirect(`${back}&erro=Rateio+inválido`); }
  const parsed = z.array(rowSchema).max(50).safeParse(raw);
  if (!parsed.success) redirect(`${back}&erro=${encodeURIComponent("Revise as linhas: cada uma precisa de obra ou centro de custos e de um valor.")}`);
  const mode = form.get("mode") === "percent" ? "percent" : "amount";
  const rows = parsed.data.map((r) => ({
    order_id: r.order_id || null, cost_center_id: r.cost_center_id || null,
    ...(mode === "percent" ? { percent: r.percent } : { amount: r.amount }),
  }));
  if (rows.some((r) => (mode === "percent" ? !("percent" in r) || !r.percent : !("amount" in r) || !r.amount))) {
    redirect(`${back}&erro=${encodeURIComponent("Preencha o valor de todas as linhas.")}`);
  }
  const db = await createClient();
  const { error } = await db.rpc("set_financial_entry_allocations", { p_entry_id: entryId, p_rows: rows });
  if (error) redirect(`${back}&erro=${encodeURIComponent(friendlyError(error.message) ?? "Não foi possível salvar o rateio.")}`);
  revalidatePath(base); revalidatePath("/financeiro");
  redirect(`${back}&salvo=1`);
}
