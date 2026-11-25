import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executeConfirmedAction } from "@/lib/lia-interna/tools";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      session_id: string;
      params: Record<string, unknown>;
    };

    const { session_id, params } = body;
    if (!session_id || !params?.tool) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }

    const db = await createClient();
    const { data: { user }, error: authErr } = await db.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
    if (!profile?.company_id) {
      return NextResponse.json({ error: "Empresa não identificada." }, { status: 403 });
    }

    // Validate session belongs to user
    const { data: session } = await db.from("lia_chat_sessions")
      .select("id")
      .eq("id", session_id)
      .eq("company_id", profile.company_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!session) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 403 });
    }

    const result = await executeConfirmedAction(params, {
      companyId: profile.company_id,
      userId: user.id,
      sessionId: session_id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Save assistant confirmation message
    await db.from("lia_messages").insert({
      session_id,
      company_id: profile.company_id,
      role: "assistant",
      content: `✓ ${result.message}`,
    });

    return NextResponse.json({
      ok: true,
      message: result.message,
      action_id: result.action_id,
    });
  } catch (err) {
    console.error("[lia-interna/confirm]", err);
    return NextResponse.json({ error: "Erro interno. Tente novamente." }, { status: 500 });
  }
}
