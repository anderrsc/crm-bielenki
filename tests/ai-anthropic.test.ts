import { afterEach, expect, test, vi } from "vitest";
import { aiChat, aiProviderKey, modelForProvider, parseAiProvider } from "@/lib/ai/chat";

afterEach(() => vi.unstubAllGlobals());

test("Claude é provedor válido, com modelo e chave próprios", () => {
  expect(parseAiProvider("anthropic")).toBe("anthropic");
  expect(modelForProvider("anthropic", "gpt-4o")).toBe("claude-sonnet-5-5");
  expect(modelForProvider("anthropic", "claude-haiku-5-5")).toBe("claude-haiku-5-5");
  expect(modelForProvider("groq", "claude-sonnet-5-5")).toBe("openai/gpt-oss-120b");
  expect(aiProviderKey("anthropic", { anthropic_api_key: "a", openai_api_key: "o" })).toBe("a");
  expect(aiProviderKey("groq", { openai_api_key: "o" })).toBe("o");
});

test("Lia no Claude: system vai no campo próprio, com fallback e sem temperatura", async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
    id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: "Olá! Como posso ajudar?" }],
  }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const reply = await aiChat({ provider: "anthropic", apiKey: "sk-ant-test", messages: [{ role: "system", content: "Você é a Lia." }, { role: "assistant", content: "Oi" }, { role: "user", content: "Quero calha" }] });
  expect(reply).toBe("Olá! Como posso ajudar?");
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.system).toBe("Você é a Lia.");
  expect(body.messages[0].role).toBe("user");
  expect(body.fallbacks).toBe("default");
  expect(body).not.toHaveProperty("temperature");
});
