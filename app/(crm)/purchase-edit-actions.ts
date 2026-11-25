"use server";
// Corrigir ou cancelar compra lançada errado (tela da compra).
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { q } from "@/lib/back-url";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

function refresh(back: string) {
  for (const r of ["/compras", "/financeiro", "/financeiro/pagar", "/fornecedores", back]) revalidatePath(r);
}

export async function editPurchase(form: FormData) {
  const id = String(form.get("id") ?? "");
  const back = `/compras/${z.uuid().safeParse(id).success ? id : ""}`;
  let payload: unknown;
  try { payload = JSON.parse(String(form.get("payload") ?? "{}")); } catch { redirect(`${q(back)}erro=Dados+inválidos`); }
  const p = z.object({
    supplier_id: z.uuid().or(z.literal("")), expected_at: z.string(), notes: z.string().max(2000), order_id: z.uuid().or(z.literal("")),
    items: z.array(z.object({ id: z.uuid(), description: z.string().trim().min(1).max(300), category: z.string().max(100), quantity: z.number().positive(), unit_price: z.number().nonnegative() })),
  }).safeParse(payload);
  if (!z.uuid().safeParse(id).success || !p.success) redirect(`${q(back)}erro=${encodeURIComponent("Revise os dados da compra")}`);
  const db = await createClient();
  const { error } = await db.rpc("update_purchase_order", { p_id: id, p_payload: p.data });
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(error.message)}`);
  refresh(back); redirect(`${q(back)}ok=${encodeURIComponent("Compra corrigida")}`);
}

export async function cancelPurchase(form: FormData) {
  const p = z.object({ id: z.uuid(), reason: z.string().trim().min(3).max(500) }).safeParse(Object.fromEntries(form));
  const back = `/compras/${p.success ? p.data.id : ""}`;
  if (!p.success) redirect(`${q(back)}erro=${encodeURIComponent("Informe o motivo do cancelamento")}`);
  const db = await createClient();
  const { error } = await db.rpc("cancel_purchase_order", { p_id: p.data.id, p_reason: p.data.reason });
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(error.message)}`);
  refresh(back); redirect(`${q(back)}ok=${encodeURIComponent("Compra cancelada")}`);
}

export async function registerPurchaseReturn(form: FormData) {
  const raw = Object.fromEntries(form);
  const back = `/compras/${z.uuid().safeParse(raw.po_id).success ? raw.po_id : ""}`;
  const qty = Number(String(raw.quantity ?? "").replace(",", "."));
  const amount = raw.amount === "" || raw.amount === undefined ? null : Number(String(raw.amount).replace(",", "."));
  const p = z.object({ item_id: z.uuid(), location_id: z.uuid().or(z.literal("")).default(""), reason: z.string().trim().min(3).max(500) }).safeParse(raw);
  if (!p.success || !(qty > 0) || (amount !== null && !(amount >= 0))) redirect(`${q(back)}erro=${encodeURIComponent("Revise item, quantidade, valor e motivo da devolução")}`);
  const db = await createClient();
  const { error } = await db.rpc("register_purchase_return", { p_item_id: p.data.item_id, p_quantity: qty, p_amount: amount, p_location: p.data.location_id || null, p_reason: p.data.reason });
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(error.message)}`);
  refresh(back); revalidatePath("/estoque");
  redirect(`${q(back)}ok=${encodeURIComponent("Devolução registrada")}`);
}

/** Recebe todos os itens pendentes da compra (ou só os marcados) de uma vez. */
export async function receivePurchaseAll(form: FormData) {
  const raw = Object.fromEntries(form);
  const back = `/compras/${z.uuid().safeParse(raw.po_id).success ? raw.po_id : ""}`;
  const p = z.object({ po_id: z.uuid(), location_id: z.uuid() }).safeParse(raw);
  if (!p.success) redirect(`${q(back)}erro=${encodeURIComponent("Escolha o local do estoque")}`);
  const only = form.getAll("item_ids").map(String).filter((v) => z.uuid().safeParse(v).success);
  const db = await createClient();
  const { data, error } = await db.rpc("receive_purchase_all", { p_po: p.data.po_id, p_location_id: p.data.location_id, p_item_ids: only.length ? only : null });
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(error.message)}`);
  for (const r of ["/compras", "/estoque", "/producao", "/producao/materiais-do-pedido"]) revalidatePath(r);
  const r = (data ?? {}) as { received?: number; skipped?: number };
  refresh(back); redirect(`${q(back)}ok=${encodeURIComponent(`${r.received ?? 0} item(ns) recebido(s)${r.skipped ? `, ${r.skipped} sem material cadastrado` : ""}`)}`);
}

const ATTACH_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/** Anexa (ou troca) o PDF/foto da nota ou do orçamento do fornecedor na compra. */
export async function uploadPurchaseAttachment(form: FormData) {
  const id = String(form.get("purchase_id") ?? "");
  const back = `/compras/${z.uuid().safeParse(id).success ? id : ""}`;
  const file = form.get("file");
  if (!z.uuid().safeParse(id).success || !(file instanceof File) || file.size === 0) redirect(`${q(back)}erro=${encodeURIComponent("Escolha o arquivo")}`);
  if (!ATTACH_TYPES.includes(file.type) || file.size > 10 * 1024 * 1024) redirect(`${q(back)}erro=${encodeURIComponent("Envie PDF, JPG, PNG ou WEBP de até 10 MB")}`);
  const db = await createClient();
  // Só quem pode alterar a compra (o RLS decide): sem isso, nada é gravado.
  const { data: po } = await db.from("purchase_orders").select("id,company_id").eq("id", id).maybeSingle();
  const { data: canEdit } = await db.rpc("has_table_access", { resource: "purchase_orders", action: "update" });
  if (!po || canEdit !== true) redirect(`${q(back)}erro=${encodeURIComponent("Sem permissão para anexar nesta compra")}`);
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) redirect(`${q(back)}erro=${encodeURIComponent("Servidor sem configuração de arquivos")}`);
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const name = file.name.replace(/[^\p{L}\p{N}_. -]/gu, "_").slice(0, 120) || "arquivo";
  const path = `${po!.company_id}/${randomUUID()}-${name}`;
  const { error: upErr } = await admin.storage.from("compras").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (upErr) redirect(`${q(back)}erro=${encodeURIComponent("Não foi possível guardar o arquivo")}`);
  const { error } = await db.from("purchase_orders").update({ attachment_path: path, attachment_name: name, attachment_type: file.type }).eq("id", id);
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(error.message)}`);
  refresh(back);
  redirect(back);
}
