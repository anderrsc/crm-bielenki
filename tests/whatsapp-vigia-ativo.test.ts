import { afterEach, expect, test, vi } from "vitest";
import { evolutionProbe, evolutionWebhookConfig, webhookConfigProblems } from "@/lib/whatsapp/evolution";

// Auditoria do WhatsApp (23/11/2026), etapa C2: teste ativo da conexão e conferência do webhook.
afterEach(() => { vi.unstubAllGlobals(); });

test("configuração do webhook: só o caminho do endereço importa; desligado ou sem eventos é problema", () => {
  const ok = { enabled: true, url: "https://crm-bielenki.vercel.app/api/whatsapp/webhook", events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONTACTS_UPSERT", "CONNECTION_UPDATE"] };
  expect(webhookConfigProblems(ok)).toEqual([]);
  // Outro domínio do mesmo CRM e eventos no formato "messages.upsert" valem.
  expect(webhookConfigProblems({ ...ok, url: "https://crm.marquinhos.com.br/api/whatsapp/webhook/", events: ["messages.upsert", "messages.update", "connection.update"] })).toEqual([]);
  expect(webhookConfigProblems({ ...ok, enabled: false })).toEqual(["webhook desligado"]);
  expect(webhookConfigProblems({ ...ok, url: "https://outro-sistema.com/hook" })).toEqual(["endereço do webhook não aponta para o CRM"]);
  expect(webhookConfigProblems({ ...ok, events: ["CONNECTION_UPDATE"] })).toEqual(["eventos faltando: MESSAGES_UPSERT, MESSAGES_UPDATE"]);
  expect(webhookConfigProblems(null)).toEqual(["webhook não configurado"]);
  // Mudança de hospedagem: webhook ainda no endereço antigo é corrigido.
  expect(webhookConfigProblems(ok, "https://crm-bielenki-production.up.railway.app")).toEqual(["endereço do webhook não aponta para o CRM"]);
  expect(webhookConfigProblems({ ...ok, url: "https://crm-bielenki-production.up.railway.app/api/whatsapp/webhook" }, "https://crm-bielenki-production.up.railway.app")).toEqual([]);
});

test("lê a configuração do webhook da Evolution (com ou sem envelope 'webhook') e nunca expõe o segredo", async () => {
  const calls: string[] = [];
  const answers = [
    { url: "https://crm.test/api/whatsapp/webhook", enabled: true, events: ["MESSAGES_UPSERT"], headers: { "x-webhook-secret": "segredo" } },
    { webhook: { url: "https://crm.test/api/whatsapp/webhook", enabled: false, events: [] } },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return new Response(JSON.stringify(answers.shift()), { status: 200 }); }));
  const a = await evolutionWebhookConfig("https://evo.example.com", "k", "crm-calha");
  expect(a).toEqual({ enabled: true, url: "https://crm.test/api/whatsapp/webhook", events: ["MESSAGES_UPSERT"] });
  expect(JSON.stringify(a)).not.toContain("segredo");
  expect(await evolutionWebhookConfig("https://evo.example.com", "k", "crm-calha")).toEqual({ enabled: false, url: "https://crm.test/api/whatsapp/webhook", events: [] });
  expect(calls[0]).toBe("https://evo.example.com/webhook/find/crm-calha");
});

test("teste ativo: pergunta ao WhatsApp pelo próprio número; falha ou erro do servidor não passam", async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify([{ exists: true, jid: "5547999990000@s.whatsapp.net" }]), { status: 200 }); }));
  expect(await evolutionProbe("https://evo.example.com", "k", "crm", "+55 (47) 99999-0000")).toBe(true);
  expect(bodies[0]).toEqual({ numbers: ["5547999990000"] });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Connection Closed" }), { status: 500 })));
  await expect(evolutionProbe("https://evo.example.com", "k", "crm", "5547999990000")).rejects.toThrow(/HTTP 500/);
  vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }));
  await expect(evolutionProbe("https://evo.example.com", "k", "crm", "5547999990000")).rejects.toThrow();
  await expect(evolutionProbe("https://evo.example.com", "k", "crm", "")).rejects.toThrow(/desconhecido/);
});
