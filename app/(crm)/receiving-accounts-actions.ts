"use server";
// Contas de recebimento (Pix, bancos, caixa) usadas ao dar baixa em pagamentos.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ReceivingAccount = { id: string; name: string; details: string | null; active: boolean; pix_key: string | null; holder_name: string | null; holder_city: string | null };
type Result<T = object> = ({ ok: true } & T) | { ok?: false; error: string };
const missing = (m: string) => /pix_key|holder_/i.test(m) ? "Falta rodar a atualização do banco 20261109200000_contas_pix.sql." : /receiving_accounts|does not exist|schema cache/i.test(m) ? "Falta rodar a atualização do banco 20261109190000_contas_recebimento.sql." : m;

async function context() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sessão expirada.");
  const { data: p } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!p?.company_id) throw new Error("Empresa não encontrada.");
  return { db, companyId: p.company_id as string };
}

export async function listReceivingAccounts(includeInactive = false): Promise<Result<{ accounts: ReceivingAccount[] }>> {
  try {
    const { db, companyId } = await context();
    let q = db.from("receiving_accounts").select(COLS).eq("company_id", companyId).order("name");
    if (!includeInactive) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) throw new Error(missing(error.message));
    return { ok: true, accounts: (data ?? []) as ReceivingAccount[] };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}

const COLS = "id,name,details,active,pix_key,holder_name,holder_city";

const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Dê um nome à conta (ex.: Pix Sicoob CNPJ).").max(80),
  details: z.string().trim().max(300).optional(),
  active: z.boolean().optional(),
  pix_key: z.string().trim().max(120).optional(),
  holder_name: z.string().trim().max(80).optional(),
  holder_city: z.string().trim().max(60).optional(),
});

export async function saveReceivingAccount(input: { id?: string; name: string; details?: string; active?: boolean; pix_key?: string; holder_name?: string; holder_city?: string }): Promise<Result<{ account: ReceivingAccount }>> {
  try {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
    const { db, companyId } = await context();
    const { id, ...v } = parsed.data;
    const values = {
      name: v.name, details: v.details || null, ...(v.active === undefined ? {} : { active: v.active }),
      ...(v.pix_key === undefined ? {} : { pix_key: v.pix_key || null, holder_name: v.holder_name || null, holder_city: v.holder_city || null }),
      updated_at: new Date().toISOString(),
    };
    const q = id
      ? db.from("receiving_accounts").update(values).eq("id", id).eq("company_id", companyId)
      : db.from("receiving_accounts").insert({ ...values, company_id: companyId });
    const { data, error } = await q.select(COLS).single();
    if (error || !data) throw new Error(missing(error?.message ?? "Não salvou."));
    revalidatePath("/financeiro");
    return { ok: true, account: data as ReceivingAccount };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}
