"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function uploadLogo(formData: FormData): Promise<{ url?: string; error?: string }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Supabase não configurado" };
  const db = await createClient();

  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) return { error: "Nenhum arquivo enviado" };
  if (file.size > 3 * 1024 * 1024) return { error: "Arquivo muito grande. Máx. 3 MB." };

  const { data: profile } = await db.from("profiles").select("company_id").single();
  if (!profile?.company_id) return { error: "Empresa não encontrada" };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const path = `logos/${profile.company_id}/logo.${ext}`;
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await db.storage
    .from("company-assets")
    .upload(path, bytes, {
      contentType: file.type,
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadError) return { error: uploadError.message };

  const { data: urlData } = db.storage.from("company-assets").getPublicUrl(path);
  const publicUrl = urlData.publicUrl + `?t=${Date.now()}`;

  await db.from("companies").update({ logo_url: publicUrl }).eq("id", profile.company_id);

  revalidatePath("/configuracoes");
  return { url: publicUrl };
}

export async function removeLogo(): Promise<{ error?: string }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Supabase não configurado" };
  const db = await createClient();
  const { data: profile } = await db.from("profiles").select("company_id").single();
  if (!profile?.company_id) return { error: "Empresa não encontrada" };

  await db.from("companies").update({ logo_url: null }).eq("id", profile.company_id);
  revalidatePath("/configuracoes");
  return {};
}

export async function saveLogoSettings(settings: {
  width: number;
  maxHeight: number;
  align: "left" | "center" | "right";
  marginTop: number;
  marginBottom: number;
}): Promise<{ error?: string }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Supabase não configurado" };
  const db = await createClient();
  const { data: profile } = await db.from("profiles").select("company_id").single();
  if (!profile?.company_id) return { error: "Empresa não encontrada" };

  const { error } = await db.from("companies").update({
    logo_width: settings.width,
    logo_max_height: settings.maxHeight,
    logo_align: settings.align,
    logo_margin_top: settings.marginTop,
    logo_margin_bottom: settings.marginBottom,
  }).eq("id", profile.company_id);

  if (error) return { error: error.message };
  revalidatePath("/configuracoes");
  return {};
}

export async function saveTemplateConfig(
  templateId: string,
  config: Record<string, unknown>
): Promise<{ error?: string }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Supabase não configurado" };
  const db = await createClient();
  const { error } = await db.from("document_templates").update({ config }).eq("id", templateId);
  if (error) return { error: error.message };
  revalidatePath("/configuracoes/templates");
  return {};
}

export async function setTemplateDefault(templateId: string, type: string): Promise<{ error?: string }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Supabase não configurado" };
  const db = await createClient();
  const { data: profile } = await db.from("profiles").select("company_id").single();
  if (!profile?.company_id) return { error: "Empresa não encontrada" };

  // Remove is_default de outros do mesmo tipo
  await db.from("document_templates")
    .update({ is_default: false, status: "rascunho" })
    .eq("company_id", profile.company_id)
    .eq("type", type);

  const { error } = await db.from("document_templates")
    .update({ is_default: true, status: "em_uso" })
    .eq("id", templateId);

  if (error) return { error: error.message };
  revalidatePath("/configuracoes/templates");
  return {};
}

export async function duplicateTemplate(templateId: string): Promise<{ error?: string; id?: string }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Supabase não configurado" };
  const db = await createClient();
  const { data: tpl } = await db.from("document_templates").select("*").eq("id", templateId).single();
  if (!tpl) return { error: "Template não encontrado" };

  const { data: newTpl, error } = await db.from("document_templates").insert({
    company_id: tpl.company_id,
    name: `${tpl.name} (cópia)`,
    type: tpl.type,
    status: "rascunho",
    is_default: false,
    config: tpl.config,
  }).select("id").single();

  if (error) return { error: error.message };
  revalidatePath("/configuracoes/templates");
  return { id: newTpl.id };
}

export async function restoreTemplateDefaults(templateId: string): Promise<{ error?: string }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Supabase não configurado" };
  const db = await createClient();
  const { error } = await db.from("document_templates").update({
    config: {
      logo_width: 80, logo_align: "left",
      logo_margin_top: 0, logo_margin_bottom: 0,
      show_logo: true, show_header: true, show_footer: true,
      font_size: 10, primary_color: null,
    }
  }).eq("id", templateId);
  if (error) return { error: error.message };
  revalidatePath("/configuracoes/templates");
  return {};
}
