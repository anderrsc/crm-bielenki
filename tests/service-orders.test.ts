import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

let db: PGlite, company: string, other: string, client: string, order: string;
const user = "00000000-0000-4000-8000-0000000000d1";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
const service = async (extra: Record<string, unknown> = {}) => (await row(
  "insert into service_orders(company_id,client_id,order_id,kind,classification,related_to_previous,description,priority,billing,expected_amount,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id,service_number,status",
  [company, client, extra.order ?? null, extra.kind ?? "manutencao_calhas", extra.classification ?? "corretiva", !!extra.order, "Calha vazando no fundo", extra.priority ?? "normal", extra.billing ?? "cobrado", extra.expected ?? 150, extra.status ?? "solicitacao_recebida"]));
const get = (id: string) => row("select status,final_amount,financial_entry_id,agenda_event_id,scheduled_at,completion_notes from service_orders where id=$1", [id]);

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'srv@test.invalid')", [user]);
  company = (await row("select bootstrap_company('Servicos',null,$1) id", [user])).id;
  other = (await row("insert into companies(name) values('Outra servicos') returning id")).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  client = (await row("insert into clients(company_id,name,phone,address,city) values($1,'Cliente Servico','47999990333','Rua A, 10','Blumenau') returning id", [company])).id;
  const type = (await row("select id from sale_types where company_id=$1 limit 1", [company])).id;
  const sale = (await row("insert into sales(company_id,sale_number,client_id,sale_type_id,total) values($1,'VEN-S1',$2,$3,100) returning id", [company, client, type])).id;
  order = (await row("insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,'PED-S1',$2,$3,$4) returning id", [company, sale, client, type])).id;
});
afterAll(async () => { await db?.close(); });

test("E/G: manutencao ligada a obra antiga, agendada, concluida e cobrada uma unica vez", async () => {
  const s = await service({ order, status: "concluido" }); // situacao inicial nao pode pular etapas
  expect(s.service_number).toMatch(/^SRV-/);
  expect(s.status).toBe("solicitacao_recebida");
  await row("select service_schedule($1, now() + interval '1 day', $2, 'Equipe 1', 'levar calha reserva')", [s.id, user]);
  await row("select service_schedule($1, now() + interval '2 days', $2, null, null)", [s.id, user]); // reagendar nao duplica
  expect((await get(s.id)).status).toBe("visita_agendada");
  expect((await row("select count(*)::int n, min(event_type) tipo from operational_events where order_id=$1", [order]))).toMatchObject({ n: 1, tipo: "manutencao" });
  await row("select service_set_status($1,'em_atendimento',null)", [s.id]);
  await expect(row("select service_complete($1,'  ',180)", [s.id])).rejects.toThrow(/Descreva/);
  const entry = (await row("select service_complete($1,'Troca de 2m de calha',180,'2m calha, rebites',20,current_date+7) e", [s.id])).e;
  expect((await row("select service_complete($1,'de novo',999) e", [s.id])).e).toBe(entry); // clique duplicado
  expect(await get(s.id)).toMatchObject({ status: "concluido", financial_entry_id: entry, completion_notes: "Troca de 2m de calha" });
  expect(Number((await get(s.id)).final_amount)).toBe(180);
  expect((await row("select entry_type::text t,total_amount,client_id,description from financial_entries where id=$1", [entry]))).toMatchObject({ t: "receber", client_id: client, description: `Serviço ${s.service_number}` });
  expect((await row("select count(*)::int n from financial_entries where description=$1", [`Serviço ${s.service_number}`])).n).toBe(1);
  expect((await row("select status from operational_events where order_id=$1", [order])).status).toBe("concluido");
  await expect(row("select service_set_status($1,'em_atendimento',null)", [s.id])).rejects.toThrow(/concluido/);
});

test("F: reparo independente e gratuito nao gera cobranca; campos protegidos so mudam pelas funcoes", async () => {
  const s = await service({ kind: "reparo", billing: "gratuito", priority: "urgente", classification: "garantia" });
  await db.query("update service_orders set status='concluido', financial_entry_id=gen_random_uuid(), internal_notes='ligar antes' where id=$1", [s.id]).catch(() => undefined);
  const current = await row("select status,financial_entry_id,internal_notes from service_orders where id=$1", [s.id]);
  expect(current).toMatchObject({ status: "solicitacao_recebida", financial_entry_id: null, internal_notes: "ligar antes" });
  expect((await row("select service_complete($1,'Regulagem feita',0) e", [s.id])).e).toBeNull();
  expect(Number((await get(s.id)).final_amount)).toBe(0);
  const i = (await row("select operational_indicators() i")).i;
  expect(i).toMatchObject({ manutencoes_abertas: 0, servicos_concluidos_mes: 2, aguardando_decisao: 1 });
});

test("cliente de outra empresa e recusado; retorno desfaz o agendamento", async () => {
  const foreign = (await row("insert into clients(company_id,name,phone) values($1,'Alheio','47999990444') returning id", [other])).id;
  await expect(db.query("insert into service_orders(company_id,client_id,kind,description) values($1,$2,'reparo','x')", [company, foreign])).rejects.toThrow(/Cliente invalido/);
  const s = await service({ kind: "ajuste" });
  await row("select service_schedule($1, now() + interval '1 day')", [s.id]);
  await row("select service_set_status($1,'necessita_retorno','faltou peça')", [s.id]);
  expect(await get(s.id)).toMatchObject({ status: "necessita_retorno", agenda_event_id: null, scheduled_at: null });
  expect((await row("select operational_indicators() i")).i.manutencoes_abertas).toBe(1);
});
