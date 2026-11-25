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
  const isLogin = request.nextUrl.pathname === "/login";
  // Rotas /api e server actions conferem permissao por conta propria (RLS): so a
  // sessao e renovada aqui, sem a consulta de acesso a cada foto/acao.
  const lightweight = request.nextUrl.pathname.startsWith("/api/") || (request.method === "POST" && request.headers.has("next-action"));
  const { resource, management } = moduleAccess(request.nextUrl.pathname);
  // O banco fica longe do servidor: a consulta de acesso sai junto com a conferência do login
  // (uma ida e volta a menos em cada página). Se a sessão precisou ser renovada, repete depois.
  const early = !isLogin && !lightweight && request.cookies.getAll().some((c) => c.name.includes("auth-token"))
    ? supabase.rpc("session_access", { p_resource: resource }).then((r) => r, (e) => ({ data: null, error: e }))
    : null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !isLogin) return NextResponse.redirect(new URL("/login", request.url));
  if (user && isLogin) return NextResponse.redirect(new URL("/dashboard", request.url));
  if (user && !lightweight) {
    // Status do perfil, cargos e acesso ao modulo numa unica consulta.
    let { data: access, error } = early ? await early : { data: null, error: true as unknown };
    if (error || !access) ({ data: access, error } = await supabase.rpc("session_access", { p_resource: resource }));
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
