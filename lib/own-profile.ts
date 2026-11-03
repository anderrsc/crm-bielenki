import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/supabase/server";

// Perfil do usuario logado. A policy de profiles deixa ver todos os perfis
// da empresa, entao `from("profiles").select(...).single()` sem filtro falha
// ("multiple rows") assim que a empresa tem mais de um funcionario.
export async function selectOwnProfile<T = Record<string, unknown>>(db: SupabaseClient, columns: string) {
  const user = await getAuthUser(db);
  if (!user) return { data: null as T | null, error: { message: "Não autenticado" } };
  const { data, error } = await db.from("profiles").select(columns).eq("id", user.id).single();
  return { data: data as T | null, error };
}
