import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './helpers/database';

let db: PGlite;
let company: string, otherCompany: string, client: string, otherClient: string, supplier: string, saleType: string, location: string;
const admin = '00000000-0000-4000-8000-000000000001';
const otherAdmin = '00000000-0000-4000-8000-000000000002';
const seller = '00000000-0000-4000-8000-000000000003';
async function rows(sql: string, params: unknown[] = []) { return (await db.query<Record<string, any>>(sql,params)).rows; }
async function first(sql: string, params: unknown[] = []) { return (await rows(sql,params))[0]; }
async function actAs(id: string) { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); }
async function quote(overrides: Record<string,unknown> = {}) {
  return (await first('select create_gutter_quote($1::jsonb) id',[JSON.stringify({client_id:client,discount:0,freight:0,notes:'',items:[{product:'Calha de Beiral',category:'Calhas',thickness:'0.50 mm',cut:'200',color:'Aluminio Natural',quantity:2,meters:5,unit_price:10}],...overrides})])).id as string;
}
async function manualSale(paid=0) {
  return (await first('select create_manual_sale($1::jsonb) id',[JSON.stringify({client_id:client,sale_type_id:saleType,paid_amount:paid,items:[{product:'Serviço',quantity:2,unit_price:50}]})])).id as string;
}
async function purchase() {
  return (await first('select create_manual_purchase($1::jsonb) id',[JSON.stringify({supplier_id:supplier,paid_amount:0,items:[{description:'Chapa',quantity:10,unit_price:20,category:'Chapas',unit:'m'}]})])).id as string;
}

beforeAll(async()=>{
  db=await createTestDatabase();
  await db.exec(`grant usage on schema public, auth to authenticated; grant all on all tables in schema public to authenticated; grant usage,select on all sequences in schema public to authenticated;`);
  await db.query("insert into auth.users(id,email) values($1,'admin@test.invalid'),($2,'other@test.invalid'),($3,'seller@test.invalid')",[admin,otherAdmin,seller]);
  await actAs(admin);
  company=(await first("select bootstrap_company('Test A',null,$1) id",[admin])).id;
  await actAs(otherAdmin);
  otherCompany=(await first("select bootstrap_company('Test B',null,$1) id",[otherAdmin])).id;
  client=(await first("insert into clients(company_id,name) values($1,'Cliente A') returning id",[company])).id;
  otherClient=(await first("insert into clients(company_id,name) values($1,'Cliente B') returning id",[otherCompany])).id;
  supplier=(await first("insert into suppliers(company_id,name) values($1,'Fornecedor A') returning id",[company])).id;
  saleType=(await first("select id from sale_types where company_id=$1 and name ilike 'Calhas%' limit 1",[company])).id;
  location=(await first("select id from stock_locations where company_id=$1 limit 1",[company])).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Vendedor')",[seller,company]);
  await db.query("insert into user_roles(company_id,profile_id,role) values($1,$2,'vendedor')",[company,seller]);
  await actAs(admin);
});
beforeEach(async()=>{await db.exec('begin');await actAs(admin);});
afterEach(async()=>{await db.exec('rollback');});
afterAll(async()=>{if(db) await db.close();});

describe('quotes → sales → orders',()=>{
  test('fabricated quantities produce exact total',async()=>{const id=await quote();const q=await first('select subtotal,total from quotes where id=$1',[id]);expect(Number(q.total)).toBe(100);});
  test('approval creates sale, order, receivable and production once',async()=>{
    const id=await quote();const sale=(await first('select approve_quote($1) id',[id])).id;
    expect((await first('select approve_quote($1) id',[id])).id).toBe(sale);
    expect(Number((await first('select count(*) n from orders where sale_id=$1',[sale])).n)).toBe(1);
    expect(Number((await first('select count(*) n from financial_entries where sale_id=$1',[sale])).n)).toBe(1);
    expect(Number((await first('select count(*) n from production_orders p join orders o on o.id=p.order_id where o.sale_id=$1',[sale])).n)).toBe(1);
  });
  test('approved quote cannot be edited',async()=>{const id=await quote();await db.query('select approve_quote($1)',[id]);await expect(db.query('select update_gutter_quote($1,$2::jsonb)',[id,JSON.stringify({client_id:client,items:[]})])).rejects.toThrow(/aprovado/);});
  test('duplicate preserves lines and total',async()=>{const id=await quote();const copy=(await first('select duplicate_quote($1) id',[id])).id;expect(copy).not.toBe(id);expect(Number((await first('select total from quotes where id=$1',[copy])).total)).toBe(100);});
  test('empty quote is rejected',async()=>{await expect(quote({items:[]})).rejects.toThrow();});
  test('cross-company client is rejected',async()=>{await expect(quote({client_id:otherClient})).rejects.toThrow(/Cliente/i);});
  test('quote numbering survives deletion',async()=>{const one=await quote();const two=await quote();await db.query('select delete_draft_quote($1)',[one]);const three=await quote();const q=await rows('select quote_number from quotes where id in ($1,$2)',[two,three]);expect(new Set(q.map(x=>x.quote_number)).size).toBe(2);});
});

describe('financial daily use',()=>{
  test('manual sale creates receivable and records entry payment',async()=>{const sale=await manualSale(30);const e=await first('select paid_amount,open_amount from financial_entries where sale_id=$1',[sale]);expect(Number(e.paid_amount)).toBe(30);expect(Number(e.open_amount)).toBe(70);});
  test('partial then full payment keeps balances synchronized',async()=>{
    const sale=await manualSale();const e=await first('select id from financial_entries where sale_id=$1',[sale]);
    await db.query("select register_payment($1,30,current_date,'pix')",[e.id]);await db.query("select register_payment($1,70,current_date,'pix')",[e.id]);
    expect(await first('select financial_status::text,open_amount::float from sales where id=$1',[sale])).toEqual({financial_status:'pago',open_amount:0});
  });
  test.each([0,-1,101])('rejects payment amount %i',async amount=>{const sale=await manualSale();const e=await first('select id from financial_entries where sale_id=$1',[sale]);await expect(db.query("select register_payment($1,$2,current_date,'pix')",[e.id,amount])).rejects.toThrow();});
  test('reversal reopens balance and can only happen once',async()=>{const sale=await manualSale(30);const p=await first('select p.id from payments p join financial_entries e on e.id=p.financial_entry_id where e.sale_id=$1',[sale]);await db.query('select reverse_payment($1)',[p.id]);expect(Number((await first('select open_amount from sales where id=$1',[sale])).open_amount)).toBe(100);await expect(db.query('select reverse_payment($1)',[p.id])).rejects.toThrow();});
  test('installment rounding preserves total exactly',async()=>{const sale=await manualSale();const e=await first('select id from financial_entries where sale_id=$1',[sale]);await db.query("select register_payment_with_adjustment($1,10,current_date,'pix',null,0,0,3,current_date)",[e.id]);const sums=await first('select sum(amount)::float amount,sum(paid_amount)::float paid,count(*)::int n from financial_installments where financial_entry_id=$1',[e.id]);expect(sums).toEqual({amount:100,paid:10,n:3});});
  test('overpayment leaves original state unchanged',async()=>{const sale=await manualSale();const e=await first('select id from financial_entries where sale_id=$1',[sale]);await db.exec('savepoint invalid_payment');await expect(db.query("select register_payment_with_adjustment($1,999,current_date,'pix',null,10,0,3,current_date)",[e.id])).rejects.toThrow();await db.exec('rollback to savepoint invalid_payment');expect(Number((await first('select total_amount from financial_entries where id=$1',[e.id])).total_amount)).toBe(100);});
  test('due-date renegotiation is audited',async()=>{const sale=await manualSale();const e=await first('select id from financial_entries where sale_id=$1',[sale]);await db.query("select reschedule_entry($1,current_date+10,'Combinado com cliente')",[e.id]);expect(Number((await first("select count(*) n from audit_logs where record_id=$1 and action='RESCHEDULE'",[e.id])).n)).toBe(1);});
  test('cross-company renegotiation is blocked',async()=>{const sale=await manualSale();const e=await first('select id from financial_entries where sale_id=$1',[sale]);await actAs(otherAdmin);await expect(db.query('select reschedule_entry($1,current_date+10)',[e.id])).rejects.toThrow();});
});

describe('purchases and inventory',()=>{
  test('purchase creates payable and stock material',async()=>{const id=await purchase();expect(Number((await first('select total_amount from financial_entries where purchase_order_id=$1',[id])).total_amount)).toBe(200);expect((await first('select material_id from purchase_order_items where purchase_order_id=$1',[id])).material_id).toBeTruthy();});
  test('partial receipt adds stock and keeps remaining quantity',async()=>{const id=await purchase();const i=await first('select id,material_id from purchase_order_items where purchase_order_id=$1',[id]);await db.query('select receive_purchase_item($1,4,$2)',[i.id,location]);expect(Number((await first('select pending_quantity from purchase_order_items where id=$1',[i.id])).pending_quantity)).toBe(6);expect(Number((await first('select sum(quantity) n from stock_movements where material_id=$1',[i.material_id])).n)).toBe(4);});
  test('full receipt completes purchase and removes pending alert',async()=>{const id=await purchase();const i=await first('select id from purchase_order_items where purchase_order_id=$1',[id]);await db.query('select receive_purchase_item($1,10,$2)',[i.id,location]);expect((await first('select status from purchase_orders where id=$1',[id])).status).toBe('recebido_completo');expect((await rows('select * from pending_center()')).some(x=>x.record_id===id)).toBe(false);});
  test.each([0,-1,11])('invalid receipt %i is rejected',async n=>{const id=await purchase();const i=await first('select id from purchase_order_items where purchase_order_id=$1',[id]);await expect(db.query('select receive_purchase_item($1,$2,$3)',[i.id,n,location])).rejects.toThrow();});
  test('receipt cannot use another company location',async()=>{const id=await purchase();const i=await first('select id from purchase_order_items where purchase_order_id=$1',[id]);const l=await first('select id from stock_locations where company_id=$1 limit 1',[otherCompany]);await expect(db.query('select receive_purchase_item($1,1,$2)',[i.id,l.id])).rejects.toThrow();});
});

describe('pending center, dashboard and agenda data',()=>{
  test('pending RPC runs without undefined purchase columns',async()=>{await purchase();expect((await rows('select * from pending_center()')).some(x=>x.category==='compra')).toBe(true);});
  test('sent quotes enter pending queue after two days',async()=>{const id=await quote();await db.query("update quotes set status='enviado',created_at=now()-interval '8 days' where id=$1",[id]);expect((await rows('select * from pending_center()')).find(x=>x.record_id===id)?.priority).toBe('high');});
  test('scheduled measurement uses actual domain status',async()=>{const m=await first("insert into measurements(company_id,client_id,scheduled_at) values($1,$2,now()+interval '1 day') returning id",[company,client]);expect((await rows('select * from pending_center()')).some(x=>x.record_id===m.id)).toBe(true);});
  test('measurement without a client is still shown',async()=>{const m=await first('insert into measurements(company_id) values($1) returning id',[company]);expect((await rows('select * from pending_center()')).some(x=>x.record_id===m.id)).toBe(true);});
  test('completed measurements are excluded',async()=>{const m=await first("insert into measurements(company_id,client_id,status) values($1,$2,'medicao_concluida') returning id",[company,client]);expect((await rows('select * from pending_center()')).some(x=>x.record_id===m.id)).toBe(false);});
  test('executive dashboard runs against actual schema',async()=>{await purchase();const result=(await first('select dashboard_executivo() data')).data;expect(Number(result.compras_pendentes)).toBe(1);});
  test('agenda includes source for operational and measurement events',async()=>{await db.query("insert into operational_events(company_id,title,event_type,starts_at) values($1,'Reunião','reuniao',now())",[company]);await db.query('insert into measurements(company_id,client_id,scheduled_at) values($1,$2,now())',[company,client]);expect(new Set((await rows('select source from v_operational_agenda')).map(x=>x.source))).toEqual(new Set(['operational_events','measurements']));});
  test('unauthenticated pending center returns no records',async()=>{await purchase();await actAs('');expect(await rows('select * from pending_center()')).toEqual([]);});
  test('seller does not receive financial alerts via definer RPC',async()=>{await manualSale();await db.query('update financial_entries set due_date=current_date-10');await actAs(seller);expect((await rows('select * from pending_center()')).filter(x=>x.category.startsWith('financeiro'))).toEqual([]);});
  test('tenant isolation works under actual authenticated RLS',async()=>{await actAs(admin);await db.exec('set local role authenticated');expect((await rows('select id from clients')).map(x=>x.id)).toEqual([client]);});
  test('search rejects short input and finds literal customer names',async()=>{await db.exec('set local role authenticated');expect(await rows("select * from global_search('A')")).toEqual([]);expect((await rows("select * from global_search('Cliente A')")).some(x=>x.entity_id===client)).toBe(true);});
});


describe('production and installation',()=>{
  async function production(){const q=await quote();const sale=(await first('select approve_quote($1) id',[q])).id;return await first('select p.*,o.id order_id from production_orders p join orders o on o.id=p.order_id where o.sale_id=$1',[sale]);}
  test('released production advances through all steps only once',async()=>{const po=await production();await db.query("update production_orders set status='liberado' where id=$1",[po.id]);for(let i=0;i<7;i++) await db.query('select advance_production_step($1)',[po.id]);expect((await first('select status from production_orders where id=$1',[po.id])).status).toBe('finalizado');expect(Number((await first('select count(*) n from production_step_logs where production_order_id=$1',[po.id])).n)).toBe(7);await expect(db.query('select advance_production_step($1)',[po.id])).rejects.toThrow(/finalizado/);});
  test('completed installation triggers followup and final collection',async()=>{const po=await production();const i=await first("insert into installations(company_id,order_id,status,scheduled_at) values($1,$2,'agendada',now()) returning id",[company,po.order_id]);await db.query("update installation_checklists set completed=true where installation_id=$1",[i.id]);expect((await first('select installation_status from orders where id=$1',[po.order_id])).installation_status).toBe('concluida');expect(Number((await first('select count(*) n from followups where company_id=$1',[company])).n)).toBeGreaterThan(0);});
  test('measurement can generate a linked quotation',async()=>{const m=await first('select create_measurement_from_client($1,now()) id',[client]);await db.query("insert into measurement_items(company_id,measurement_id,product,quantity) values($1,$2,'Janela',1)",[company,m.id]);const q=await first('select create_quote_from_measurement($1) id',[m.id]);expect(q.id).toBeTruthy();expect((await first('select quote_id from measurements where id=$1',[m.id])).quote_id).toBe(q.id);});
  test('pricing supports independent natural and painted variants',async()=>{await db.query("insert into gutter_prices(company_id,product,thickness,cut_mm,color,unit_price) values($1,'Calha teste','0.50 mm',200,'Natural',10),($1,'Calha teste','0.50 mm',200,'Preto',20)",[company]);expect(Number((await first("select count(*) n from gutter_prices where company_id=$1 and product='Calha teste'",[company])).n)).toBe(2);});
  test('reports exclude reversed payments',async()=>{const sale=await manualSale(30);const p=await first('select p.id from payments p join financial_entries e on e.id=p.financial_entry_id where e.sale_id=$1',[sale]);await db.query('select reverse_payment($1)',[p.id]);await db.exec('set local role authenticated');expect(Number((await first('select reporting_summary(current_date,current_date) data')).data.received)).toBe(0);});
  test('seller dashboard follows table permissions under RLS',async()=>{await manualSale();await actAs(seller);await db.exec('set local role authenticated');const d=(await first('select dashboard_executivo() data')).data;expect(Number(d.receitas_abertas)).toBe(0);});
});


describe('document templates and installation safeguards',()=>{
  test('invalid default template does not clear the existing default',async()=>{await db.query("delete from document_templates where company_id=$1 and type='orcamento_calhas'",[company]);const t=await first("insert into document_templates(company_id,name,type,is_default) values($1,'Padrão','orcamento_calhas',true) returning id",[company]);await db.exec('savepoint invalid_template');await expect(db.query("select set_default_document_template($1,'orcamento_calhas')",[otherClient])).rejects.toThrow();await db.exec('rollback to savepoint invalid_template');expect((await first('select is_default from document_templates where id=$1',[t.id])).is_default).toBe(true);});
  test('changing default is atomic and preserves a single default',async()=>{await db.query("delete from document_templates where company_id=$1 and type='orcamento_calhas'",[company]);await db.query("insert into document_templates(company_id,name,type,is_default) values($1,'Antigo','orcamento_calhas',true)",[company]);const t=await first("insert into document_templates(company_id,name,type) values($1,'Novo','orcamento_calhas') returning id",[company]);await db.query("select set_default_document_template($1,'orcamento_calhas')",[t.id]);expect((await rows("select id from document_templates where company_id=$1 and type='orcamento_calhas' and is_default",[company])).map(x=>x.id)).toEqual([t.id]);});
});


describe('operational alerts',()=>{
 test('draft quotes appear as preparation tasks',async()=>{const id=await quote();expect((await rows('select * from pending_center()')).find(x=>x.record_id===id)?.subtitle).toBe('Preparar e enviar ao cliente');});
 test('alert generation works and deduplicates overdue entries',async()=>{await manualSale();await db.query('update financial_entries set due_date=current_date-10');expect(Number((await first('select generate_operational_alerts() n')).n)).toBe(1);expect(Number((await first('select generate_operational_alerts() n')).n)).toBe(0);});
 test('alert generation cannot sweep another company',async()=>{await manualSale();await db.query('update financial_entries set due_date=current_date-10');await actAs(otherAdmin);expect(Number((await first('select generate_operational_alerts() n')).n)).toBe(0);});
});
