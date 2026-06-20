import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <AppShell userName="Configuração" companyName="CRM Bielenki">{children}</AppShell>;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name, companies(name)").eq("id", user.id).single();
  const company = profile?.companies as unknown as { name?: string } | null;
  return <AppShell userName={profile?.full_name?.split(" ")[0] ?? "Usuário"} companyName={company?.name ?? "CRM Bielenki"}>{children}</AppShell>;
}
