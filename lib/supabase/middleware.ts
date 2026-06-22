import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items: { name: string; value: string; options: CookieOptions }[]) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  const isLogin = request.nextUrl.pathname === "/login";
  if (!user && !isLogin) return NextResponse.redirect(new URL("/login", request.url));
  if (user && isLogin) return NextResponse.redirect(new URL("/dashboard", request.url));
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("status").eq("id", user.id).single();
    if (!profile || profile.status !== "ativo") {
      await supabase.auth.signOut();
      const target = new URL("/login", request.url);
      target.searchParams.set("erro", "Usuario inativo ou sem perfil");
      return NextResponse.redirect(target);
    }

    const first = request.nextUrl.pathname.split("/").filter(Boolean)[0] ?? "dashboard";
    const resources: Record<string, string> = {
      clientes: "clients", pipeline: "leads", orcamentos: "quotes", vendas: "sales",
      pedidos: "orders", compras: "purchase_orders", fornecedores: "suppliers",
      estoque: "materials", producao: "production_orders", instalacoes: "installations",
      financeiro: "financial_entries", relatorios: "sales", auditoria: "audit_logs",
    };
    if (resources[first]) {
      const { data: allowed } = await supabase.rpc("has_table_access", { resource: resources[first], action: "select" });
      if (!allowed) return NextResponse.redirect(new URL("/dashboard?erro=Sem+permissao", request.url));
    }
    if (["configuracoes", "automacoes", "agente-ia", "central-ia"].includes(first)) {
      const { data: roles } = await supabase.rpc("current_user_roles");
      if (!(roles as string[] | null)?.some(role => role === "administrador" || role === "gerente")) {
        return NextResponse.redirect(new URL("/dashboard?erro=Sem+permissao", request.url));
      }
    }
  }
  return response;
}
