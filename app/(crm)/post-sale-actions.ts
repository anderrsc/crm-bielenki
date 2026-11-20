"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/friendly-error";
import { q } from "@/lib/back-url";

const uuid = z.uuid();
const back = (form: FormData) => String(form.get("_back") || "/pos-venda");

export async function createPostSale(formData: FormData) {
 const b = back(formData);
 const orderId = String(formData.get("order_id") || "");
 const clientId = String(formData.get("client_id") || "");
 const type = String(formData.get("type") || "");
 const title = String(formData.get("title") || "").trim();
 const description = String(formData.get("description") || "").trim().slice(0, 2000) || null;
 const priority = String(formData.get("priority") || "normal");
 const rating = formData.get("rating") ? Number(formData.get("rating")) : null;

 if (!uuid.safeParse(orderId).success) redirect(`${q(b)}erro=Pedido+inválido`);
 if (!uuid.safeParse(clientId).success) redirect(`${q(b)}erro=Cliente+inválido`);
 if (!["avaliacao", "problema", "retorno_garantia", "retorno_fora_garantia", "follow_up"].includes(type))
 redirect(`${q(b)}erro=Tipo+de+pós-venda+inválido`);
 if (!title || title.length < 3) redirect(`${q(b)}erro=Informe+um+título+(mínimo+3+caracteres)`);
 if (rating !== null && (rating < 1 || rating > 5)) redirect(`${q(b)}erro=Avaliação+deve+ser+entre+1+e+5`);

 const db = await createClient();
 const { data: profile } = await db.from("profiles").select("company_id").single();
 if (!profile?.company_id) redirect(`${q(b)}erro=Empresa+não+identificada`);

 const { error } = await db.from("post_sales").insert({
 company_id: profile.company_id,
 order_id: orderId,
 client_id: clientId,
 type,
 title,
 description,
 priority,
 rating,
 status: "aberto",
 created_by: (await db.auth.getUser()).data.user?.id ?? null,
 });
 if (error) redirect(`${q(b)}erro=${encodeURIComponent(friendlyError(error.message) ?? "Não foi possível criar o pós-venda")}`);

 // Registra no histórico
 const { data: ps } = await db.from("post_sales").select("id").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
 if (ps) {
 await db.from("post_sale_history").insert({
 company_id: profile.company_id, post_sale_id: ps.id, action: "CRIADO", new_value: type, created_by: (await db.auth.getUser()).data.user?.id ?? null,
 }).then(() => undefined, () => undefined);
 }

 revalidatePath("/pos-venda");
 revalidatePath("/dashboard");
 redirect(`${q(b)}ok=Pós-venda+criado`);
}

export async function resolvePostSale(formData: FormData) {
 const b = back(formData);
 const postSaleId = String(formData.get("post_sale_id") || "");
 const notes = String(formData.get("resolution_notes") || "").trim().slice(0, 2000) || null;
 if (!uuid.safeParse(postSaleId).success) redirect(`${q(b)}erro=Pós-venda+inválido`);

 const db = await createClient();
 const { error } = await db.rpc("resolve_post_sale", { p_post_sale_id: postSaleId, p_resolution_notes: notes });
 if (error) redirect(`${q(b)}erro=${encodeURIComponent(friendlyError(error.message) ?? "Não foi possível resolver")}`);

 revalidatePath("/pos-venda");
 revalidatePath("/dashboard");
 redirect(`${q(b)}ok=Pós-venda+resolvido`);
}

export async function updatePostSaleStatus(formData: FormData) {
 const b = back(formData);
 const postSaleId = String(formData.get("post_sale_id") || "");
 const status = String(formData.get("status") || "");
 if (!uuid.safeParse(postSaleId).success) redirect(`${q(b)}erro=Pós-venda+inválido`);
 if (!["aberto", "em_andamento", "resolvido", "cancelado"].includes(status)) redirect(`${q(b)}erro=Status+inválido`);

 const db = await createClient();
 const { error } = await db.from("post_sales").update({ status }).eq("id", postSaleId);
 if (error) redirect(`${q(b)}erro=${encodeURIComponent(friendlyError(error.message) ?? "Não foi possível atualizar")}`);

 // Registra mudança no histórico
 const user = (await db.auth.getUser()).data.user;
 await db.from("post_sale_history").insert({
 company_id: (await db.from("profiles").select("company_id").single()).data?.company_id,
 post_sale_id: postSaleId, action: "STATUS_ALTERADO", new_value: status, created_by: user?.id ?? null,
 }).then(() => undefined, () => undefined);

 revalidatePath("/pos-venda");
 redirect(`${q(b)}ok=Status+atualizado`);
}