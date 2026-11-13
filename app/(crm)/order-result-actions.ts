"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseBRNumber } from "@/lib/br-number";
import { friendlyError } from "@/lib/friendly-error";
import { safeBack, q } from "@/lib/back-url";

const base = "/financeiro/obras";

/** Custo previsto de uma obra. Em branco remove a previsao. */
export async function saveExpectedCost(form: FormData) {
  const requested = safeBack(form.get("_back"), base);
  const back = requested.startsWith(base) ? requested : base;
  const id = String(form.get("order_id") || "");
  const raw = String(form.get("expected_cost") || "").trim();
  const amount = raw ? parseBRNumber(raw) : null;
  if (!z.uuid().safeParse(id).success) redirect(`${q(back)}erro=Obra+inválida`);
  if (raw && (amount === null || !Number.isFinite(amount) || amount < 0)) redirect(`${q(back)}erro=${encodeURIComponent("Custo previsto inválido. Use por exemplo 1.500,00")}`);
  const db = await createClient();
  const { error } = await db.rpc("set_order_expected_cost", { p_order_id: id, p_amount: amount });
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(friendlyError(error.message) ?? "Não foi possível salvar.")}`);
  revalidatePath(base);
  redirect(`${q(back)}salvo=1`);
}
