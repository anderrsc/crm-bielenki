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

/** Etapa da impressão: "enviada" (mandou imprimir, falta confirmar), "impressa" (confirmou) ou "fila" (volta para a fila). */
export async function setOsPrint(orderIds: string[], step: "enviada" | "impressa" | "fila", serviceIds: string[] = []) {
  const clean = (list: string[]) => [...new Set(list)].filter(id => z.string().uuid().safeParse(id).success).slice(0, 200);
  const ids = clean(orderIds), services = clean(serviceIds);
  if (!ids.length && !services.length) return { error: "Nenhuma ordem selecionada", count: 0 };
  const db = await createClient();
  let count = 0;
  // Manutenções primeiro: se a atualização do banco delas faltar, nada dos pedidos fica pela metade.
  if (services.length) {
    const { data, error } = await db.rpc("set_services_os_print", { p_service_ids: services, p_step: step });
    if (error) return { error: /set_services_os_print|function/.test(error.message) ? "Falta aplicar a atualização do banco 20261127130000_fila_os_servicos.sql." : error.message, count };
    count += Number(data ?? 0);
  }
  if (ids.length) {
    const { data, error } = await db.rpc("set_orders_os_print", { p_order_ids: ids, p_step: step });
    if (error) return { error: /set_orders_os_print|function/.test(error.message) ? "Falta aplicar a atualização do banco 20261127120000_fila_ordens_servico.sql." : error.message, count };
    count += Number(data ?? 0);
  }
  revalidatePath("/ordens-servico"); revalidatePath("/dashboard");
  return { error: null, count };
}
