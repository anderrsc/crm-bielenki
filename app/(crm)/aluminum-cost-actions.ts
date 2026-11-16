"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRequestClient } from "@/lib/supabase/server";
import { parseBRNumber } from "@/lib/br-number";
import { safeBack, q } from "@/lib/back-url";

export async function saveAluminumKgPrice(form: FormData) {
  const back = safeBack(form.get("_back"), "/tabela-calhas?aba=custo-aluminio");
  const price = parseBRNumber(form.get("price_per_kg"));
  if (price === null || price <= 0 || price >= 100000) redirect(`${q(back)}erro=${encodeURIComponent("Informe um preço por kg maior que zero.")}`);
  const db = await getRequestClient();
  const { error } = await db.rpc("save_aluminum_cost_price", { p_price: price });
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/tabela-calhas");
  revalidatePath("/configuracoes/tabela-calhas");
  revalidatePath("/orcamentos");
  redirect(`${q(back)}salvo=1`);
}
