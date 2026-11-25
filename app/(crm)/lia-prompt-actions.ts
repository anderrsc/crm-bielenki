"use server";
import { revalidatePath } from "next/cache";
import { getAuthUser, getRequestClient } from "@/lib/supabase/server";

async function getCtx() {
  const db = await getRequestClient();
  const user = await getAuthUser();
  if (!user) throw new Error("Não autenticado");
  const { data: p } = await db.from("profiles").select("company_id").eq("id", user.id).eq("active", true).single();
  if (!p?.company_id) throw new Error("Empresa não encontrada");
  const { data: roles, error } = await db.rpc("current_user_roles");
  if (error) throw new Error("Não foi possível verificar as permissões");
  const role = (roles as string[] | null)?.find(r => r === "administrador" || r === "gerente") ?? null;
  return { db, user, profile: { ...p, role } };
}

function isManager(role: string | null) {
  return role === "gerente" || role === "administrador";
}

export type PromptVersionRow = {
  id: string;
  content: string;
  version: number;
  status: "draft" | "active" | "archived";
  change_note: string | null;
  published_at: string | null;
  created_at: string;
};

/** Lista todas as versões do prompt da empresa. */
export async function listPromptVersions(): Promise<{ data: PromptVersionRow[]; error?: string }> {
  try {
    const { db, profile } = await getCtx();
    const { data, error } = await db
      .from("lia_prompt_versions")
      .select("id,content,version,status,change_note,published_at,created_at")
      .eq("company_id", profile.company_id)
      .order("version", { ascending: false })
      .limit(20);
    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as PromptVersionRow[] };
  } catch (e) { return { data: [], error: String(e) }; }
}

/** Salva um novo rascunho do prompt. */
export async function savePromptDraft(content: string, changeNote?: string): Promise<{ error?: string }> {
  try {
    const { db, user, profile } = await getCtx();
    if (!isManager(profile.role)) return { error: "Somente gerente ou administrador pode editar o prompt." };
    const trimmed = content.trim();
    if (trimmed.length < 10) return { error: "Prompt muito curto." };
    if (trimmed.length > 20000) return { error: "Prompt muito longo (máx 20.000 caracteres)." };
    // Próxima versão
    const { data: last } = await db.from("lia_prompt_versions").select("version").eq("company_id", profile.company_id).order("version", { ascending: false }).limit(1).maybeSingle();
    const nextVersion = (last?.version ?? 0) + 1;
    const { error } = await db.from("lia_prompt_versions").insert({
      company_id: profile.company_id,
      content: trimmed,
      version: nextVersion,
      status: "draft",
      change_note: changeNote?.trim() || null,
      created_by: user.id,
    });
    if (error) return { error: error.message };
    revalidatePath("/central-ia");
    return {};
  } catch (e) { return { error: String(e) }; }
}

/** Publica uma versão do prompt como ativa (arquiva a anterior). Somente admin/gerente. */
export async function publishPromptVersion(versionId: string): Promise<{ error?: string }> {
  try {
    const { db, user, profile } = await getCtx();
    if (!isManager(profile.role)) return { error: "Somente gerente ou administrador pode publicar o prompt." };
    // Arquiva o ativo atual
    await db.from("lia_prompt_versions").update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("company_id", profile.company_id).eq("status", "active");
    // Publica a versão escolhida
    const now = new Date().toISOString();
    const { error } = await db.from("lia_prompt_versions")
      .update({ status: "active", approved_by: user.id, published_at: now, updated_at: now })
      .eq("id", versionId).eq("company_id", profile.company_id);
    if (error) return { error: error.message };
    await db.from("lia_audit_events").insert({
      company_id: profile.company_id,
      event_type: "config_changed",
      actor_id: user.id,
      actor_role: profile.role,
      target_type: "config",
      outcome: "changed",
      details: { action: "prompt_published", version_id: versionId },
    });
    revalidatePath("/central-ia");
    return {};
  } catch (e) { return { error: String(e) }; }
}
