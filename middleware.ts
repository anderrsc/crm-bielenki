import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Callback do WhatsApp (Meta/Evolution) nao tem sessao de navegador: a
  // rota valida a assinatura/segredo. Exigir login redirecionava para /login.
  if (["/api/whatsapp/webhook", "/api/internal/operations", "/crm-sw.js", "/manifest.webmanifest"].includes(request.nextUrl.pathname)) return;
  // O PC da empresa avisa o endereço do túnel; a rota valida o segredo.
  if (request.nextUrl.pathname === "/api/whatsapp/evolution-url") return;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    // Sem Supabase em producao: bloqueia em vez de liberar tudo sem login.
    if (process.env.NODE_ENV === "production") return new Response("Servidor sem configuracao do Supabase", { status: 500 });
    return;
  }
  return updateSession(request);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
