import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Etiquetas por conversa (RLS) e lembrete de cliente sem resposta (horário, atribuído, sem repetir).
let db: PGlite, A: string, B: string, convA: string, convB: string, labelA: string, labelB: string;
const boss = "00000000-0000-4000-8000-0000000008a1", bossB = "00000000-0000-4000-8000-0000000008b1", clerk = "00000000-0000-4000-8000-0000000008a2";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}
// Quarta-feira 18/11/2026, 14:00 em Brasília: dentro do horário de atendimento.
const QUARTA_14H = "2026-11-18T17:00:00Z";

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'a@t.invalid'),($2,'b@t.invalid'),($3,'c@t.invalid')", [boss, bossB, clerk]);
  A = (await row("select bootstrap_company('Etiquetas A',null,$1) id", [boss])).id;
  B = (await row("select bootstrap_company('Etiquetas B',null,$1) id", [bossB])).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Atendente')", [clerk, A]);
  await db.query("insert into user_roles(company_id,profile_id,role) values($1,$2,'atendente')", [A, clerk]);
  convA = (await row("insert into conversations(company_id,channel,phone,contact_name) values($1,'whatsapp','5547911110000','João') returning id", [A])).id;
  convB = (await row("insert into conversations(company_id,channel,phone) values($1,'whatsapp','5547922220000') returning id", [B])).id;
  labelA = (await row("insert into conversation_labels(company_id,name,color) values($1,'Orçamento VIP','blue') returning id", [A])).id;
  labelB = (await row("insert into conversation_labels(company_id,name,color) values($1,'Da outra','red') returning id", [B])).id;
  await db.exec("grant usage on schema auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated");
});
afterAll(async () => { await db?.close(); });

test("etiquetas: cada empresa vê só as suas e etiqueta só as próprias conversas", async () => {
  expect((await as(clerk, async () => (await db.query("select name from conversation_labels order by name")).rows)).map((r: any) => r.name)).toContain("Orçamento VIP");
  expect((await as(clerk, async () => (await db.query("select name from conversation_labels where company_id=$1", [B])).rows)).length).toBe(0);
  await as(clerk, async () => { await db.query("insert into conversation_label_links(conversation_id,label_id,company_id) values($1,$2,$3)", [convA, labelA, A]); });
  expect(Number((await row("select count(*) n from conversation_label_links where conversation_id=$1", [convA])).n)).toBe(1);
  await as(clerk, async () => {
    await expect(db.query("insert into conversation_label_links(conversation_id,label_id,company_id) values($1,$2,$3)", [convB, labelA, A])).rejects.toThrow(/row-level security/);
    await expect(db.query("insert into conversation_label_links(conversation_id,label_id,company_id) values($1,$2,$3)", [convA, labelB, A])).rejects.toThrow(/row-level security/);
  });
});

test("empresas existentes ganharam as etiquetas padrão sem duplicar nomes", async () => {
  await expect(db.query("insert into conversation_labels(company_id,name) values($1,'orçamento vip')", [A])).rejects.toThrow(/duplicate|unique/);
});

test("lembrete: avisa o atribuído depois de 2 h, só no horário, uma vez por mensagem", async () => {
  await db.query("update conversations set assigned_to=$2, status='aberta', last_inbound_at='2026-11-18T14:00:00Z', last_message_at='2026-11-18T14:00:00Z' where id=$1", [convA, clerk]);
  // 17:00Z = 14:00 em Brasília; mensagem 11:00 em Brasília (3 h antes).
  expect((await row("select collect_unanswered_conversations($1::timestamptz) n", [QUARTA_14H])).n).toBe(1);
  const n = await row("select profile_id, title, link from notifications where event_key like 'unanswered:%'");
  expect(n.profile_id).toBe(clerk);
  expect(n.link).toBe(`/atendimento?c=${convA}`);
  // Repetir não duplica.
  expect((await row("select collect_unanswered_conversations($1::timestamptz) n", [QUARTA_14H])).n).toBe(0);
  // Fora do horário (sábado) e com menos de 2 h: nada.
  await db.query("delete from notifications where event_key like 'unanswered:%'");
  expect((await row("select collect_unanswered_conversations('2026-11-21T17:00:00Z'::timestamptz) n")).n).toBe(0);
  expect((await row("select collect_unanswered_conversations('2026-11-18T15:30:00Z'::timestamptz) n")).n).toBe(0);
});

test("lembrete não dispara se a equipe respondeu por último ou a conversa foi resolvida", async () => {
  await db.query("update conversations set last_message_at='2026-11-18T14:30:00Z' where id=$1", [convA]);
  expect((await row("select collect_unanswered_conversations($1::timestamptz) n", [QUARTA_14H])).n).toBe(0);
  await db.query("update conversations set last_message_at=last_inbound_at, status='resolvida' where id=$1", [convA]);
  expect((await row("select collect_unanswered_conversations($1::timestamptz) n", [QUARTA_14H])).n).toBe(0);
});
