import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/encrypt";
import { liaLoop } from "@/lib/lia-interna/loop";
import type { GeminiContent } from "@/lib/lia-interna/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      session_id?: string;
      message: string;
      history?: GeminiContent[];
    };

    const { message, history = [] } = body;
    if (!message?.trim()) {
      return NextResponse.json({ error: "Mensagem vazia." }, { status: 400 });
    }

    const db = await createClient();
    const { data: { user }, error: authErr } = await db.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const { data: profile } = await db.from("profiles").select("company_id").single();
    if (!profile?.company_id) {
      return NextResponse.json({ error: "Empresa não identificada." }, { status: 403 });
    }

    const { data: cfg } = await db.from("ai_agent_config")
      .select("gemini_api_key,anthropic_api_key")
      .maybeSingle();

    const geminiKey = cfg?.gemini_api_key ? decryptSecret(cfg.gemini_api_key as string) : null;
    const anthropicKey = cfg?.anthropic_api_key ? decryptSecret(cfg.anthropic_api_key as string) : null;

    // Create or reuse session
    let sessionId = body.session_id ?? "";
    if (sessionId) {
      const { data: existing } = await db.from("lia_chat_sessions")
        .select("id")
        .eq("id", sessionId)
        .eq("company_id", profile.company_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!existing) sessionId = "";
    }
    if (!sessionId) {
      const { data: session } = await db.from("lia_chat_sessions").insert({
        company_id: profile.company_id,
        user_id: user.id,
        title: message.slice(0, 80),
      }).select("id").single();
      sessionId = session?.id ?? crypto.randomUUID();
    } else {
      await db.from("lia_chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);
    }

    // Save user message
    await db.from("lia_messages").insert({
      session_id: sessionId,
      company_id: profile.company_id,
      role: "user",
      content: message,
    });

    // Run the AI loop
    const result = await liaLoop(
      message,
      history,
      { gemini: geminiKey, anthropic: anthropicKey },
      { companyId: profile.company_id, userId: user.id, sessionId },
    );

    if (result.type === "error") {
      return NextResponse.json({ error: result.message, session_id: sessionId }, { status: 500 });
    }

    if (result.type === "action_required") {
      return NextResponse.json({
        session_id: sessionId,
        reply: result.partial_reply ?? "Preciso da sua confirmação para continuar:",
        action_card: result.card,
      });
    }

    // Save assistant reply
    await db.from("lia_messages").insert({
      session_id: sessionId,
      company_id: profile.company_id,
      role: "assistant",
      content: result.text,
    });

    return NextResponse.json({
      session_id: sessionId,
      reply: result.text,
    });
  } catch (err) {
    console.error("[lia-interna/chat]", err);
    return NextResponse.json({ error: "Erro interno. Tente novamente." }, { status: 500 });
  }
}
