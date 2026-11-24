import { isManagement, moduleResources } from "@/lib/module-access";
import { AppShell } from "@/components/app-shell";
import { getAuthUser, getRequestClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Server Actions rodam dentro da rota da página: sem isto a Vercel corta em poucos segundos as ações que chamam IA
// (ler nota fiscal, importar proposta do WVetro, testar a IA) e o navegador só vê "Tente de novo".
export const maxDuration = 60;

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <AppShell userName="Configuração" companyName="Marquinhos Calhas e Esquadrias">{children}</AppShell>;
  const supabase = await getRequestClient();
  const user = await getAuthUser(supabase);
  if (!user) redirect("/login");
  const [{ data: profile }, { data: roleValues }] = await Promise.all([
    supabase.from("profiles").select("full_name, companies(name)").eq("id", user.id).single(),
    supabase.rpc("current_user_roles"),
  ]);
  const roles = (roleValues as string[] | null) ?? [];
  const viewable = isManagement(roles) ? moduleResources : await viewableModules(supabase);
  const company = profile?.companies as unknown as { name?: string } | null;
  // Selo de não lidas na barra do celular: só quem enxerga o Atendimento recebe linhas (RLS), então a soma não vaza.
  const unreadChats = await unreadConversations(supabase);
  return <AppShell userName={profile?.full_name?.split(" ")[0] ?? "Usuário"} companyName={company?.name ?? "Marquinhos Calhas e Esquadrias"} roles={roles} viewable={viewable} unreadChats={unreadChats}>{children}</AppShell>;
}

async function viewableModules(supabase: Awaited<ReturnType<typeof getRequestClient>>): Promise<string[]> {
  const { data, error } = await supabase.rpc("viewable_resources", { p_resources: moduleResources });
  if (!error && Array.isArray(data)) return data as string[];
  // Banco ainda sem a funcao nova: consulta modulo por modulo.
  return (
    await Promise.all(moduleResources.map(async resource => {
      const { data } = await supabase.rpc("has_table_access", { resource, action: "select" });
      return data === true ? resource : null;
    }))
  ).filter((resource): resource is string => resource !== null);
}

async function unreadConversations(supabase: Awaited<ReturnType<typeof getRequestClient>>): Promise<number> {
  try {
    const { data } = await supabase.from("conversations").select("unread_count").gt("unread_count", 0).is("archived_at", null).limit(500);
    return ((data ?? []) as { unread_count: number | null }[]).reduce((n, row) => n + (row.unread_count ?? 0), 0);
  } catch { return 0; }
}
