"use server";
// Etiquetas de conversa (Orçamento, Pós-venda, Urgente…): organizar a fila do Atendimento.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ConversationLabel = { id: string; name: string; color: "slate" | "red" | "amber" | "green" | "blue" | "purple" };
const COLORS = ["slate", "red", "amber", "green", "blue", "purple"] as const;
const DEFAULTS: Array<[string, ConversationLabel["color"]]> = [["Orçamento", "blue"], ["Pós-venda", "green"], ["Urgente", "red"], ["Garantia", "amber"]];

async function ctx() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!profile?.company_id) throw new Error("Empresa não encontrada.");
  return { db, companyId: profile.company_id as string };
}
const fail = (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) });

export async function listConversationLabels(): Promise<{ labels: ConversationLabel[] } | { error: string }> {
  try {
    const { db, companyId } = await ctx();
    let { data, error } = await db.from("conversation_labels").select("id,name,color").eq("company_id", companyId).order("name");
    if (error) return { error: /relation|does not exist/i.test(error.message) ? "Etiquetas ainda não foram ativadas no banco." : error.message };
    if (!data?.length) {
      // Empresa nova: cria as etiquetas padrão uma vez.
      await db.from("conversation_labels").insert(DEFAULTS.map(([name, color]) => ({ company_id: companyId, name, color })));
      ({ data } = await db.from("conversation_labels").select("id,name,color").eq("company_id", companyId).order("name"));
    }
    return { labels: (data ?? []) as ConversationLabel[] };
  } catch (e) { return fail(e); }
}

export async function createConversationLabel(name: string, color: string): Promise<{ label: ConversationLabel } | { error: string }> {
  try {
    const p = z.object({ name: z.string().trim().min(1).max(30), color: z.enum(COLORS) }).safeParse({ name, color });
    if (!p.success) return { error: "Nome da etiqueta de 1 a 30 letras." };
    const { db, companyId } = await ctx();
    const { data, error } = await db.from("conversation_labels").insert({ company_id: companyId, name: p.data.name, color: p.data.color }).select("id,name,color").single();
    if (error) return { error: /duplicate|unique/i.test(error.message) ? "Já existe uma etiqueta com esse nome." : error.message };
    return { label: data as ConversationLabel };
  } catch (e) { return fail(e); }
}

export async function setConversationLabel(conversationId: string, labelId: string, on: boolean): Promise<{ ok: true } | { error: string }> {
  try {
    if (!z.uuid().safeParse(conversationId).success || !z.uuid().safeParse(labelId).success) return { error: "Conversa ou etiqueta inválida." };
    const { db, companyId } = await ctx();
    const { error } = on
      ? await db.from("conversation_label_links").upsert({ conversation_id: conversationId, label_id: labelId, company_id: companyId }, { onConflict: "conversation_id,label_id", ignoreDuplicates: true })
      : await db.from("conversation_label_links").delete().eq("conversation_id", conversationId).eq("label_id", labelId).eq("company_id", companyId);
    if (error) return { error: error.message };
    revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}
