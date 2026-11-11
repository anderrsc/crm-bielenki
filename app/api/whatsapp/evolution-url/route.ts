// O PC da empresa avisa aqui o endereço do túnel da Cloudflare (muda quando reinicia).
// Autenticado pelo segredo do webhook gerado pelo CRM. Só aceita *.trycloudflare.com.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { decryptSecret } from "@/lib/encrypt";
import { ensureEvolutionInstance, isTunnelUrl } from "@/lib/whatsapp/evolution";

export const maxDuration = 30;

function same(a: string, b: string) {
  return !!a && !!b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const instance = typeof body?.instance === "string" ? body.instance : "";
  const url = typeof body?.url === "string" ? body.url.trim().toLowerCase() : "";
  if (!instance || !isTunnelUrl(url)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "not_configured" }, { status: 500 });

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: cfg } = await db.from("ai_agent_config")
    .select("company_id, evolution_api_key, evolution_webhook_secret, evolution_api_url")
    .eq("evolution_instance", instance).maybeSingle();
  const hook = cfg?.evolution_webhook_secret ? decryptSecret(cfg.evolution_webhook_secret) : "";
  if (!cfg || !same(req.headers.get("x-webhook-secret") ?? "", hook)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const unchanged = cfg.evolution_api_url === url;
  if (!unchanged) {
    const { error: saveError } = await db.from("ai_agent_config")
      .update({ evolution_api_url: url, wpp_provider: "evolution", updated_at: new Date().toISOString() })
      .eq("company_id", cfg.company_id);
    if (saveError) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  // Tenta ligar a instância e o webhook em TODA chamada, inclusive quando
  // o túnel tem o mesmo endereço de uma tentativa anterior que falhou.
  const key = cfg.evolution_api_key ? decryptSecret(cfg.evolution_api_key) : "";
  let linked = false;
  if (key) {
    try {
      await ensureEvolutionInstance(url, key, instance, `${req.nextUrl.origin}/api/whatsapp/webhook`, hook);
      linked = true;
    } catch (e) {
      console.error("Evolution (PC): instância não ligada ainda:", e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ status: unchanged ? "unchanged" : "updated", linked });
}
