"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseBRNumber } from "@/lib/br-number";
import { validIsoDate } from "@/lib/valid-date";

const base = "/financeiro/caixa";

/** Saldo inicial de uma conta: o saldo passa a ser esse valor mais as baixas a partir da data. */
export async function saveOpeningBalance(form: FormData) {
  const id = String(form.get("account_id") || "");
  const date = String(form.get("opening_date") || "");
  const amount = parseBRNumber(String(form.get("opening_balance") || "0"));
  if (!z.uuid().safeParse(id).success) redirect(`${base}?erro=Conta+inválida`);
  if (amount === null || !Number.isFinite(amount) || Math.abs(amount) > 999_999_999) redirect(`${base}?erro=${encodeURIComponent("Saldo inválido. Use por exemplo 1.500,00")}`);
  if (date && !validIsoDate(date)) redirect(`${base}?erro=Data+inválida`);
  const db = await createClient();
  const { data: allowed } = await db.rpc("has_table_access", { resource: "financial_entries", action: "update" });
  if (allowed !== true) redirect(`${base}?erro=Sem+permissão+para+alterar+saldos`);
  const { data, error } = await db.from("receiving_accounts").update({ opening_balance: amount, opening_date: date || null, updated_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error || !data?.length) redirect(`${base}?erro=${encodeURIComponent("Não foi possível salvar o saldo inicial.")}`);
  revalidatePath(base);
  redirect(`${base}?salvo=1`);
}
