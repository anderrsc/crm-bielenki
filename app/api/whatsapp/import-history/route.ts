// Importa uma página do histórico da Evolution para o Atendimento.
// Chamada em sequência pela Central de IA (página 1, 2, 3…) até acabar.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/encrypt";
import { fetchEvolutionMessages, importHistoryPage } from "@/lib/whatsapp/evolution-history";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const page = Math.max(1, Math.floor(Number(body?.page) || 1));
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
    if (!profile?.company_id) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 403 });
    // ai_agent_config só abre para administrador/gerente: quem não pode ver não importa.
    const { data: cfg } = await db.from("ai_agent_config").select("evolution_api_url,evolution_api_key,evolution_instance").eq("company_id", profile.company_id).maybeSingle();
    const key = cfg?.evolution_api_key ? decryptSecret(cfg.evolution_api_key) : "";
    if (!cfg?.evolution_api_url || !key) return NextResponse.json({ error: "WhatsApp (Evolution) não conectado." }, { status: 400 });

    const result = await fetchEvolutionMessages(cfg.evolution_api_url, key, cfg.evolution_instance || "crm", page);
    const records = result.messages?.records ?? [];
    const pages = result.messages?.pages ?? 0;
    const { inserted, conversations } = await importHistoryPage(db, profile.company_id, records);
    return NextResponse.json({ page, pages, total: result.messages?.total ?? 0, inserted, conversations, done: page >= pages || records.length === 0 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
