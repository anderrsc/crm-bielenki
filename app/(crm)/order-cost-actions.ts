"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/friendly-error";
import { q } from "@/lib/back-url";

const uuid = z.uuid();
const back = (form: FormData) => String(form.get("_back") || "/financeiro/obras");

// ─── Mão de obra ──────────────────────────────────────────────────────────────

export async function addOrderLabor(formData: FormData) {
 const b = back(formData);
 const orderId = String(formData.get("order_id") || "");
 const profileId = String(formData.get("profile_id") || "");
 const serviceType = String(formData.get("service_type") || "").trim();
 const hoursPlanned = Number(String(formData.get("hours_planned") || "0").replace(",", "."));
 const hoursActual = Number(String(formData.get("hours_actual") || "0").replace(",", "."));
 const costPerHour = Number(String(formData.get("cost_per_hour") || "0").replace(",", "."));
 const notes = String(formData.get("notes") || "").trim().slice(0, 500) || null;

 if (!uuid.safeParse(orderId).success) redirect(`${q(b)}erro=Pedido+inválido`);
 if (!uuid.safeParse(profileId).success) redirect(`${q(b)}erro=Funcionário+inválido`);
 if (!serviceType || serviceType.length < 2) redirect(`${q(b)}erro=Informe+o+tipo+de+serviço`);
 if (!Number.isFinite(hoursActual) || hoursActual < 0) redirect(`${q(b)}erro=Horas+realizadas+inválidas`);
 if (!Number.isFinite(costPerHour) || costPerHour <= 0 || costPerHour >= 10000) redirect(`${q(b)}erro=Custo/hora+inválido+(entre+0,01+e+9.999,99)`);

 const db = await createClient();
 const { data: profile } = await db.from("profiles").select("company_id").single();
 if (!profile?.company_id) redirect(`${q(b)}erro=Empresa+não+identificada`);

 const user = (await db.auth.getUser()).data.user;
 const { error } = await db.from("order_labor_costs").insert({
 company_id: profile.company_id,
 order_id: orderId,
 profile_id: profileId,
 service_type: serviceType,
 hours_planned: Number.isFinite(hoursPlanned) && hoursPlanned >= 0 ? hoursPlanned : 0,
 hours_actual: hoursActual,
 cost_per_hour: costPerHour,
 notes,
 created_by: user?.id ?? null,
 });
 if (error) redirect(`${q(b)}erro=${encodeURIComponent(friendlyError(error.message) ?? "Não foi possível adicionar mão de obra")}`);

 revalidatePath("/financeiro/obras");
 revalidatePath(`/vendas/${orderId}`);
 redirect(`${q(b)}ok=Mão+de+obra+adicionada`);
}

export async function deleteOrderLabor(formData: FormData) {
 const b = back(formData);
 const laborId = String(formData.get("labor_id") || "");
 if (!uuid.safeParse(laborId).success) redirect(`${q(b)}erro=Registro+inválido`);

 const db = await createClient();
 const { error } = await db.from("order_labor_costs").delete().eq("id", laborId);
 if (error) redirect(`${q(b)}erro=${encodeURIComponent(friendlyError(error.message) ?? "Não foi possível remover")}`);

 revalidatePath("/financeiro/obras");
 redirect(`${q(b)}ok=Mão+de+obra+removida`);
}

// ─── Insumos / consumíveis ────────────────────────────────────────────────────

export async function addOrderConsumable(formData: FormData) {
 const b = back(formData);
 const orderId = String(formData.get("order_id") || "");
 const description = String(formData.get("description") || "").trim();
 const unit = String(formData.get("unit") || "un").trim() || "un";
 const quantity = Number(String(formData.get("quantity") || "0").replace(",", "."));
 const unitCost = Number(String(formData.get("unit_cost") || "0").replace(",", "."));
 const category = String(formData.get("category") || "").trim().slice(0, 100) || null;
 const notes = String(formData.get("notes") || "").trim().slice(0, 500) || null;

 if (!uuid.safeParse(orderId).success) redirect(`${q(b)}erro=Pedido+inválido`);
 if (!description || description.length < 2) redirect(`${q(b)}erro=Informe+a+descrição+do+insumo`);
 if (!Number.isFinite(quantity) || quantity <= 0) redirect(`${q(b)}erro=Quantidade+deve+ser+maior+que+zero`);
 if (!Number.isFinite(unitCost) || unitCost < 0 || unitCost >= 100000) redirect(`${q(b)}erro=Custo+unitário+inválido`);

 const db = await createClient();
 const { data: profile } = await db.from("profiles").select("company_id").single();
 if (!profile?.company_id) redirect(`${q(b)}erro=Empresa+não+identificada`);

 const user = (await db.auth.getUser()).data.user;
 const { error } = await db.from("order_consumables").insert({
 company_id: profile.company_id,
 order_id: orderId,
 description,
 unit,
 quantity,
 unit_cost: unitCost,
 category,
 notes,
 created_by: user?.id ?? null,
 });
 if (error) redirect(`${q(b)}erro=${encodeURIComponent(friendlyError(error.message) ?? "Não foi possível adicionar insumo")}`);

 revalidatePath("/financeiro/obras");
 revalidatePath(`/vendas/${orderId}`);
 redirect(`${q(b)}ok=Insumo+adicionado`);
}

export async function deleteOrderConsumable(formData: FormData) {
 const b = back(formData);
 const consumableId = String(formData.get("consumable_id") || "");
 if (!uuid.safeParse(consumableId).success) redirect(`${q(b)}erro=Registro+inválido`);

 const db = await createClient();
 const { error } = await db.from("order_consumables").delete().eq("id", consumableId);
 if (error) redirect(`${q(b)}erro=${encodeURIComponent(friendlyError(error.message) ?? "Não foi possível remover")}`);

 revalidatePath("/financeiro/obras");
 redirect(`${q(b)}ok=Insumo+removido`);
}