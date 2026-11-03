import { isManagement, moduleResources } from "@/lib/module-access";
import { AppShell } from "@/components/app-shell";
import { getAuthUser, getRequestClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

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
  const viewable = isManagement(roles) ? moduleResources : (
    await Promise.all(moduleResources.map(async resource => {
      const { data } = await supabase.rpc("has_table_access", { resource, action: "select" });
      return data === true ? resource : null;
    }))
  ).filter((resource): resource is string => resource !== null);
  const company = profile?.companies as unknown as { name?: string } | null;
  return <AppShell userName={profile?.full_name?.split(" ")[0] ?? "Usuário"} companyName={company?.name ?? "Marquinhos Calhas e Esquadrias"} roles={roles} viewable={viewable}>{children}</AppShell>;
}
