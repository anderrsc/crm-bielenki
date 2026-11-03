import { isManagement, moduleAccess } from "@/lib/module-access";
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
    const { resource, management } = moduleAccess(request.nextUrl.pathname);
    // Status do perfil, cargos e acesso ao modulo numa unica consulta.
    let { data: access, error } = await supabase.rpc("session_access", { p_resource: resource });
    if (error) {
      // Banco sem a migration 20261103000000 (ex.: preview antes de aplicar): consultas separadas.
      const [{ data: profile }, { data: roleList }, { data: canView }] = await Promise.all([
        supabase.from("profiles").select("status").eq("id", user.id).single(),
        supabase.rpc("current_user_roles"),
        resource ? supabase.rpc("has_table_access", { resource: resource, action: "select" }) : Promise.resolve({ data: true }),
      ]);
      access = { status: profile?.status, roles: roleList, allowed: canView };
    }
    const { status, roles, allowed } = (access ?? {}) as { status?: string; roles?: string[]; allowed?: boolean };
    if (status !== "ativo") {
      await supabase.auth.signOut();
      const target = new URL("/login", request.url);
      target.searchParams.set("erro", "Usuario inativo ou sem perfil");
      return NextResponse.redirect(target);
    }
    if (resource && !allowed) return NextResponse.redirect(new URL("/dashboard?erro=Sem+permissao", request.url));
    if (management && !isManagement(roles ?? [])) {
      return NextResponse.redirect(new URL("/dashboard?erro=Sem+permissao", request.url));
    }
  }
  return response;
}
