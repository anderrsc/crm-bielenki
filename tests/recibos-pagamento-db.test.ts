import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Recibo automático: toda baixa de conta a receber gera recibo numerado (qualquer caminho),
// conta a pagar não gera, estorno cancela, e a fila não entrega o mesmo recibo duas vezes.
let db: PGlite, company: string, client: string, account: string;
const user = "00000000-0000-4000-8000-0000000007d1";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
const receivable = (total: number) => row("insert into financial_entries(company_id,entry_type,origin,client_id,description,total_amount,due_date) values($1,'receber','manual',$2,'Pedido teste',$3,current_date) returning id", [company, client, total]).then((r) => r.id as string);

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'recibo@test.invalid')", [user]);
  company = (await row("select bootstrap_company('Recibos',null,$1) id", [user])).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  client = (await row("insert into clients(company_id,name,phone) values($1,'Mariana Souza','47996980082') returning id", [company])).id;
  account = (await row("insert into receiving_accounts(company_id,name,pix_key) values($1,'Pix Empresa','00000000000100') returning id", [company])).id;
});
afterAll(async () => { await db?.close(); });

test("baixa pelo Financeiro e Pix Recebido geram recibos em sequência, na fila", async () => {
  const entry = await receivable(6900);
  const p1 = (await row("select register_payment_with_adjustment($1,2000,current_date,'pix','Sinal') id", [entry])).id;
  const charge = (await row("select record_pix_charge($1,4900,'Saldo',null,$2,$3,null) id", [account, client, entry])).id;
  const p2 = (await row("select confirm_pix_charge($1) id", [charge])).id;
  const r1 = await row("select receipt_number,status,client_id,financial_entry_id from payment_receipts where payment_id=$1", [p1]);
  const r2 = await row("select receipt_number,status from payment_receipts where payment_id=$1", [p2]);
  expect(r1).toEqual({ receipt_number: 1, status: "pendente", client_id: client, financial_entry_id: entry });
  expect(r2).toEqual({ receipt_number: 2, status: "pendente" });
});

test("conta a pagar não gera recibo", async () => {
  const supplier = (await row("insert into suppliers(company_id,name) values($1,'Fornecedor') returning id", [company])).id;
  const entry = (await row("insert into financial_entries(company_id,entry_type,origin,supplier_id,description,total_amount,due_date) values($1,'pagar','manual',$2,'Compra',300,current_date) returning id", [company, supplier])).id;
  const p = (await row("select register_payment_with_adjustment($1,300,current_date,'pix') id", [entry])).id;
  expect(await row("select count(*)::int n from payment_receipts where payment_id=$1", [p])).toEqual({ n: 0 });
});

test("a fila entrega cada recibo uma vez; estorno cancela", async () => {
  const claimed = (await db.query<Record<string, any>>("select payment_id,status,attempts from claim_payment_receipts(10)")).rows;
  expect(claimed.length).toBe(2);
  expect(claimed.every((r) => r.status === "processando" && r.attempts === 1)).toBe(true);
  expect((await db.query("select * from claim_payment_receipts(10)")).rows.length).toBe(0);

  const entry = await receivable(500);
  const p = (await row("select register_payment_with_adjustment($1,500,current_date,'dinheiro') id", [entry])).id;
  await row("select reverse_payment($1,'Lançado errado')", [p]);
  expect(await row("select status,last_error from payment_receipts where payment_id=$1", [p])).toEqual({ status: "cancelado", last_error: "Lançado errado" });
  await expect(row("select retry_payment_receipt($1)", [p])).rejects.toThrow(/estornado/);
});

test("reenviar volta o recibo para a fila", async () => {
  const { payment_id } = await row("select payment_id from payment_receipts where receipt_number=1 and company_id=$1", [company]);
  await db.query("update payment_receipts set status='enviado' where payment_id=$1", [payment_id]);
  await row("select retry_payment_receipt($1)", [payment_id]);
  expect(await row("select status,attempts from payment_receipts where payment_id=$1", [payment_id])).toEqual({ status: "pendente", attempts: 0 });
  expect((await db.query("select * from claim_payment_receipts(5,$1)", [payment_id])).rows.length).toBe(1);
});

test("reenviar: recusa recibo sendo enviado agora e esquece a mensagem anterior", async () => {
  const entry = await receivable(300);
  const p = (await row("select register_payment_with_adjustment($1,300,current_date,'pix') id", [entry])).id;
  await db.query("update payment_receipts set status='processando', locked_at=now() where payment_id=$1", [p]);
  await expect(row("select retry_payment_receipt($1)", [p])).rejects.toThrow(/sendo enviado agora/);
  const msg = (await row("select gen_random_uuid() id")).id;
  await db.query("update payment_receipts set status='enviado', locked_at=null, message_id=$2, sent_at=now() where payment_id=$1", [p, msg]);
  await row("select retry_payment_receipt($1)", [p]);
  expect(await row("select status,message_id from payment_receipts where payment_id=$1", [p])).toEqual({ status: "pendente", message_id: null });
});

test("estorno de recibo já enviado: cancela e avisa que o cliente recebeu", async () => {
  const entry = await receivable(200);
  const p = (await row("select register_payment_with_adjustment($1,200,current_date,'pix') id", [entry])).id;
  await db.query("update payment_receipts set status='enviado', sent_at=now() where payment_id=$1", [p]);
  await row("select reverse_payment($1,'Errado')", [p]);
  const r = await row("select status,last_error,sent_at is not null enviado from payment_receipts where payment_id=$1", [p]);
  expect(r.status).toBe("cancelado");
  expect(r.enviado).toBe(true);
  expect(r.last_error).toMatch(/Avise o cliente que o recibo nº \d{6} foi cancelado/);
});

test("baixa não gera mais a mensagem antiga de pagamento confirmado (o recibo substitui)", async () => {
  // Mesmo com a regra antiga ligada (empresa nova), a baixa não enfileira o texto antigo.
  await db.query("update automation_rules set enabled=true where automation_type='payment_confirmation'");
  const entry = await receivable(100);
  await row("select register_payment_with_adjustment($1,100,current_date,'pix') id", [entry]);
  expect(await row("select count(*)::int n from outbound_messages where automation_type='payment_confirmation'")).toEqual({ n: 0 });
});
