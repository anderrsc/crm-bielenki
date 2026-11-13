// Fluxos operacionais pela interface: venda avulsa, compra avulsa,
// orcamento de esquadrias, baixa parcial e renegociacao no financeiro.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { launch, login, BASE, pageProblem, clickAndWait, setByLabel, settle as settleRequests, trackRequests } from "./helpers.mjs";

const RUN = Date.now().toString(36);
let browser, page, db;
const state = {};

before(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm" });
  await db.connect();
  const cid = (await db.query("select company_id from profiles order by created_at limit 1")).rows[0].company_id;
  state.client = (await db.query("insert into clients(company_id,name,city) values($1,$2,'Joinville') returning id,name", [cid, `Cliente Negocio ${RUN}`])).rows[0];
  state.supplier = (await db.query("insert into suppliers(company_id,name) values($1,$2) returning id,name", [cid, `Fornecedor Negocio ${RUN}`])).rows[0];
  browser = await launch();
  page = await browser.newPage();
  trackRequests(page);
  page.on("dialog", (d) => d.accept());
  await login(page, process.env.E2E_EMAIL ?? "admin@teste.local", process.env.E2E_PASSWORD ?? "senha-de-teste-123");
});
after(async () => { await browser?.close(); await db?.end(); });

test("conciliação: importar e reimportar não dá baixa; associação e taxa exigem confirmação", async () => {
  const profile=(await db.query("select id,company_id from profiles order by created_at limit 1")).rows[0];
  const account=(await db.query("insert into receiving_accounts(company_id,name) values($1,$2) returning id",[profile.company_id,`Banco E2E ${RUN}`])).rows[0];
  const category=(await db.query("insert into financial_categories(company_id,name,entry_type,dre_group) values($1,$2,'pagar','financeiro') returning id",[profile.company_id,`Taxas E2E ${RUN}`])).rows[0];
  const description=`Recebimento banco ${RUN}`;
  const entry=(await db.query("insert into financial_entries(company_id,entry_type,origin,description,total_amount,due_date) values($1,'receber','manual',$2,50,current_date) returning id",[profile.company_id,description])).rows[0];
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[profile.id]);
  let payment;
  try{payment=(await db.query("select register_payment($1,50,current_date,'pix') id",[entry.id])).rows[0].id;}
  finally{await db.query("select set_config('request.jwt.claim.sub','',false)");}
  const day=(await db.query("select current_date::text d")).rows[0].d;
  const file=path.resolve('.test-work',`bank-${RUN}.csv`);
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,`id;data;valor;descricao\nin-${RUN};${day};50,00;${description}\nout-${RUN};${day};-12,34;Taxa ${RUN}\n`);
  const count=async()=>Number((await db.query('select count(*) n from payments')).rows[0].n);
  const before=await count();
  const root=`${BASE}/financeiro/conciliacao?conta=${account.id}`;
  const importFile=async()=>{
    await page.goto(root,{waitUntil:'networkidle0'});await noProblem('conciliação');
    await page.$eval('details:has(input[name="statement"])',el=>{el.open=true;});
    await (await page.$('input[name="statement"]')).uploadFile(file);
    await page.click('input[name="account_confirmed"]');
    await clickAndWait(page,'Importar movimentos pendentes');await noProblem('importação de extrato');
  };
  await importFile();assert.equal(await count(),before);
  await importFile();assert.equal(await count(),before);
  const rows=(await db.query('select id,amount from bank_statement_rows where account_id=$1',[account.id])).rows;
  assert.equal(rows.length,2);
  const incoming=rows.find(r=>Number(r.amount)>0),outgoing=rows.find(r=>Number(r.amount)<0);
  await page.goto(`${root}&movimento=${incoming.id}&busca=${encodeURIComponent(description)}`,{waitUntil:'networkidle0'});
  await noProblem('sugestões bancárias');
  const match='form:has(input[name="mode"][value="match"])';
  await page.select(`${match} select[name="target_id"]`,payment);
  await page.type(`${match} input[name="note"]`,'Comprovante e extrato conferidos');
  await clickAndWait(page,'Associar baixa existente',{scope:match});await noProblem('associação bancária');
  assert.equal(await count(),before);
  assert.equal((await db.query('select payment_id from bank_statement_rows where id=$1',[incoming.id])).rows[0].payment_id,payment);
  await page.goto(`${root}&movimento=${outgoing.id}`,{waitUntil:'networkidle0'});
  const fee='form:has(input[name="mode"][value="fee"])';
  await page.$eval('details:has(input[name="mode"][value="fee"])',el=>{el.open=true;});
  await page.select(`${fee} select[name="category_id"]`,category.id);
  await page.type(`${fee} input[name="note"]`,'Taxa conferida no extrato bancário');
  await clickAndWait(page,'Criar despesa e dar baixa',{scope:fee});await noProblem('taxa bancária');
  assert.equal(await count(),before+1);
  const saved=(await db.query('select b.status,p.amount,p.receiving_account_id,e.category_id from bank_statement_rows b join payments p on p.id=b.payment_id join financial_entries e on e.id=p.financial_entry_id where b.id=$1',[outgoing.id])).rows[0];
  assert.equal(saved.status,'matched');assert.equal(Number(saved.amount),12.34);
  assert.equal(saved.receiving_account_id,account.id);assert.equal(saved.category_id,category.id);
  assert.ok(Number((await db.query("select count(*) n from audit_logs where table_name='bank_statement_rows' and record_id=$1",[outgoing.id])).rows[0].n)>0);
  await page.setViewport({width:375,height:812});
  await page.goto(`${root}&situacao=matched`,{waitUntil:'networkidle0'});await noProblem('conciliação no celular');
  assert.ok((await page.evaluate(()=>document.body.innerText)).includes(description));
  await page.setViewport({width:1366,height:900});
});

async function noProblem(step) {
  const problem = await pageProblem(page);
  assert.equal(problem, null, `${step}: ${problem} (${page.url()})`);
}

test("recorrências: planejar não paga, criar competência não duplica a previsão",async()=>{
 const profile=(await db.query('select id,company_id from profiles order by created_at limit 1')).rows[0];
 const description=`Aluguel programado ${RUN}`;
 const today=(await db.query("select (now() at time zone 'America/Sao_Paulo')::date::text d")).rows[0].d;
 const paymentCount=Number((await db.query('select count(*) n from payments')).rows[0].n);
 await page.goto(`${BASE}/financeiro/recorrencias`,{waitUntil:'networkidle0'});await noProblem('recorrências');
 await page.$eval('details:has(input[name="description"])',el=>{el.open=true;});
 await page.type('input[name="description"]',description);await page.type('input[name="amount"]','123,45');
 for(const name of ['starts_on','ends_on'])await page.$eval(`input[name="${name}"]`,(el,v)=>{el.value=v;},today);
 await page.$eval('input[name="day_of_month"]',(el,v)=>{el.value=v;},today.slice(-2));
 await page.type('input[name="reason"]','Contrato e previsão conferidos');
 await clickAndWait(page,'Salvar programação');await noProblem('salvar programação');
 const plan=(await db.query('select id from financial_recurrences where company_id=$1 and description=$2',[profile.company_id,description])).rows[0];assert.ok(plan);
 assert.equal(Number((await db.query('select count(*) n from financial_recurrence_occurrences where recurrence_id=$1',[plan.id])).rows[0].n),0);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[profile.id]);
 let before;try{before=(await db.query('select cash_overview(30) d')).rows[0].d;}finally{await db.query("select set_config('request.jwt.claim.sub','',false)");}
 const form=`form:has(input[name="id"][value="${plan.id}"]):has(input[name="month"])`;
 await page.$eval(`article details:has(input[name="id"][value="${plan.id}"])`,el=>{el.open=true;});
 await page.type(`${form} input[name="reason"]`,'Competência conferida para lançamento');await page.click(`${form} input[name="confirmed"]`);
 await clickAndWait(page,'Confirmar criação da conta',{scope:form});await noProblem('criar competência');
 const entry=(await db.query('select e.total_amount,e.paid_amount from financial_recurrence_occurrences o join financial_entries e on e.id=o.entry_id where o.recurrence_id=$1',[plan.id])).rows;
 assert.equal(entry.length,1);assert.equal(Number(entry[0].total_amount),123.45);assert.equal(Number(entry[0].paid_amount),0);
 assert.equal(Number((await db.query('select count(*) n from payments')).rows[0].n),paymentCount);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[profile.id]);
 try{const after=(await db.query('select cash_overview(30) d')).rows[0].d;assert.deepEqual(after.flows,before.flows);assert.deepEqual(after.accounts,before.accounts);}finally{await db.query("select set_config('request.jwt.claim.sub','',false)");}
 await page.setViewport({width:375,height:812});await page.goto(`${BASE}/financeiro/recorrencias`,{waitUntil:'networkidle0'});await noProblem('recorrências no celular');
 assert.ok((await page.evaluate(()=>document.body.innerText)).includes(description));await page.setViewport({width:1366,height:900});
});

test("venda avulsa com pagamento parcial", async () => {
  await page.goto(`${BASE}/vendas/nova`, { waitUntil: "networkidle0" });
  await setByLabel(page, "Cliente", state.client.name);
  await setByLabel(page, "Tipo de venda", "Venda avulsa de acessórios");
  await setByLabel(page, "Produto / serviço", "Kit de rebites");
  await setByLabel(page, "Descrição", "Rebites 4mm");
  await setByLabel(page, "Quantidade", 4);
  await setByLabel(page, "Valor unitário", 25);
  await setByLabel(page, "Valor já recebido", 40);
  await clickAndWait(page, "Cadastrar venda");
  await noProblem("venda avulsa");
  const saleId = page.url().match(/vendas\/([0-9a-f-]{36})/)?.[1];
  assert.ok(saleId, `nao abriu a venda: ${page.url()}`);
  const s = (await db.query("select total, paid_amount from sales where id=$1", [saleId])).rows[0];
  assert.equal(Number(s.total), 100);
  assert.equal(Number(s.paid_amount), 40);
  const fe = (await db.query("select id, open_amount from financial_entries where sale_id=$1 and entry_type='receber'", [saleId])).rows;
  assert.equal(fe.reduce((t, r) => t + Number(r.open_amount), 0), 60, "saldo a receber deveria ser 60");
  state.saleEntry = fe.find((r) => Number(r.open_amount) > 0).id;
});

test("compra avulsa e recebimento do material", async () => {
  await page.goto(`${BASE}/compras/nova`, { waitUntil: "networkidle0" });
  await setByLabel(page, "Fornecedor", state.supplier.name);
  await setByLabel(page, "Descrição do material", `Bobina aluminio ${RUN}`);
  await setByLabel(page, "Quantidade", 2);
  await setByLabel(page, "Valor unitário", 300);
  await clickAndWait(page, "Cadastrar compra");
  await noProblem("compra avulsa");
  const poId = page.url().match(/compras\/([0-9a-f-]{36})/)?.[1];
  assert.ok(poId, `nao abriu a compra: ${page.url()}`);
  const po = (await db.query("select total from purchase_orders where id=$1", [poId])).rows[0];
  assert.equal(Number(po.total), 600);
  const pay = (await db.query("select sum(open_amount) open from financial_entries where purchase_order_id=$1 and entry_type='pagar'", [poId])).rows[0];
  assert.equal(Number(pay.open), 600, "conta a pagar da compra");
  // Receber o item na tela da compra (se a tela oferecer o recebimento).
  await page.goto(`${BASE}/compras/${poId}`, { waitUntil: "networkidle0" });
  await noProblem("detalhe da compra");
  const hasReceive = await page.$$eval("button", (bs) => bs.some((b) => /receber/i.test(b.innerText)));
  if (hasReceive) {
    await clickAndWait(page, "Receber");
    await noProblem("receber item");
    const st = (await db.query("select status from purchase_orders where id=$1", [poId])).rows[0].status;
    assert.notEqual(st, "solicitacao_criada");
  }
  state.poId = poId;
});

test("orcamento de esquadrias", async () => {
  await page.goto(`${BASE}/orcamentos/esquadrias`, { waitUntil: "networkidle0" });
  await setByLabel(page, "Cliente", state.client.name);
  await setByLabel(page, "Medidas (L x A)", "1200 x 1000");
  await setByLabel(page, "Vidro", "Temperado 6mm");
  await setByLabel(page, "Quantidade", 2);
  await setByLabel(page, "Valor unitário", 850);
  await clickAndWait(page, "Salvar orçamento");
  await noProblem("orcamento esquadrias");
  const quoteId = page.url().match(/orcamentos\/([0-9a-f-]{36})/)?.[1];
  assert.ok(quoteId, `nao abriu o orcamento: ${page.url()}`);
  const q = (await db.query("select total from quotes where id=$1", [quoteId])).rows[0];
  assert.equal(Number(q.total), 1700);
  const items = (await db.query("select count(*)::int n from quote_items where quote_id=$1", [quoteId])).rows[0].n;
  assert.equal(items, 1);
  // Sem tela de edicao para esquadrias: o botao Editar nao deve aparecer.
  const labels = await page.$$eval("a", (as) => as.map((a) => a.innerText.trim()));
  assert.ok(!labels.includes("Editar"));
});

test("financeiro: baixa parcial e renegociacao de vencimento", async () => {
  await page.goto(`${BASE}/financeiro/receber`, { waitUntil: "networkidle0" });
  await noProblem("financeiro");
  const before = (await db.query("select open_amount, due_date from financial_entries where id=$1", [state.saleEntry])).rows[0];
  // Abre o "Dar baixa" da linha do lancamento da venda avulsa.
  const opened = await page.evaluate((client) => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(client) && r.innerText.includes("Dar baixa"));
    const btn = row && [...row.querySelectorAll("button")].find((b) => b.innerText.includes("Dar baixa"));
    btn?.click();
    return Boolean(btn);
  }, state.client.name);
  assert.ok(opened, "linha do lancamento com 'Dar baixa' nao encontrada");
  await page.waitForSelector("[role=dialog] input[name=amount]");
  await page.$eval("[role=dialog] input[name=amount]", (el) => (el.value = "10"));
  await clickAndWait(page, "Confirmar baixa", { scope: "[role=dialog]" });
  await noProblem("dar baixa");
  const after1 = (await db.query("select open_amount, paid_amount from financial_entries where id=$1", [state.saleEntry])).rows[0];
  assert.equal(Number(after1.open_amount), Number(before.open_amount) - 10);

  await page.goto(`${BASE}/financeiro/receber`, { waitUntil: "networkidle0" });
  const openedR = await page.evaluate((client) => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(client) && r.querySelector("[title='Renegociar vencimento']"));
    row?.querySelector("[title='Renegociar vencimento']").click();
    return Boolean(row);
  }, state.client.name);
  assert.ok(openedR, "botao de renegociar nao encontrado");
  await page.waitForSelector("input[name=new_due_date]");
  const newDue = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  await page.$eval("input[name=new_due_date]", (el, v) => (el.value = v), newDue);
  const reason = await page.$("textarea[name=reason], input[name=reason]");
  if (reason) await reason.type("Cliente pediu mais prazo");
  await page.evaluate(() => document.querySelector("input[name=new_due_date]").form.requestSubmit());
  await settleRequests(page);
  await noProblem("renegociar");
  const after2 = (await db.query("select to_char(due_date,'YYYY-MM-DD') due from financial_entries where id=$1", [state.saleEntry])).rows[0];
  assert.equal(after2.due, newDue);
});

test("receber material da compra no estoque (Materiais do pedido)", async () => {
  await page.goto(`${BASE}/producao/materiais-do-pedido`, { waitUntil: "networkidle0" });
  await noProblem("materiais do pedido");
  const card = await page.evaluateHandle((name) => [...document.querySelectorAll("article")].find((a) => a.innerText.includes(name)), `Bobina aluminio ${RUN}`);
  assert.ok(card.asElement(), "material da compra avulsa nao aparece em Materiais do pedido");
  await card.asElement().$eval("summary", (s) => s.click());
  const btn = await card.asElement().$("form button");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), btn.click()]);
  await noProblem("receber material");
  const st = (await db.query("select status from purchase_orders where id=$1", [state.poId])).rows[0].status;
  assert.equal(st, "recebido_completo");
  const mov = (await db.query("select count(*)::int n from stock_movements m join purchase_order_items i on i.id=m.purchase_order_item_id where i.purchase_order_id=$1", [state.poId])).rows[0].n;
  assert.ok(mov >= 1, "entrada no estoque nao registrada");
});

test("financeiro: sugestões, classificação de conta existente e cadastro de conta classificada", async () => {
  await page.goto(`${BASE}/financeiro/classificacoes`, { waitUntil: "networkidle0" });
  await clickAndWait(page, "Cadastrar sugestões iniciais");
  await noProblem("sugestões financeiras");
  const cid = (await db.query("select company_id from profiles order by created_at limit 1")).rows[0].company_id;
  const category = (await db.query("select id from financial_categories where company_id=$1 and name='Outras receitas' and entry_type='receber'", [cid])).rows[0];
  const center = (await db.query("select id from financial_cost_centers where company_id=$1 and name='Administração'", [cid])).rows[0];
  assert.ok(category && center);
  const before = (await db.query("select total_amount,paid_amount,due_date,status from financial_entries where id=$1", [state.saleEntry])).rows[0];
  await page.goto(`${BASE}/financeiro/classificacoes?lancamento=${state.saleEntry}`, { waitUntil: "networkidle0" });
  await page.select('select[name="category_id"]', category.id);
  await page.select('select[name="cost_center_id"]', center.id);
  await clickAndWait(page, "Salvar classificação");
  await noProblem("classificar conta existente");
  const saved = (await db.query("select category_id,cost_center_id,total_amount,paid_amount,due_date,status from financial_entries where id=$1", [state.saleEntry])).rows[0];
  assert.equal(saved.category_id, category.id);
  assert.equal(saved.cost_center_id, center.id);
  const { category_id, cost_center_id, ...unchanged } = saved;
  assert.deepEqual(unchanged, before);

  await page.goto(`${BASE}/financeiro/receber/novo`, { waitUntil: "networkidle0" });
  await setByLabel(page, "Descrição", `Receita classificada ${RUN}`);
  await setByLabel(page, "Valor (R$)", "45,67");
  await setByLabel(page, "Vencimento", new Date(Date.now() + 864e5).toISOString().slice(0, 10));
  await page.select('select[name="category_id"]', category.id);
  await page.select('select[name="cost_center_id"]', center.id);
  await clickAndWait(page, "Salvar conta");
  await noProblem("nova conta classificada");
  const created = (await db.query("select category_id,cost_center_id,total_amount from financial_entries where company_id=$1 and description=$2", [cid, `Receita classificada ${RUN}`])).rows[0];
  assert.equal(created.category_id, category.id);
  assert.equal(created.cost_center_id, center.id);
  assert.equal(Number(created.total_amount), 45.67);
});

test("financeiro: segunda baixa mantém juros, desconto e três parcelas", async () => {
  const profile = (await db.query("select id,company_id from profiles order by created_at limit 1")).rows[0];
  const description = `Segunda baixa ${RUN}`;
  const entry = (await db.query("insert into financial_entries(company_id,entry_type,origin,description,total_amount,due_date) values($1,'receber','manual',$2,100,current_date+15) returning id", [profile.company_id, description])).rows[0];
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [profile.id]);
  try { await db.query("select register_payment_with_adjustment($1,10,current_date,'pix',null,12,2,3,current_date+15)", [entry.id]); }
  finally { await db.query("select set_config('request.jwt.claim.sub','',false)"); }
  const before = (await db.query("select to_char(first_installment_due_date,'YYYY-MM-DD') due from financial_entries where id=$1", [entry.id])).rows[0];
  await page.goto(`${BASE}/financeiro/receber?q=${encodeURIComponent(description)}`, { waitUntil: "networkidle0" });
  // Abrir o dialogo nao navega: clique simples na linha do lancamento.
  const opened = await page.evaluate((text) => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(text) && r.innerText.includes("Dar baixa"));
    const btn = row && [...row.querySelectorAll("button")].find((b) => b.innerText.includes("Dar baixa"));
    btn?.click();
    return Boolean(btn);
  }, description);
  assert.ok(opened, "linha do lancamento com 'Dar baixa' nao encontrada");
  await page.waitForSelector('[role="dialog"] input[name="amount"]');
  const defaults = await page.$eval('[role="dialog"] form', form => Object.fromEntries([...form.querySelectorAll('input[name]')].map(el => [el.name, el.value])));
  assert.equal(defaults.interest, "12");
  assert.equal(defaults.discount, "2");
  assert.equal(defaults.installments, "3");
  assert.equal(defaults.first_due_date, before.due);
  await page.$eval('[role="dialog"] input[name="amount"]', el => { el.value = "10"; });
  await clickAndWait(page, "Confirmar baixa", { scope: '[role="dialog"]' });
  await noProblem("segunda baixa parcelada");
  const saved = (await db.query("select total_amount,paid_amount,interest_amount,discount_amount,installment_count,to_char(first_installment_due_date,'YYYY-MM-DD') due from financial_entries where id=$1", [entry.id])).rows[0];
  assert.equal(Number(saved.total_amount), 110);
  assert.equal(Number(saved.paid_amount), 20);
  assert.equal(Number(saved.interest_amount), 12);
  assert.equal(Number(saved.discount_amount), 2);
  assert.equal(saved.installment_count, 3);
  assert.equal(saved.due, before.due);
});

test("caixa: salva saldo inicial com auditoria e renderiza os cenários no celular", async () => {
  const profile = (await db.query("select id,company_id from profiles order by created_at limit 1")).rows[0];
  const account = (await db.query("insert into receiving_accounts(company_id,name) values($1,$2) returning id",[profile.company_id,`Caixa E2E ${RUN}`])).rows[0];
  await page.goto(`${BASE}/financeiro/caixa?dias=15`, { waitUntil: "networkidle0" });
  await noProblem("caixa");
  const selector = `form:has(input[name="account_id"][value="${account.id}"])`;
  await page.$eval(`${selector} input[name="opening_balance"]`, el => { el.value="1.234,56"; });
  await page.$eval(`${selector} input[name="opening_date"]`, el => { el.value=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); });
  await clickAndWait(page,"Salvar saldo inicial",{scope:selector});
  await noProblem("saldo inicial");
  const saved=(await db.query("select opening_balance from receiving_accounts where id=$1",[account.id])).rows[0];
  assert.equal(Number(saved.opening_balance),1234.56);
  const audit=(await db.query("select profile_id,new_data from audit_logs where table_name='receiving_accounts' and record_id=$1 order by id desc limit 1",[account.id])).rows[0];
  assert.equal(audit.profile_id,profile.id);
  assert.equal(Number(audit.new_data.opening_balance),1234.56);
  await page.setViewport({width:375,height:812});
  await page.goto(`${BASE}/financeiro/caixa?dias=15`, { waitUntil: "networkidle0" });
  await noProblem("caixa no celular");
  await page.waitForSelector('a[href*="cenario=conservador"]');
  const text=await page.evaluate(()=>document.body.innerText);
  for(const label of ['Conservador','Provável','Otimista','Saldo hoje'])assert.ok(text.toLocaleLowerCase('pt-BR').includes(label.toLocaleLowerCase('pt-BR')),`${label}: ${text.slice(-3000)}`);
  await page.setViewport({width:1366,height:900});
});
