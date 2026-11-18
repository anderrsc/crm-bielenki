import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// JARVIS agenda medição pelo próprio usuário: só na empresa dele, sem duplicar e com auditoria.
let db: PGlite, company: string, client: string, otherClient: string;
const boss = "00000000-0000-4000-8000-000000000291", jarvis = "00000000-0000-4000-8000-000000000292", outsider = "00000000-0000-4000-8000-000000000293";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
async function rows(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows; }
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'boss@test.invalid'),($2,'jarvis@test.invalid'),($3,'out@test.invalid')", [boss, jarvis, outsider]);
  company = (await row("select bootstrap_company('Med',null,$1) id", [boss])).id;
  const other = (await row("select bootstrap_company('Outra',null,$1) id", [outsider])).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'JARVIS')", [jarvis, company]);
  await db.query("insert into user_roles(company_id,profile_id,role) values($2,$1,'atendente')", [jarvis, company]);
  await db.query("insert into permissions(role,resource,can_view,can_create,can_update,can_delete) values('atendente','clients',true,false,false,false),('atendente','operational_events',true,true,false,false) on conflict (role,resource) do update set can_view=excluded.can_view,can_create=excluded.can_create");
  await db.exec("grant usage on schema auth to authenticated");
  client = (await row("insert into clients(company_id,name,phone,address,neighborhood,city) values($1,'Maria Souza','(47) 99999-1234','Rua A, 10','Centro','Jaraguá do Sul') returning id", [company])).id;
  otherClient = (await row("insert into clients(company_id,name) values($1,'Maria da Outra') returning id", [other])).id;
});
afterAll(async () => { await db?.close(); });

test("busca cliente por nome ou telefone só na própria empresa", async () => {
  const byName = await as(jarvis, () => rows("select id,name,phone from jarvis_find_clients('maria')"));
  expect(byName).toEqual([{ id: client, name: "Maria Souza", phone: "(47) 99999-1234" }]);
  expect((await as(jarvis, () => rows("select id from jarvis_find_clients('9999-1234')"))).map((r) => r.id)).toEqual([client]);
  await expect(as(jarvis, () => rows("select * from jarvis_find_clients('a')"))).rejects.toThrow(/2 a 120/);
});

test("agenda medição com endereço do cliente, auditoria e sem duplicar", async () => {
  const quando = new Date(Date.now() + 2 * 86400000).toISOString();
  const r1 = (await as(jarvis, () => row("select jarvis_schedule_measurement('pedido-0001',$1,$2,'Calha nos fundos') r", [client, quando]))).r;
  expect(r1.ja_existia).toBe(false);
  const ev = await row("select event_type,title,address,phone,status,notes,created_by from operational_events where id=$1", [r1.id]);
  expect(ev).toEqual({ event_type: "medicao", title: "Medição - Maria Souza", address: "Rua A, 10, Centro, Jaraguá do Sul", phone: "(47) 99999-1234", status: "agendado", notes: "Agendado pelo JARVIS | Calha nos fundos", created_by: jarvis });
  const r2 = (await as(jarvis, () => row("select jarvis_schedule_measurement('pedido-0001',$1,$2) r", [client, quando]))).r;
  expect(r2).toMatchObject({ id: r1.id, ja_existia: true });
  expect((await row("select count(*)::int n from operational_events where external_ref='pedido-0001'")).n).toBe(1);
  expect((await row("select action,profile_id from audit_logs where record_id=$1 and action='jarvis_agendar_medicao'", [r1.id]))).toEqual({ action: "jarvis_agendar_medicao", profile_id: jarvis });
});

test("recusa data passada, cliente de outra empresa e quem não pode agendar", async () => {
  await expect(as(jarvis, () => row("select jarvis_schedule_measurement('pedido-0002',$1,now()-interval '2 days')", [client]))).rejects.toThrow(/Data da medição inválida/);
  await expect(as(jarvis, () => row("select jarvis_schedule_measurement('pedido-0003',$1,now()+interval '1 day')", [otherClient]))).rejects.toThrow(/Cliente não encontrado/);
  await expect(as(jarvis, () => row("select jarvis_schedule_measurement('x',$1,now()+interval '1 day')", [client]))).rejects.toThrow(/Pedido inválido/);
  await db.query("update permissions set can_create=false where role='atendente' and resource='operational_events'");
  await expect(as(jarvis, () => row("select jarvis_schedule_measurement('pedido-0004',$1,now()+interval '1 day')", [client]))).rejects.toThrow(/Sem permissão para agendar/);
  expect(await as(outsider, () => rows("select * from jarvis_find_clients('maria')"))).toEqual([{ id: otherClient, name: "Maria da Outra", phone: null, address: null, neighborhood: null, city: null }]);
});
