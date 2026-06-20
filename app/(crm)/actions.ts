"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const text = z.string().trim().min(1);

export async function createClientRecord(formData: FormData) {
  const db = await createClient();
  const parsed = z.object({ name: text, phone: z.string().optional(), email: z.string().email().or(z.literal("")).optional(), tax_id: z.string().optional(), city: z.string().optional(), state: z.string().optional(), notes: z.string().optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/clientes/novo?erro=Revise os campos obrigatórios");
  const { data: profile } = await db.from("profiles").select("company_id").single();
  const { data, error } = await db.from("clients").insert({ ...parsed.data, company_id: profile?.company_id }).select("id").single();
  if (error) redirect(`/clientes/novo?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/clientes"); redirect(`/clientes/${data.id}`);
}

export async function registerPayment(formData: FormData) {
  const db = await createClient();
  const entryId = String(formData.get("financial_entry_id"));
  const amount = Number(formData.get("amount"));
  const { error } = await db.rpc("register_payment", { p_entry_id: entryId, p_amount: amount, p_paid_at: String(formData.get("paid_at")), p_method: String(formData.get("payment_method")), p_notes: String(formData.get("notes") ?? "") });
  if (error) redirect(`/financeiro?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/financeiro");
}

export async function toggleChecklistItem(formData: FormData) {
  const db = await createClient();
  const id = String(formData.get("id"));
  const orderId = String(formData.get("order_id"));
  const status = String(formData.get("status")) === "concluido" ? "pendente" : "concluido";
  const { error } = await db.from("order_checklist_items").update({ status, completed_at: status === "concluido" ? new Date().toISOString() : null }).eq("id", id);
  if (error) redirect(`/pedidos/${orderId}/checklist?erro=${encodeURIComponent(error.message)}`);
  revalidatePath(`/pedidos/${orderId}`);
}

export async function saveGutterQuote(formData: FormData) {
  const db = await createClient();
  const payload = JSON.parse(String(formData.get("payload")));
  const parsed = z.object({ client_id: z.string().uuid(), discount: z.number().nonnegative(), freight: z.number().nonnegative(), notes: z.string(), items: z.array(z.object({ product: text, thickness: text, cut: text, quantity: z.number().positive(), meters: z.number().positive(), unit_price: z.number().nonnegative() })).min(1) }).safeParse(payload);
  if (!parsed.success) redirect("/orcamentos/calhas?erro=Revise os itens do orçamento");
  const { data, error } = await db.rpc("create_gutter_quote", { p_payload: parsed.data });
  if (error) redirect(`/orcamentos/calhas?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/orcamentos"); redirect(`/orcamentos/${data}`);
}

export async function updateCompanyIdentity(formData: FormData) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!profile?.company_id) redirect("/configuracoes?erro=Empresa não encontrada");

  const values = {
    name: String(formData.get("name") ?? "").trim(),
    trade_name: String(formData.get("trade_name") ?? "").trim(),
    tax_id: String(formData.get("tax_id") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    whatsapp: String(formData.get("whatsapp") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    neighborhood: String(formData.get("neighborhood") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim(),
    state: String(formData.get("state") ?? "").trim().slice(0, 2).toUpperCase(),
    website: String(formData.get("website") ?? "").trim(),
    primary_color: String(formData.get("primary_color") ?? "#234d3c"),
    accent_color: String(formData.get("accent_color") ?? "#b9d349"),
    quote_footer: String(formData.get("quote_footer") ?? "").trim(),
  };
  if (!values.name) redirect("/configuracoes?erro=Informe a razão social");

  let logoUrl: string | undefined;
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > 2 * 1024 * 1024) redirect("/configuracoes?erro=A logo deve ter no máximo 2 MB");
    if (!logo.type.startsWith("image/")) redirect("/configuracoes?erro=Envie um arquivo de imagem");
    const extension = logo.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "png";
    const path = `${profile.company_id}/logo-${Date.now()}.${extension}`;
    const { error: uploadError } = await db.storage.from("company-assets").upload(path, logo, { contentType: logo.type, upsert: true });
    if (uploadError) redirect(`/configuracoes?erro=${encodeURIComponent(uploadError.message)}`);
    logoUrl = db.storage.from("company-assets").getPublicUrl(path).data.publicUrl;
  }

  const { error } = await db.from("companies").update({ ...values, ...(logoUrl ? { logo_url: logoUrl } : {}) }).eq("id", profile.company_id);
  if (error) redirect(`/configuracoes?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/configuracoes"); revalidatePath("/orcamentos", "layout"); revalidatePath("/clientes", "layout");
  redirect("/configuracoes?salvo=1");
}

export async function approveQuote(formData: FormData) {
  const db = await createClient();
  const quoteId = String(formData.get("quote_id"));
  const dueDate = String(formData.get("due_date") || "") || null;
  const { data, error } = await db.rpc("approve_quote", { p_quote_id: quoteId, p_due_date: dueDate });
  if (error) redirect(`/orcamentos/${quoteId}?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/orcamentos"); redirect(`/vendas/${data}`);
}
