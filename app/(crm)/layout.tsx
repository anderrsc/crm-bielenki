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
  const company = profile?.companies as unknown as { name?: string } | null;
  return <AppShell userName={profile?.full_name?.split(" ")[0] ?? "Usuário"} companyName={company?.name ?? "Marquinhos Calhas e Esquadrias"} roles={(roleValues as string[]|null)??[]}>{children}</AppShell>;
}
