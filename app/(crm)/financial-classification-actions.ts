"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { selectOwnProfile } from "@/lib/own-profile";
import { DRE_GROUPS_BY_TYPE } from "@/lib/financial-dre";
import { validIsoDate } from "@/lib/valid-date";

const base = "/financeiro/classificacoes";
const idSchema = z.uuid();
async function context() {
  const db = await createClient();
  const [{ data: profile }, { data: allowed }] = await Promise.all([
    selectOwnProfile<{ company_id: string }>(db, "company_id"),
    db.rpc("has_table_access", { resource: "financial_entries", action: "update" }),
  ]);
  if (!profile?.company_id || allowed !== true) redirect(`${base}?erro=Sem+permissão+para+alterar+classificações`);
  return { db, companyId: profile.company_id };
}
function refresh() {
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/pagar");
  revalidatePath("/financeiro/receber");
  revalidatePath(base);
  revalidatePath("/financeiro/dre");
}

export async function saveFinancialDefinition(form: FormData) {
  const parsed = z.object({ kind: z.enum(["category", "center"]), id: z.uuid().or(z.literal("")).default(""), name: z.string().trim().min(1).max(80), entry_type: z.enum(["pagar", "receber"]).default("pagar"), dre_group: z.string().default(""), report_group:z.enum(['','fabricacao','instalacao','veiculos','extraordinarias']).default('') }).safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect(`${base}?erro=Revise+o+nome+e+o+tipo`);
  const { db, companyId } = await context();
  const { kind, id, name, entry_type } = parsed.data;
  // Linha da DRE compativel com o tipo; vazia ou incompativel cai no padrao do tipo.
  const allowedGroups: string[] = DRE_GROUPS_BY_TYPE[entry_type];
  const dre_group = allowedGroups.includes(parsed.data.dre_group) ? parsed.data.dre_group : entry_type === "receber" ? "receita" : "administrativa";
  const table = kind === "category" ? "financial_categories" : "financial_cost_centers";
  const values = { name, active: form.get("active") === "on", ...(kind === "category" ? { entry_type, dre_group, report_group:parsed.data.report_group||null } : {}) };
  const query = id ? db.from(table).update(values).eq("id", id).eq("company_id", companyId) : db.from(table).insert({ ...values, company_id: companyId });
  const { data, error } = await query.select("id").single();
  if (error || !data) redirect(`${base}?erro=${encodeURIComponent(error?.code === "23505" ? "Já existe um cadastro com este nome e tipo." : error?.code === "23503" ? "O tipo de uma categoria já utilizada não pode mudar. Crie outra categoria." : "Não foi possível salvar. Verifique suas permissões e tente novamente.")}`);
  refresh();
  redirect(`${base}?salvo=1`);
}

export async function seedFinancialDefinitions() {
  const { db } = await context();
  const { error } = await db.rpc("seed_financial_classifications");
  if (error) redirect(`${base}?erro=Não+foi+possível+cadastrar+as+sugestões`);
  refresh();
  redirect(`${base}?salvo=1`);
}

export async function classifyFinancialEntry(form: FormData) {
  const parsed = z.object({ id: idSchema, category_id: idSchema.or(z.literal("")), cost_center_id: idSchema.or(z.literal("")), competence_date: z.string().default("") }).safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect(`${base}?erro=Classificação+inválida`);
  const { db, companyId } = await context();
  const { id, category_id, cost_center_id, competence_date } = parsed.data;
  if (competence_date && !validIsoDate(competence_date)) redirect(`${base}?lancamento=${id}&erro=Data+de+competência+inválida`);
  const { data, error } = await db.from("financial_entries").update({ category_id: category_id || null, cost_center_id: cost_center_id || null, competence_date: competence_date || null }).eq("id", id).eq("company_id", companyId).select("id").single();
  if (error || !data) redirect(`${base}?lancamento=${id}&erro=Não+foi+possível+classificar.+Selecione+cadastros+ativos+e+compatíveis+com+o+tipo+da+conta.`);
  refresh();
  redirect(`${base}?lancamento=${id}&salvo=1`);
}
