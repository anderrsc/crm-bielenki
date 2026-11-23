import { beforeEach, expect, test, vi } from "vitest";

// Responder citando pelo CRM: a ação grava a citação e manda a mensagem original ao WhatsApp.
type Row = Record<string, any>;
const fx = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, send: vi.fn() }));
let n = 0;
function database() {
  return { auth: { getUser: async () => ({ data: { user: { id: "user" } } }) }, from: (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let update: Row | null = null, insert: Row | null = null;
    const run = () => {
      if (insert) { const row = { id: `${table}-${++n}`, ...insert }; (fx.tables[table] ??= []).push(row); return { data: [row], error: null }; }
      const rows = (fx.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (update) rows.forEach((r) => Object.assign(r, update));
      return { data: rows, error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q, or: () => q, not: () => q,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      is: (k: string, v: unknown) => { filters.push((r) => r[k] == v); return q; },
      insert: (v: Row) => { insert = v; return q; }, update: (v: Row) => { update = v; return q; },
      single: async () => ({ data: run().data[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve(run()).then(ok),
    };
    return q;
  } };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => database() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => database() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/whatsapp/send", async (orig) => ({ ...(await orig<typeof import("@/lib/whatsapp/send")>()), sendWhatsAppText: fx.send }));
import { sendInboxMessage } from "@/app/(crm)/atendimento-actions";

const CONV = "30000000-0000-4000-8000-000000000001", ORIG = "30000000-0000-4000-8000-000000000002", REF = "30000000-0000-4000-8000-000000000003";
beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  fx.send.mockReset().mockResolvedValue("WA-NOVA");
  fx.tables = {
    profiles: [{ id: "user", company_id: "c1", full_name: "Rose Silva" }],
    conversations: [{ id: CONV, company_id: "c1", phone: "5547999990000", external_id: "5547999990000", channel_id: null }],
    messages: [{ id: ORIG, company_id: "c1", conversation_id: CONV, direction: "inbound", external_id: "WA-ORIG", body: "Qual a cor da calha?" }],
    ai_agent_config: [{ company_id: "c1", wpp_provider: "evolution", evolution_api_url: "https://evo.example.com", evolution_instance: "crm" }], companies: [{ id: "c1" }],
  };
});

test("resposta citando grava a citação e manda a original ao WhatsApp", async () => {
  expect(await sendInboxMessage(CONV, "Branca", { clientRef: REF, replyTo: ORIG })).toEqual({ ok: true });
  expect(fx.send.mock.calls[0][3]).toEqual({ quoted: { id: "WA-ORIG", fromMe: false, text: "Qual a cor da calha?" } });
  expect(fx.tables.messages.find((m) => m.client_ref === REF)).toMatchObject({ quoted_external_id: "WA-ORIG", quoted_preview: "Qual a cor da calha?", external_id: "WA-NOVA", delivery_status: "enviada" });
});

test("mensagem de outra conversa ou sem id no WhatsApp não vira citação", async () => {
  fx.tables.messages.push({ id: "30000000-0000-4000-8000-000000000009", company_id: "c1", conversation_id: "outra", direction: "inbound", external_id: "WA-X", body: "x" });
  await sendInboxMessage(CONV, "Oi", { clientRef: REF, replyTo: "30000000-0000-4000-8000-000000000009" });
  expect(fx.send.mock.calls[0][3]).toEqual({ quoted: null });
  expect(fx.tables.messages.find((m) => m.client_ref === REF)?.quoted_external_id).toBeUndefined();
});
