"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { selectOwnProfile } from "@/lib/own-profile";
import { createClient } from "@/lib/supabase/server";

export async function createFinancialEntry(formData: FormData) {
  const type = z.enum(["pagar", "receber"]).safeParse(formData.get("entry_type"));
  if (!type.success) redirect("/financeiro?erro=Tipo+de+lançamento+inválido");

  const back = `/financeiro/${type.data}`;
  const parsed = z.object({
    id: z.uuid(),
    description: z.string().trim().min(1).max(200),
    total_amount: z.string().trim().regex(/^\d{1,12}([.,]\d{1,2})?$/)
      .transform(value => Number(value.replace(",", "."))).pipe(z.number().positive()),
    due_date: z.iso.date(),
    party_id: z.uuid().or(z.literal("")),
    notes: z.string().trim().max(2000),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}/novo?erro=Revise+a+descrição,+o+valor+e+o+vencimento`);

  const db = await createClient();
  const { data: profile } = await selectOwnProfile<{ company_id: string }>(db, "company_id");
  if (!profile?.company_id) redirect(`${back}?erro=Não+foi+possível+identificar+a+empresa`);

  const { id, party_id, notes, ...entry } = parsed.data;
  const payable = type.data === "pagar";
  if (party_id) {
    const { data: party } = await db.from(payable ? "suppliers" : "clients").select("id")
      .eq("id", party_id).eq("company_id", profile.company_id).maybeSingle();
    if (!party) redirect(`${back}/novo?erro=Selecione+um+cadastro+válido+da+empresa`);
  }

  const { error } = await db.from("financial_entries").insert({
    ...entry,
    id,
    company_id: profile.company_id,
    entry_type: type.data,
    origin: "manual",
    client_id: payable ? null : party_id || null,
    supplier_id: payable ? party_id || null : null,
    notes: notes || null,
  });
  if (error) {
    // A retry of the same form may arrive after the first insert committed.
    const { data: saved } = error.code === "23505"
      ? await db.from("financial_entries").select("id").eq("id", id)
          .eq("company_id", profile.company_id).eq("entry_type", type.data).eq("origin", "manual").maybeSingle()
      : { data: null };
    if (!saved) redirect(`${back}/novo?erro=Não+foi+possível+salvar+a+conta.+Verifique+suas+permissões+e+tente+novamente.`);
  }

  revalidatePath(back);
  revalidatePath("/financeiro");
  redirect(`${back}?criado=1`);
}

