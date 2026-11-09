"use server";
// Respostas prontas do Atendimento: lista, cria, edita e apaga (toda a equipe).
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { QUICK_REPLY_DEFAULTS } from "@/lib/quick-replies";

export type QuickReply = { id: string; shortcut: string; body: string };
type Result<T = object> = ({ ok: true } & T) | { ok?: false; error: string };

const fail = (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) });
const missingTable = (msg: string) => /quick_replies|does not exist|schema cache/i.test(msg)
  ? "Falta rodar a atualização do banco 20261109170000_respostas_prontas.sql." : msg;

async function context() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!profile?.company_id) throw new Error("Empresa não encontrada.");
  return { db, companyId: profile.company_id as string };
}

export async function listQuickReplies(): Promise<Result<{ replies: QuickReply[] }>> {
  try {
    const { db, companyId } = await context();
    const read = () => db.from("quick_replies").select("id,shortcut,body").eq("company_id", companyId).order("sort_order").order("created_at");
    let { data, error } = await read();
    if (error) throw new Error(missingTable(error.message));
    if (!data?.length) {
      // Primeira vez: já vem com as mais usadas para a equipe ajustar.
      await db.from("quick_replies").insert(QUICK_REPLY_DEFAULTS.map((r, i) => ({ ...r, company_id: companyId, sort_order: i })));
      ({ data, error } = await read());
      if (error) throw new Error(missingTable(error.message));
    }
    return { ok: true, replies: (data ?? []) as QuickReply[] };
  } catch (e) { return fail(e); }
}

const replySchema = z.object({
  id: z.string().uuid().optional(),
  shortcut: z.string().trim().toLowerCase().transform((s) => s.replace(/^\//, "").replace(/\s+/g, "-")).pipe(z.string().min(1, "Dê um nome curto ao atalho.").max(30)),
  body: z.string().trim().min(1, "Escreva a mensagem.").max(2000),
});

export async function saveQuickReply(input: { id?: string; shortcut: string; body: string }): Promise<Result<{ reply: QuickReply }>> {
  try {
    const parsed = replySchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
    const { db, companyId } = await context();
    const { id, ...values } = parsed.data;
    const query = id
      ? db.from("quick_replies").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id).eq("company_id", companyId)
      : db.from("quick_replies").insert({ ...values, company_id: companyId, sort_order: 999 });
    const { data, error } = await query.select("id,shortcut,body").single();
    if (error || !data) throw new Error(missingTable(error?.message ?? "Não salvou."));
    return { ok: true, reply: data as QuickReply };
  } catch (e) { return fail(e); }
}

export async function deleteQuickReply(id: string): Promise<Result> {
  try {
    if (!z.string().uuid().safeParse(id).success) return { error: "Resposta inválida." };
    const { db, companyId } = await context();
    const { error } = await db.from("quick_replies").delete().eq("id", id).eq("company_id", companyId);
    if (error) throw new Error(missingTable(error.message));
    return { ok: true };
  } catch (e) { return fail(e); }
}
