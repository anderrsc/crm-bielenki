"use server";
// Cobranças Pix: registrar a que foi enviada, listar e confirmar o recebimento na conta escolhida.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/utils";
import { scheduleReceipt } from "@/lib/receipts/process";

export type PixChargeRow = {
  id: string; account_name: string; receiving_account_id: string; description: string; amount: number;
  status: "aguardando" | "recebida" | "cancelada"; created_at: string; paid_at: string | null;
  client: { name: string } | null;
};

const uuid = z.string().uuid();
const refresh = () => { for (const p of ["/financeiro", "/financeiro/caixa", "/financeiro/receber", "/financeiro/extrato", "/atendimento"]) revalidatePath(p); };

export async function recordPixCharge(input: { accountId: string; amount: number; description: string; conversationId?: string; clientId?: string | null; entryId?: string | null; quoteId?: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const p = z.object({
    accountId: uuid, amount: z.number().finite().positive().max(10_000_000), description: z.string().trim().min(1).max(200),
    conversationId: uuid.optional(), clientId: uuid.nullish(), entryId: uuid.nullish(), quoteId: uuid.nullish(),
  }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dados da cobrança inválidos." };
  const db = await createClient();
  const { data, error } = await db.rpc("record_pix_charge", {
    p_account: p.data.accountId, p_amount: Math.round(p.data.amount * 100) / 100, p_description: p.data.description,
    p_conversation: p.data.conversationId ?? null, p_client: p.data.clientId ?? null, p_entry: p.data.entryId ?? null, p_quote: p.data.quoteId ?? null,
  });
  if (error || !data) return { ok: false, error: error?.message ?? "Não foi possível registrar a cobrança." };
  refresh();
  return { ok: true, id: String(data) };
}

export async function listPixCharges(filter: { conversationId?: string; accountId?: string; onlyWaiting?: boolean }): Promise<PixChargeRow[]> {
  if (filter.conversationId && !uuid.safeParse(filter.conversationId).success) return [];
  if (filter.accountId && !uuid.safeParse(filter.accountId).success) return [];
  const db = await createClient();
  let q = db.from("pix_charges").select("id,account_name,receiving_account_id,description,amount,status,created_at,paid_at,client:clients(name)").order("created_at", { ascending: false }).limit(50);
  if (filter.conversationId) q = q.eq("conversation_id", filter.conversationId);
  if (filter.accountId) q = q.eq("receiving_account_id", filter.accountId);
  if (filter.onlyWaiting) q = q.eq("status", "aguardando");
  const { data } = await q;
  return ((data ?? []) as unknown as PixChargeRow[]).map((r) => ({ ...r, amount: Number(r.amount) }));
}

export async function confirmPixCharge(id: string, paidAt?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const date = paidAt && /^\d{4}-\d{2}-\d{2}$/.test(paidAt) ? paidAt : todayISO();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Cobrança inválida." };
  const db = await createClient();
  const { data: paymentId, error } = await db.rpc("confirm_pix_charge", { p_charge: id, p_paid_at: date });
  if (error) return { ok: false, error: /permiss/i.test(error.message) ? "Só quem dá baixa no financeiro pode confirmar o recebimento." : error.message };
  await scheduleReceipt(paymentId ? String(paymentId) : null);
  refresh();
  return { ok: true };
}

export async function cancelPixCharge(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Cobrança inválida." };
  const db = await createClient();
  const { error } = await db.rpc("cancel_pix_charge", { p_charge: id });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}
