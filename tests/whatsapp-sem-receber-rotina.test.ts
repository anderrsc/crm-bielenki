import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("web-push", () => ({ default: { sendNotification: vi.fn() } }));
vi.mock("@/lib/whatsapp/channels", () => ({ channelCredentials: () => ({ evolutionUrl: "https://evo.example.com", evolutionKey: "k", evolutionInstance: "crm" }) }));
vi.mock("@/lib/whatsapp/evolution", () => ({
  evolutionState: vi.fn(async () => "open"), evolutionProbe: vi.fn(async () => true), evolutionRestart: vi.fn(async () => undefined),
  evolutionOwnerPhone: vi.fn(async () => null), evolutionSetWebhook: vi.fn(), webhookConfigProblems: () => [],
  evolutionWebhookConfig: vi.fn(async () => null),
}));
vi.mock("@/lib/whatsapp/evolution-history", () => ({ syncRecentEvolutionMessages: vi.fn(async () => ({ inserted: 0 })) }));
vi.mock("@/lib/lia-followups", () => ({ runLiaFollowups: vi.fn() }));

import { runOperations } from "@/lib/operations";

// Banco de mentira: cada tabela devolve as linhas dadas; as chamadas de função ficam registradas.
function fakeDb(tables: Record<string, unknown[]>) {
  const rpcs: Array<{ name: string; args: Record<string, string> }> = [];
  const query = (rows: unknown[]) => {
    const q: Record<string, unknown> = {
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok, no),
    };
    for (const m of ["select", "eq", "not", "is", "or", "in", "lt", "order", "limit", "update", "insert", "delete"]) q[m] = () => q;
    return q;
  };
  const db = { from: (t: string) => query(tables[t] ?? []), rpc: async (name: string, args: Record<string, string>) => { rpcs.push({ name, args }); return { data: null, error: null }; } };
  return { db: db as never, rpcs };
}
const channel = (extra: object) => ({ id: "canal-1", company_id: "empresa", name: "WhatsApp principal", provider: "evolution", instance: "crm", is_default: true, active: true, phone_display: "5547999990000", ...extra });
const alerts = (rpcs: Array<{ name: string; args: Record<string, string> }>) => rpcs.filter((r) => r.name === "notify_team_service" && r.args.p_event.startsWith("wa-deaf:"));

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-27T10:29:00-03:00")); });
afterEach(() => { vi.useRealTimers(); });

test("rotina avisa a equipe para ler o QR quando o reinício não resolveu", async () => {
  const { db, rpcs } = fakeDb({
    whatsapp_channels: [channel({ last_message_event_at: "2026-11-27T10:45:00+00:00", last_restart_at: "2026-11-27T11:16:00+00:00" })],
    conversations: [{ last_inbound_at: "2026-11-27T10:45:00+00:00" }],
  });
  await runOperations(db, { vapid_public: "p", vapid_private: "s" });
  const [alert, ...rest] = alerts(rpcs);
  expect(rest).toHaveLength(0);
  // Mesma chave a cada rodada: o banco não repete o aviso no mesmo período mudo.
  expect(alert.args.p_event).toBe("wa-deaf:canal-1:2026-11-27T10:45");
  expect(alert.args.p_body).toContain("27/11, 07:45");
  expect(alert.args.p_body).toContain("QR");
  expect(alert.args.p_link).toBe("/atendimento/canais");
});

test("mensagem recuperada pela reconciliação não gera alarme falso", async () => {
  const { db, rpcs } = fakeDb({
    whatsapp_channels: [channel({ last_message_event_at: "2026-11-27T10:45:00+00:00", last_restart_at: "2026-11-27T11:16:00+00:00" })],
    conversations: [{ last_inbound_at: "2026-11-27T13:25:00+00:00" }],
  });
  await runOperations(db, { vapid_public: "p", vapid_private: "s" });
  expect(alerts(rpcs)).toHaveLength(0);
});
