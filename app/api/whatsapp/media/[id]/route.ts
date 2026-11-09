// Abre foto, áudio, vídeo e documento de uma mensagem: busca o arquivo na Evolution (que guardou a mensagem).
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/encrypt";
import { safeExternalUrl } from "@/lib/safe-url";

export const maxDuration = 30;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  // RLS: só acha mensagem da própria empresa.
  const { data: msg } = await db.from("messages").select("external_id,body,company_id").eq("id", id).maybeSingle();
  if (!msg?.external_id) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "not_configured" }, { status: 500 });
  // Rose/Bianca não leem a configuração da IA; o servidor lê por elas.
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: cfg } = await admin.from("ai_agent_config").select("evolution_api_url,evolution_api_key,evolution_instance").eq("company_id", msg.company_id).maybeSingle();
  const key = cfg?.evolution_api_key ? decryptSecret(cfg.evolution_api_key) : "";
  const base = cfg?.evolution_api_url ? safeExternalUrl(cfg.evolution_api_url) : null;
  if (!base || !key) return NextResponse.json({ error: "WhatsApp não conectado." }, { status: 400 });

  const audio = String(msg.body ?? "").startsWith("[áudio]");
  const res = await fetch(`${base}/chat/getBase64FromMediaMessage/${encodeURIComponent(cfg!.evolution_instance || "crm")}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(25_000),
    headers: { apikey: key, "Content-Type": "application/json" },
    // Áudio do WhatsApp é .ogg (iPhone não toca): pede convertido para mp4.
    body: JSON.stringify({ message: { key: { id: msg.external_id } }, convertToMp4: audio }),
  }).catch(() => null);
  if (!res?.ok) return NextResponse.json({ error: "O WhatsApp não tem mais esse arquivo." }, { status: 404 });
  const data = await res.json().catch(() => null) as { base64?: string; mimetype?: string; fileName?: string } | null;
  if (!data?.base64) return NextResponse.json({ error: "O WhatsApp não tem mais esse arquivo." }, { status: 404 });
  const bytes = Buffer.from(data.base64.replace(/^data:[^,]+,/, ""), "base64");
  const raw = (audio ? "audio/mp4" : data.mimetype?.split(";")[0]?.trim().toLowerCase()) || "";
  // Só abre na tela o que é seguro (nada de html/svg no domínio do CRM); o resto baixa.
  const safe = /^(image\/(jpeg|png|webp|gif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/.test(raw);
  const type = safe ? raw : "application/octet-stream";
  const name = (data.fileName || "arquivo").replace(/[^\w.\- ]/g, "_");
  return new NextResponse(bytes, { headers: {
    "Content-Type": type, "Cache-Control": "private, max-age=86400",
    "Content-Disposition": `${safe ? "inline" : "attachment"}; filename="${name}"`, "X-Content-Type-Options": "nosniff",
  } });
}
