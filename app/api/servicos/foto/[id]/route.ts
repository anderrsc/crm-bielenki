import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

/** Foto de um servico. O acesso e conferido pelo RLS da tabela e do bucket (empresa + permissao). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Foto inválida." }, { status: 400 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const { data: photo } = await db.from("service_photos").select("file_path,original_name").eq("id", id).maybeSingle();
  if (!photo) return NextResponse.json({ error: "Foto não encontrada." }, { status: 404 });
  const { data: file, error } = await db.storage.from("service-photos").download(photo.file_path);
  if (error || !file) return NextResponse.json({ error: "Foto indisponível." }, { status: 404 });
  const ext = photo.file_path.split(".").pop()?.toLowerCase() ?? "";
  return new NextResponse(await file.arrayBuffer(), { headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
}
