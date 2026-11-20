"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/friendly-error";
import { q } from "@/lib/back-url";

const uuid = z.uuid();
const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function uploadProductionStepPhoto(formData: FormData) {
 const back = String(formData.get("_back") || "/producao");
 const orderId = String(formData.get("order_id") || "");
 const productionOrderId = String(formData.get("production_order_id") || "");
 const stepNumber = Number(formData.get("step_number"));
 const caption = String(formData.get("caption") || "").trim().slice(0, 300) || null;
 const file = formData.get("photo");

 if (!uuid.safeParse(productionOrderId).success) redirect(`${q(back)}erro=Ordem+de+produção+inválida`);
 if (!Number.isInteger(stepNumber) || stepNumber < 1) redirect(`${q(back)}erro=Etapa+inválida`);
 if (!(file instanceof File) || file.size === 0) redirect(`${q(back)}erro=Selecione+uma+foto`);
 if (file.size > MAX_PHOTO_SIZE) redirect(`${q(back)}erro=A+foto+deve+ter+no+máximo+5MB`);
 if (!ALLOWED_TYPES.includes(file.type)) redirect(`${q(back)}erro=Formato+não+suportado.+Use+JPG,+PNG+ou+WebP`);

 const db = await createClient();
 const { data: profile } = await db.from("profiles").select("company_id").single();
 if (!profile?.company_id) redirect(`${q(back)}erro=Empresa+não+identificada`);

 // Upload para Storage
 const ext = file.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
 const path = `${profile.company_id}/production/${productionOrderId}/step-${stepNumber}/${Date.now()}.${ext}`;
 const { error: uploadError } = await db.storage.from("service-photos").upload(path, file, { contentType: file.type, upsert: false });
 if (uploadError) redirect(`${q(back)}erro=${encodeURIComponent(friendlyError(uploadError.message) ?? "Falha ao enviar foto")}`);

 const { data: urlData } = db.storage.from("service-photos").getPublicUrl(path);
 const photoUrl = urlData.publicUrl;

 // Registra no banco via RPC
 const { error: rpcError } = await db.rpc("add_production_step_photo", {
 p_production_order_id: productionOrderId,
 p_step_number: stepNumber,
 p_photo_url: photoUrl,
 p_caption: caption,
 });
 if (rpcError) redirect(`${q(back)}erro=${encodeURIComponent(friendlyError(rpcError.message) ?? "Não foi possível registrar a foto")}`);

 revalidatePath("/producao");
 revalidatePath(`/producao/${orderId}`);
 redirect(`${q(back)}ok=Foto+adicionada`);
}

export async function deleteProductionStepPhoto(formData: FormData) {
 const back = String(formData.get("_back") || "/producao");
 const photoId = String(formData.get("photo_id") || "");
 if (!uuid.safeParse(photoId).success) redirect(`${q(back)}erro=Foto+inválida`);

 const db = await createClient();
 const { error } = await db.from("production_step_photos").delete().eq("id", photoId);
 if (error) redirect(`${q(back)}erro=${encodeURIComponent(friendlyError(error.message) ?? "Não foi possível remover a foto")}`);

 revalidatePath("/producao");
 redirect(`${q(back)}ok=Foto+removida`);
}