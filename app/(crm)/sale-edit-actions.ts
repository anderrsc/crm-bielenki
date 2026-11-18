"use server";
// Corrigir ou cancelar venda lançada à mão (tela da venda).
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { q } from "@/lib/back-url";

function refresh(back: string) { for (const r of ["/vendas", "/financeiro", "/financeiro/receber", "/dashboard", back]) revalidatePath(r); }

export async function editManualSale(form: FormData) {
  const id = String(form.get("id") ?? "");
  const back = `/vendas/${z.uuid().safeParse(id).success ? id : ""}`;
  let payload: unknown;
  try { payload = JSON.parse(String(form.get("payload") ?? "{}")); } catch { redirect(`${q(back)}erro=Dados+inválidos`); }
  const p = z.object({ client_id: z.uuid().or(z.literal("")), due_date: z.string(), notes: z.string().max(2000),
    items: z.array(z.object({ id: z.uuid(), description: z.string().max(500), quantity: z.number().positive(), unit_price: z.number().nonnegative() })) }).safeParse(payload);
  if (!z.uuid().safeParse(id).success || !p.success) redirect(`${q(back)}erro=${encodeURIComponent("Revise os dados da venda")}`);
  const db = await createClient();
  const { error } = await db.rpc("update_manual_sale", { p_id: id, p_payload: p.data });
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(error.message)}`);
  refresh(back); redirect(`${q(back)}ok=${encodeURIComponent("Venda corrigida")}`);
}

export async function cancelManualSale(form: FormData) {
  const p = z.object({ id: z.uuid(), reason: z.string().trim().min(3).max(500) }).safeParse(Object.fromEntries(form));
  const back = `/vendas/${p.success ? p.data.id : ""}`;
  if (!p.success) redirect(`${q(back)}erro=${encodeURIComponent("Informe o motivo do cancelamento")}`);
  const db = await createClient();
  const { error } = await db.rpc("cancel_manual_sale", { p_id: p.data.id, p_reason: p.data.reason });
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(error.message)}`);
  refresh(back); redirect(`${q(back)}ok=${encodeURIComponent("Venda cancelada")}`);
}
