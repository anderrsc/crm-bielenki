import { NextRequest, NextResponse } from "next/server";

// Proxy para imagens do Supabase Storage — resolve CORS na impressão/PDF
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("Missing url", { status: 400 });

  // Só permite URLs do próprio Supabase do projeto
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let target: URL;
  try {
    target = new URL(url);
    const source = new URL(supabaseUrl);
    if (target.origin !== source.origin || target.protocol !== "https:" || target.username || target.password || !target.pathname.startsWith("/storage/v1/object/public/")) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const res = await fetch(target, { cache: "force-cache", redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!res.ok) return new NextResponse("Not found", { status: 404 });
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return new NextResponse("Invalid image", { status: 415 });
    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new NextResponse("Error fetching image", { status: 502 });
  }
}
