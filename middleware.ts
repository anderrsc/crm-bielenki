import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Provider callbacks authenticate with the signature checked by the route,
  // rather than a browser session. Requiring a CRM login breaks delivery.
  if (request.nextUrl.pathname === "/api/whatsapp/webhook") return;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  return updateSession(request);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
