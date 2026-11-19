import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";
import { planFollowUps, type FollowUpCandidate } from "@/lib/lia-followups";

// Acompanhamento automático: quem entra na lista, quem fica de fora e o que sai (sem duplicar).
let db: PGlite, company: string, client: string;
const user = "00000000-0000-4000-8000-0000000009a1";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
const conv = async (phone: string, extra: Record<string, unknown> = {}) => {
  const f = { channel: "whatsapp", phone, contact_name: "Carlos Silva", ai_paused: false, status: "aberta", last_inbound_at: "2026-11-16T14:00:00Z", last_message_at: "2026-11-16T14:05:00Z", ...extra };
  return (await row(`insert into conversations(company_id,${Object.keys(f).join(",")}) values($1,${Object.keys(f).map((_, i) => `$${i + 2}`).join(",")}) returning id`, [company, ...Object.values(f)])).id as string;
};
const candidates = async (now = "2026-11-17T17:30:00Z") => (await db.query<FollowUpCandidate>("select * from lia_followup_candidates($1, $2::timestamptz)", [company, now])).rows;
const run = (id: string, n: number, key: string, status: string) =>
  db.query("insert into lia_automation_executions(company_id,conversation_id,kind,attempt,event_key,status) values($1,$2,'followup',$3,$4,$5)", [company, id, n, key, status]);

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'f@t.invalid')", [user]);
  company = (await row("select bootstrap_company('Acompanhamento',null,$1) id", [user])).id;
  client = (await row("insert into clients(company_id,name,phone) values($1,'Cliente antigo','47900000099') returning id", [company])).id;
});
afterAll(async () => { await db?.close(); });

test("só entra lead que já falou, atendido pela Lia, com a última mensagem nossa", async () => {
  const lead = await conv("5547911110001");
  await conv("5547911110002", { client_id: client });                       // já é cliente
  await conv("5547911110003", { ai_paused: true });                         // equipe assumiu
  await conv("5547911110004", { status: "resolvida" });                     // encerrada
  await conv("5547911110005", { last_message_at: "2026-11-16T13:00:00Z" }); // cliente falou por último
  await conv("5547911110006", { last_inbound_at: "2026-10-01T14:00:00Z", last_message_at: "2026-10-01T14:05:00Z" }); // antiga demais
  const list = await candidates();
  expect(list.map((c) => c.phone)).toEqual(["5547911110001"]);
  expect(list[0]).toMatchObject({ conversation_id: lead, attempts: 0, opted_out: false });
});

test("planeja 1 envio com nome, chave única e texto sem emoji; respeita expediente e limite", async () => {
  const list = await candidates();
  const plans = planFollowUps(list, { now: new Date("2026-11-17T17:30:00Z"), sentToday: 0, dailyLimit: 15 }); // terça 14:30
  expect(plans).toHaveLength(1);
  expect(plans[0].text.startsWith("Olá, Carlos!")).toBe(true);
  expect(plans[0].text).not.toMatch(/\p{Extended_Pictographic}/u);
  expect(plans[0].key).toBe(`followup:${plans[0].candidate.conversation_id}:1:${Math.floor(Date.parse("2026-11-16T14:00:00Z") / 1000)}`);
  expect(planFollowUps(list, { now: new Date("2026-11-21T17:30:00Z"), sentToday: 0, dailyLimit: 15 })).toHaveLength(0); // sábado
  expect(planFollowUps(list, { now: new Date("2026-11-17T17:30:00Z"), sentToday: 15, dailyLimit: 15 })).toHaveLength(0);
  expect(planFollowUps(list, { now: new Date("2026-11-17T13:00:00Z"), sentToday: 0, dailyLimit: 15 })).toHaveLength(0); // ter 10:00, ainda não deu 24 h
});

test("a mesma tentativa não duplica e depois de 3 enviadas para de vez", async () => {
  const c = (await candidates())[0];
  const key = (n: number) => `followup:${c.conversation_id}:${n}:${Math.floor(Date.parse(c.last_inbound_at) / 1000)}`;
  await run(c.conversation_id, 1, key(1), "enviada");
  await expect(run(c.conversation_id, 1, key(1), "enviando")).rejects.toThrow(/duplicate|unique/);
  expect((await candidates())[0].attempts).toBe(1);
  for (const n of [2, 3]) await run(c.conversation_id, n, key(n), "enviada");
  const after = (await candidates())[0];
  expect(after.attempts).toBe(3);
  expect(planFollowUps([after], { now: new Date("2026-11-24T17:30:00Z"), sentToday: 0, dailyLimit: 15 })).toHaveLength(0);
});

test("tentativa que falhou não conta e quem pediu para parar não recebe", async () => {
  const id = await conv("5547911110007");
  await run(id, 1, "k-falhou", "falhou");
  const c = (await candidates()).find((x) => x.conversation_id === id)!;
  expect(c.attempts).toBe(0);
  await db.query("update conversations set ai_opt_out=true where id=$1", [id]);
  const parou = (await candidates()).find((x) => x.conversation_id === id)!;
  expect(planFollowUps([parou], { now: new Date("2026-11-17T17:30:00Z"), sentToday: 0, dailyLimit: 15 })).toHaveLength(0);
});
