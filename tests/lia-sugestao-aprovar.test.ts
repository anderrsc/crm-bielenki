import { beforeEach, expect, test, vi } from "vitest";

// Auditoria do WhatsApp (23/11/2026), P3: aprovar a sugestão da Lia envia para o destino certo
// (inclusive contato "@lid") e, se o WhatsApp não confirmar a tempo, não devolve a sugestão
// (evita mandar duas vezes); falha de verdade devolve a sugestão para tentar de novo.
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
      select: () => q, order: () => q, limit: () => q,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      is: (k: string, v: unknown) => { filters.push((r) => r[k] == v); return q; },
      or: () => q, not: () => q,
      insert: (v: Row) => { insert = v; return q; },
      update: (v: Row) => { update = v; return q; },
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
import { approveLiaSuggestion } from "@/app/(crm)/atendimento-actions";

const CONV = "20000000-0000-4000-8000-000000000001", AT = "2026-11-23T12:00:00.000Z";
beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  fx.send.mockReset();
  fx.tables = {
    profiles: [{ id: "user", company_id: "c1", full_name: "Anderson" }],
    conversations: [{ id: CONV, company_id: "c1", phone: "123456789012345@lid", external_id: "123456789012345@lid", channel_id: null, ai_suggestion: "Olá! Já te retorno.", ai_suggestion_at: AT }],
    ai_agent_config: [{ company_id: "c1", agent_name: "Lia", wpp_provider: "evolution", evolution_api_url: "https://evo.example.com", evolution_instance: "crm" }],
    companies: [{ id: "c1" }], messages: [], ai_decisions: [],
  };
});

test("contato @lid recebe no identificador dele (não em um número inventado)", async () => {
  fx.send.mockResolvedValue("WA1");
  expect(await approveLiaSuggestion(CONV, AT)).toEqual({ ok: true });
  expect(fx.send.mock.calls[0][1]).toBe("123456789012345@lid");
  expect(fx.tables.messages[0]).toMatchObject({ direction: "outbound", author: "ana", external_id: "WA1", delivery_status: "enviada" });
});

test("sem confirmação do WhatsApp (tempo esgotado): fica 'desconhecido' e a sugestão não volta", async () => {
  fx.send.mockRejectedValue(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
  const r = await approveLiaSuggestion(CONV, AT);
  expect(r.ok).toBe(true);
  expect(r.warning).toMatch(/Confira no celular/);
  expect(fx.tables.messages[0]).toMatchObject({ delivery_status: "desconhecido", external_id: null });
  expect(fx.tables.conversations[0].ai_suggestion).toBeNull();
});

test("falha de verdade (servidor recusou): marca 'falhou' e devolve a sugestão", async () => {
  fx.send.mockRejectedValue(new Error("Evolution API HTTP 400"));
  const r = await approveLiaSuggestion(CONV, AT);
  expect(r.error).toMatch(/HTTP 400/);
  expect(fx.tables.messages[0]).toMatchObject({ delivery_status: "falhou" });
  expect(fx.tables.conversations[0].ai_suggestion).toBe("Olá! Já te retorno.");
});
