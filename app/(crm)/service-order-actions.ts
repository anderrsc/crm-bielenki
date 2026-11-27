"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/** Define quem vai instalar (usuário do CRM ou só o nome). Sai na ordem de serviço. */
export async function setOrderInstaller(input: { saleId: string; orderId: string; profileId?: string | null; name?: string | null }) {
  const ids = z.object({ saleId: z.string().uuid(), orderId: z.string().uuid() }).safeParse(input);
  if (!ids.success) return { error: "Pedido inválido" };
  const profileId = input.profileId && z.string().uuid().safeParse(input.profileId).success ? input.profileId : null;
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  const db = await createClient();
  const { error } = await db.rpc("set_order_installer", { p_order_id: ids.data.orderId, p_profile_id: profileId, p_name: name });
  if (error) return { error: /set_order_installer|function/.test(error.message) ? "Falta aplicar a atualização do banco 20261127100000_ordem_servico.sql." : error.message };
  revalidatePath(`/vendas/${ids.data.saleId}/os`);
  revalidatePath(`/vendas/${ids.data.saleId}`);
  return { error: null };
}
