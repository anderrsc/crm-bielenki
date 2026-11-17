"use server";
// Crédito com fornecedores: usar o saldo numa conta a pagar e lançar adiantamento/abatimento.
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseBRNumber } from "@/lib/br-number";
import { validIsoDate } from "@/lib/valid-date";

const date = z.string().refine(validIsoDate);
function back(form: FormData) {
  const b = String(form.get("_back") || "/financeiro/pagar");
  return b.startsWith("/financeiro") && !b.startsWith("//") ? b : "/financeiro/pagar";
}
const q = (b: string) => (b.includes("?") ? `${b}&` : `${b}?`);
function message(e: { code?: string; message?: string }) {
  return e.code === "42501" ? "Sem permissão para esta operação." : e.message || "Não foi possível salvar.";
}
function refresh(b: string) {
  for (const r of ["/financeiro", "/financeiro/pagar", "/financeiro/caixa", "/fornecedores", "/configuracoes/fornecedores"]) revalidatePath(r);
  revalidatePath(b.split("?")[0]);
}

export async function applySupplierCredit(form: FormData) {
  const b = back(form);
  const amount = parseBRNumber(String(form.get("amount") ?? ""));
  const p = z.object({ entry_id: z.uuid(), paid_at: date }).safeParse(Object.fromEntries(form));
  if (!p.success || amount === null || !(amount > 0)) redirect(`${q(b)}erro=${encodeURIComponent("Revise o valor do crédito")}`);
  const db = await createClient();
  const { error } = await db.rpc("use_supplier_credit", { p_entry_id: p.data.entry_id, p_amount: amount, p_date: p.data.paid_at });
  if (error) redirect(`${q(b)}erro=${encodeURIComponent(message(error))}`);
  refresh(b); redirect(`${q(b)}recebido=1`);
}

export async function addSupplierCredit(form: FormData) {
  const b = back(form);
  const amount = parseBRNumber(String(form.get("amount") ?? ""));
  const p = z.object({
    supplier_id: z.uuid(), kind: z.enum(["adiantamento", "abatimento", "ajuste"]), moved_at: date,
    account_id: z.uuid().or(z.literal("")).default(""), notes: z.string().trim().min(3).max(500),
  }).safeParse(Object.fromEntries(form));
  if (!p.success || amount === null || amount === 0) redirect(`${q(b)}erro=${encodeURIComponent("Revise fornecedor, valor e motivo do crédito")}`);
  const db = await createClient();
  const { error } = await db.rpc("add_supplier_credit", { p_supplier: p.data.supplier_id, p_amount: amount, p_kind: p.data.kind, p_date: p.data.moved_at, p_account: p.data.account_id || null, p_notes: p.data.notes });
  if (error) redirect(`${q(b)}erro=${encodeURIComponent(message(error))}`);
  refresh(b); redirect(`${q(b)}ok=${encodeURIComponent("Crédito lançado")}`);
}
