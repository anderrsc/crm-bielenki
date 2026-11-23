import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Auditoria do WhatsApp (23/11/2026), P2: a foto/áudio de uma conversa do 2º número fica na
// instância desse número na Evolution. Antes a rota sempre pedia à instância principal.
const tables: Record<string, Record<string, unknown>[]> = {};
function fakeDb() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => {
      const f: Array<[string, unknown]> = [];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => { f.push([k, v]); return q; },
        maybeSingle: async () => ({ data: (tables[table] ?? []).find((r) => f.every(([k, v]) => r[k] === v)) ?? null, error: null }),
      };
      return q;
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeDb() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeDb() }));
vi.mock("@/lib/encrypt", () => ({ decryptSecret: (v: string) => `claro:${v}` }));

import { GET } from "@/app/api/whatsapp/media/[id]/route";

const MSG = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  tables.ai_agent_config = [{ company_id: "c1", evolution_api_url: "https://evo.example.com", evolution_api_key: "chave", evolution_instance: "crm", wpp_provider: "evolution" }];
  tables.whatsapp_channels = [
    { id: "ch-principal", company_id: "c1", name: "Principal", provider: "evolution", instance: "crm", api_url: null, api_key: null, is_default: true, active: true },
    { id: "ch-calha", company_id: "c1", name: "Calha", provider: "evolution", instance: "crm-calha", api_url: null, api_key: null, is_default: false, active: true },
  ];
  tables.conversations = [{ id: "conv-calha", company_id: "c1", channel_id: "ch-calha" }, { id: "conv-antiga", company_id: "c1", channel_id: null }];
});
afterEach(() => { vi.unstubAllGlobals(); });

async function abrir(conversationId: string) {
  tables.messages = [{ id: MSG, company_id: "c1", conversation_id: conversationId, external_id: "WAMID1", body: "[foto]", media_url: null }];
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push(`${url} ${(init.headers as Record<string, string>).apikey}`);
    return new Response(JSON.stringify({ base64: Buffer.from("foto").toString("base64"), mimetype: "image/jpeg" }), { status: 200 });
  }));
  const res = await GET(new Request(`http://crm.test/api/whatsapp/media/${MSG}`) as never, { params: Promise.resolve({ id: MSG }) });
  return { res, calls };
}

test("mídia do 2º número é buscada na instância dele", async () => {
  const { res, calls } = await abrir("conv-calha");
  expect(res.status).toBe(200);
  expect(calls).toEqual(["https://evo.example.com/chat/getBase64FromMediaMessage/crm-calha claro:chave"]);
});

test("conversa antiga sem número continua usando a conexão principal", async () => {
  const { res, calls } = await abrir("conv-antiga");
  expect(res.status).toBe(200);
  expect(calls).toEqual(["https://evo.example.com/chat/getBase64FromMediaMessage/crm claro:chave"]);
});
