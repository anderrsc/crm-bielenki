// Tipos compartilhados da Lia Interna (cliente e servidor).

export type LiaChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type LiaActionCard = {
  tool: string;
  preview: string;
  params: Record<string, unknown>;
  confirmLabel?: string;
};

export type LiaChatResponse = {
  session_id: string;
  reply: string;
  action_card?: LiaActionCard;
  error?: string;
};

// Formato de mensagem para o loop Gemini (interno)
export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

// Resultado de uma tool (read ou write)
export type ToolResult =
  | { type: "ok"; data: unknown }
  | { type: "error"; message: string }
  | { type: "needs_confirmation"; preview: string; params: Record<string, unknown> };
