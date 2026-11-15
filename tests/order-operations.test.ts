import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

let db: PGlite, company: string, client: string, type: string, seq = 0;
const manager = "00000000-0000-4000-8000-0000000000c1";
const denied = "00000000-0000-4000-8000-0000000000c2";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
async function newOrder() {
  seq++;
  const sale = (await row("insert into sales(company_id,sale_number,client_id,sale_type_id,total) values($1,$2,$3,$4,100) returning id", [company, `VEN-OP${seq}`, client, type])).id;
  const order = (await row("insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,$2,$3,$4,$5) returning id", [company, `PED-OP${seq}`, sale, client, type])).id as string;
  return order;
}
const stage = async (id: string) => (await row("select op_stage from orders where id=$1", [id])).op_stage;
const checks = async (id: string) => (await db.query<{ status: string }>("select status from order_measure_checks where order_id=$1 order by created_at", [id])).rows.map((r) => r.status);
const step = async (id: string) => (await row("select current_step from production_orders where order_id=$1", [id])).current_step;

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'op@test.invalid'),($2,'op-denied@test.invalid')", [manager, denied]);
  company = (await row("select bootstrap_company('Operacoes',null,$1) id", [manager])).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Sem acesso')", [denied, company]);
  await as(manager);
  client = (await row("insert into clients(company_id,name,phone) values($1,'Cliente Operacao','47999990222') returning id", [company])).id;
  type = (await row("select id from sale_types where company_id=$1 limit 1", [company])).id;
});
afterAll(async () => { await db?.close(); });

test("A/C/D: precisa de conferencia -> pendencia unica, agenda, conclui e libera para corte", async () => {
  const order = await newOrder();
  expect(await stage(order)).toBe("aguardando_decisao");
  await expect(row("select advance_production_step((select id from production_orders where order_id=$1),null,null)", [order])).rejects.toThrow(/libere o pedido para corte/i);
  await row("select order_measure_decision($1,true)", [order]);
  await row("select order_measure_decision($1,true)", [order]); // clique duplicado
  expect(await stage(order)).toBe("aguardando_conferencia");
  expect(await checks(order)).toEqual(["pendente"]);
  expect((await row("select check_status,scheduled_at from v_order_pending where order_id=$1", [order]))).toMatchObject({ check_status: "pendente", scheduled_at: null });
  await expect(row("select order_release_cut($1)", [order])).rejects.toThrow(/Confirme as medidas/);
  await row("select order_schedule_measure_check($1, now() + interval '2 days', $2, 'levar trena')", [order, manager]);
  expect(await checks(order)).toEqual(["agendada"]);
  expect(await row("select order_finish_measure_check($1,'conferidas','ok') s", [order])).toMatchObject({ s: "aguardando_liberacao_corte" });
  await row("select order_release_cut($1,$2,'corte liberado')", [order, manager]);
  await row("select order_release_cut($1,$2,'de novo')", [order, manager]); // clique duplicado
  expect(await stage(order)).toBe("liberado_corte");
  expect(await step(order)).toBe(2);
  expect((await row("select cut_notes from orders where id=$1", [order])).cut_notes).toBe("corte liberado");
  expect((await row("select count(*)::int n from v_order_pending where order_id=$1", [order])).n).toBe(0);
  const history = (await db.query<{ action: string }>("select action from audit_logs where table_name='order_operations' and record_id=$1 order by created_at,id", [order])).rows.map((r) => r.action);
  expect(history).toEqual(["DECISAO_MEDIDAS", "CONFERENCIA_AGENDADA", "CONFERENCIA_CONCLUIDA", "LIBERADO_CORTE"]);
});

test("B: medidas ja conferidas -> sem visita, aguarda liberacao, e corte continua separado", async () => {
  const order = await newOrder();
  await row("select order_measure_decision($1,false)", [order]);
  expect(await stage(order)).toBe("aguardando_liberacao_corte");
  expect(await checks(order)).toEqual([]);
  expect(await step(order)).toBe(1);
  expect(await row("select order_measure_decision($1,true) s", [order])).toMatchObject({ s: "aguardando_liberacao_corte" }); // nao repete a pergunta
  expect(await row("select order_measure_decision($1,true,true) s", [order])).toMatchObject({ s: "aguardando_conferencia" }); // nova conferencia pedida
  expect(await checks(order)).toEqual(["pendente"]);
});

test("medidas alteradas exigem validacao da gerencia; nova visita cria outra pendencia", async () => {
  const order = await newOrder();
  await row("select order_measure_decision($1,true)", [order]);
  expect(await row("select order_finish_measure_check($1,'nova_visita',null) s", [order])).toMatchObject({ s: "aguardando_conferencia" });
  expect(await checks(order)).toEqual(["concluida", "pendente"]);
  expect(await row("select order_finish_measure_check($1,'alteradas','janela 10cm maior') s", [order])).toMatchObject({ s: "aguardando_validacao" });
  await expect(row("select order_release_cut($1)", [order])).rejects.toThrow(/Confirme as medidas/);
  await row("select order_validate_measures($1,'ok')", [order]);
  expect(await stage(order)).toBe("aguardando_liberacao_corte");
});

test("pedido antigo (sem etapa) nao e afetado e quem nao tem acesso nao altera", async () => {
  const order = await newOrder();
  await db.query("update orders set op_stage=null where id=$1", [order]);
  expect(await row("select advance_production_step((select id from production_orders where order_id=$1),null,null) n", [order])).toMatchObject({ n: 2 });
  const other = await newOrder();
  await as(denied);
  try { await expect(row("select order_measure_decision($1,true)", [other])).rejects.toThrow(/permissao/); }
  finally { await as(manager); }
});
