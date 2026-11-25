// Loop de function calling para a Lia Interna.
// Usa Gemini Flash (gratuito) como primário; fallback para Claude Haiku se falhar.

import { TOOL_DECLARATIONS, executeTool } from "./tools";
import { LIA_SYSTEM_PROMPT } from "./prompt";
import type { GeminiContent, LiaActionCard, ToolResult } from "./types";

const MAX_ITERATIONS = 6;

type LoopResult =
  | { type: "reply"; text: string }
  | { type: "action_required"; card: LiaActionCard; partial_reply?: string }
  | { type: "error"; message: string };

// ── Gemini ────────────────────────────────────────────────────────────────────

async function callGemini(
  messages: GeminiContent[],
  apiKey: string,
): Promise<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> {
  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    system_instruction: { parts: [{ text: LIA_SYSTEM_PROMPT }] },
    contents: messages,
    tools: [{ function_declarations: TOOL_DECLARATIONS }],
    tool_config: { function_calling_config: { mode: "AUTO" } },
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    if (res.status === 404) {
      // Try fallback model
      const res2 = await fetch(url.replace("gemini-2.0-flash", "gemini-flash-latest"), {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, contents: messages }),
      });
      if (!res2.ok) throw new Error(`Gemini error ${res2.status}`);
      const data2 = await res2.json();
      return parseGeminiResponse(data2);
    }
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return parseGeminiResponse(data);
}

function parseGeminiResponse(data: unknown): { text?: string; functionCall?: { name: string; args: Record<string, unknown> } } {
  const candidate = (data as { candidates?: { content?: { parts?: unknown[]; role?: string } }[] }).candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  for (const part of parts as Record<string, unknown>[]) {
    if (part.functionCall) {
      const fc = part.functionCall as { name: string; args: Record<string, unknown> };
      return { functionCall: { name: fc.name, args: fc.args ?? {} } };
    }
    if (typeof part.text === "string" && part.text.trim()) {
      return { text: part.text };
    }
  }
  return { text: "Não entendi. Pode reformular?" };
}

// ── Claude Haiku fallback ─────────────────────────────────────────────────────

async function callClaude(
  messages: GeminiContent[],
  apiKey: string,
): Promise<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 30_000 });

  // Convert GeminiContent to Anthropic messages
  const anthropicMessages: { role: "user" | "assistant"; content: string | unknown[] }[] = messages.map((m) => {
    if (m.role === "model") {
      const textPart = m.parts.find((p): p is { text: string } => "text" in p);
      const fcPart = m.parts.find((p): p is { functionCall: { name: string; args: Record<string, unknown> } } => "functionCall" in p);
      if (fcPart) {
        return { role: "assistant" as const, content: [{ type: "tool_use", id: "tool_1", name: fcPart.functionCall.name, input: fcPart.functionCall.args }] };
      }
      return { role: "assistant" as const, content: textPart?.text ?? "" };
    }
    const textParts = m.parts.filter((p): p is { text: string } => "text" in p);
    const frParts = m.parts.filter((p): p is { functionResponse: { name: string; response: Record<string, unknown> } } => "functionResponse" in p);
    if (frParts.length) {
      return { role: "user" as const, content: frParts.map((p) => ({ type: "tool_result", tool_use_id: "tool_1", content: JSON.stringify(p.functionResponse.response) })) };
    }
    return { role: "user" as const, content: textParts.map((p) => p.text).join("") };
  });

  const tools = TOOL_DECLARATIONS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const response = await client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 2048,
    system: LIA_SYSTEM_PROMPT,
    tools: tools as Parameters<typeof client.messages.create>[0]["tools"],
    messages: anthropicMessages as Parameters<typeof client.messages.create>[0]["messages"],
  });

  for (const block of response.content) {
    if (block.type === "tool_use") {
      return { functionCall: { name: block.name, args: block.input as Record<string, unknown> } };
    }
    if (block.type === "text" && block.text.trim()) {
      return { text: block.text };
    }
  }
  return { text: "Não entendi. Pode reformular?" };
}

// ── Loop principal ────────────────────────────────────────────────────────────

export async function liaLoop(
  userMessage: string,
  history: GeminiContent[],
  keys: { gemini?: string | null; anthropic?: string | null },
  context: { companyId: string; userId: string; sessionId: string },
): Promise<LoopResult> {
  if (!keys.gemini && !keys.anthropic) {
    return { type: "error", message: "Configure a chave do Gemini ou da Anthropic na Central de IA." };
  }

  const messages: GeminiContent[] = [
    ...history,
    { role: "user", parts: [{ text: userMessage }] },
  ];

  let partialReply: string | undefined;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let response: { text?: string; functionCall?: { name: string; args: Record<string, unknown> } };
    try {
      if (keys.gemini) {
        response = await callGemini(messages, keys.gemini);
      } else {
        response = await callClaude(messages, keys.anthropic!);
      }
    } catch (err) {
      // Gemini falhou, tenta Anthropic
      if (keys.gemini && keys.anthropic) {
        try {
          response = await callClaude(messages, keys.anthropic);
        } catch {
          return { type: "error", message: "A IA não está disponível no momento. Tente novamente em instantes." };
        }
      } else {
        const msg = err instanceof Error ? err.message : "Erro na IA";
        return { type: "error", message: msg };
      }
    }

    if (response.text) {
      return { type: "reply", text: response.text };
    }

    if (!response.functionCall) {
      return { type: "reply", text: partialReply ?? "Pronto." };
    }

    const { name, args } = response.functionCall;

    // Add model's function call to messages
    messages.push({ role: "model", parts: [{ functionCall: { name, args } }] });

    // Execute tool
    const result: ToolResult = await executeTool(name, args, context);

    if (result.type === "needs_confirmation") {
      return {
        type: "action_required",
        card: {
          tool: name,
          preview: result.preview,
          params: result.params,
          confirmLabel: "Confirmar",
        },
        partial_reply: partialReply,
      };
    }

    // Add function response to messages
    const responseData = result.type === "ok"
      ? { result: result.data }
      : { error: result.message };
    messages.push({
      role: "user",
      parts: [{ functionResponse: { name, response: responseData } }],
    });

    // If result was an error, let the model compose an error message
    // Otherwise continue the loop
  }

  return { type: "reply", text: partialReply ?? "Desculpe, não consegui completar a operação." };
}
