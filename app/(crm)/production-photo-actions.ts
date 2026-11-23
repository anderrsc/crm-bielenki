"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/friendly-error";
import { q, safeBack } from "@/lib/back-url";
import { matchesAttachment } from "@/lib/whatsapp/attachments";

const uuid = z.uuid();
const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function uploadProductionStepPhoto(formData: FormData) {
 const back = safeBack(formData.get("_back"), "/producao");
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
 const { data: { user } } = await db.auth.getUser();
 if (!user) redirect("/login");
 const { data: profile } = await db.from("profiles").select("company_id").eq("id",user.id).single();
 if (!profile?.company_id) redirect(`${q(back)}erro=Empresa+não+identificada`);
 const [{ data: allowed }, { data: production }] = await Promise.all([
   db.rpc("has_table_access",{resource:"production_orders",action:"update"}),
   db.from("production_orders").select("id,company_id,order_id,current_step,status,flow_type").eq("id",productionOrderId).eq("company_id",profile.company_id).maybeSingle(),
 ]);
 if (!allowed || !production || production.status==='cancelado') redirect(`${q(back)}erro=Sem+permissão+para+adicionar+foto`);
 if (stepNumber > (production.flow_type==='esquadrias'?9:7)) redirect(`${q(back)}erro=Etapa+inválida`);
 if (stepNumber!==production.current_step) {
   const {data:log}=await db.from("production_step_logs").select("id").eq("production_order_id",productionOrderId).eq("step_number",stepNumber).limit(1).maybeSingle();
   if(!log) redirect(`${q(back)}erro=Etapa+ainda+não+iniciada`);
 }
 const bytes = Buffer.from(await file.arrayBuffer());
 if (!matchesAttachment(bytes,file.type)) redirect(`${q(back)}erro=O+arquivo+não+é+uma+foto+válida`);

 // Upload para Storage
 const ext = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'} as Record<string,string>)[file.type];
 const path = `${profile.company_id}/production/${productionOrderId}/step-${stepNumber}/${crypto.randomUUID()}.${ext}`;
 const { error: uploadError } = await db.storage.from("production-photos").upload(path, bytes, { contentType: file.type, upsert: false });
 if (uploadError) redirect(`${q(back)}erro=${encodeURIComponent(friendlyError(uploadError.message) ?? "Falha ao enviar foto")}`);


 // Registra no banco via RPC
 const { error: rpcError } = await db.rpc("add_production_step_photo", {
 p_production_order_id: productionOrderId,
 p_step_number: stepNumber,
 p_photo_url: path,
 p_caption: caption,
 });
 if (rpcError) redirect(`${q(back)}erro=${encodeURIComponent(friendlyError(rpcError.message) ?? "Não foi possível registrar a foto")}`);

 revalidatePath("/producao");
 revalidatePath(`/producao/${productionOrderId}`);
 revalidatePath(`/pedidos/${production.order_id}`);
 redirect(`${q(back)}ok=Foto+adicionada`);
}

export async function deleteProductionStepPhoto(formData: FormData) {
 const back = safeBack(formData.get("_back"), "/producao");
 const photoId = String(formData.get("photo_id") || "");
 if (!uuid.safeParse(photoId).success) redirect(`${q(back)}erro=Foto+inválida`);

 const db = await createClient();
 const { data: allowed } = await db.rpc("has_table_access",{resource:"production_orders",action:"update"});
 const { data: photo } = await db.from("production_step_photos").select("production_order_id").eq("id",photoId).maybeSingle();
 if(!allowed || !photo) redirect(`${q(back)}erro=Foto+não+encontrada+ou+sem+permissão`);
 const { error } = await db.from("production_step_photos").update({deleted_at:new Date().toISOString()}).eq("id", photoId);
 if (error) redirect(`${q(back)}erro=${encodeURIComponent(friendlyError(error.message) ?? "Não foi possível remover a foto")}`);

 revalidatePath("/producao");
 revalidatePath(`/producao/${photo.production_order_id}`);
 revalidatePath(back.split('?')[0]);
 redirect(`${q(back)}ok=Foto+arquivada`);
}
