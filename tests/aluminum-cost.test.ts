import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './helpers/database';
let db: PGlite, company: string, client: string, otherCompany: string;
const admin='10000000-0000-4000-8000-000000000161', other='10000000-0000-4000-8000-000000000162';
async function row(sql:string,params:unknown[]=[]) { return (await db.query<Record<string,any>>(sql,params)).rows[0]; }
async function plan(demands:{cut_mm:number,meters:number}[]) { return (await row('select crm_private.aluminum_1mm_plan($1) p',[JSON.stringify(demands)])).p; }
async function quote(items:Record<string,unknown>[]=[{product:'Calha de Beiral',category:'Calhas',thickness:'0.5mm',cut:'200',color:'Aluminio Natural',quantity:2,meters:5,unit_price:20}]) {
 return (await row('select save_gutter_quote_complete($1) id',[JSON.stringify({client_id:client,discount:0,freight:0,items,special_items:[]})])).id;
}
async function approve(id:string):Promise<Record<string,any>> {
 const sale=(await row('select approve_quote($1) id',[id])).id;
 await db.exec('set constraints all immediate; set constraints all deferred');
 return {sale,...await row('select o.id,o.expected_cost,a.aluminum_kg,a.total_cost,a.price_per_kg,a.calculation from orders o left join order_aluminum_costs a on a.order_id=o.id where o.sale_id=$1',[sale])};
}
beforeAll(async()=>{
 db=await createTestDatabase();
 await db.query("insert into auth.users(id,email) values($1,'aluminum@test.invalid'),($2,'aluminum-other@test.invalid')",[admin,other]);
 company=(await row("select bootstrap_company('Aluminum',null,$1) id",[admin])).id;
 otherCompany=(await row("select bootstrap_company('Other aluminum',null,$1) id",[other])).id;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
 client=(await row("insert into clients(company_id,name) values($1,'Client') returning id",[company])).id;
 await db.exec('grant usage on schema auth to authenticated; grant select on profiles to authenticated');
});
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[admin]);});
afterEach(async()=>{await db.exec('rollback');});
afterAll(async()=>{await db?.close();});

test('pesos transcritos da tabela e cortes proporcionais mantêm precisão',async()=>{
 expect(Number((await row('select crm_private.aluminum_kg_per_meter(0.5,330) n')).n)).toBe(.448);
 expect(Number((await row('select crm_private.aluminum_kg_per_meter(0.6,500) n')).n)).toBe(.813);
 expect(Number((await row('select crm_private.aluminum_kg_per_meter(0.7,800) n')).n)).toBe(1.518);
 expect(Number((await row('select crm_private.aluminum_kg_per_meter(0.6,200) n')).n)).toBe(.325);
});
test('1 mm combina 700 + 300 na bobina de 1000 sem perda',async()=>{
 const result=await plan([{cut_mm:700,meters:10},{cut_mm:300,meters:10}]);
 expect(Number(result.kg)).toBeCloseTo(27.5,6); expect(Number(result.waste_kg)).toBe(0); expect(result.utilization_pct).toBe(100);
 expect(result.patterns).toEqual(expect.arrayContaining([expect.objectContaining({coil_width_mm:1000,coil_meters:10,cuts:[{cut_mm:300,strips:1},{cut_mm:700,strips:1}]})]));
});
test('1 mm escolhe 1200 para 300 e 1000 para 500; o custo inclui a sobra real de 700',async()=>{
 expect(Number((await plan([{cut_mm:300,meters:12}])).kg)).toBeCloseTo(9.9,6);
 expect(Number((await plan([{cut_mm:500,meters:8}])).kg)).toBeCloseTo(11,6);
 const waste=await plan([{cut_mm:700,meters:1}]); expect(Number(waste.kg)).toBeCloseTo(2.75,6);expect(Number(waste.waste_kg)).toBeCloseTo(.825,6);
});
test('plano conserva todas as metragens e não usa outras larguras de bobina',async()=>{
 const demands=[{cut_mm:200,meters:7.5},{cut_mm:330,meters:4},{cut_mm:500,meters:9},{cut_mm:700,meters:3},{cut_mm:1000,meters:2},{cut_mm:1200,meters:1}];
 const result=await plan(demands); const actual=new Map<number,number>();
 for(const pattern of result.patterns){expect([1000,1200]).toContain(pattern.coil_width_mm);let width=0;for(const cut of pattern.cuts){width+=cut.cut_mm*cut.strips;actual.set(cut.cut_mm,(actual.get(cut.cut_mm)||0)+cut.strips*Number(pattern.coil_meters));}expect(width).toBeLessThanOrEqual(pattern.coil_width_mm);}
 for(const demand of demands)expect(actual.get(demand.cut_mm)).toBeCloseTo(demand.meters,4);
});
test('fechamento grava custo uma vez, preserva preço antigo e não cria pagamento fictício',async()=>{
 await row('select save_aluminum_cost_price(10)');
 const id=await quote();const result=await approve(id);
 expect(Number(result.aluminum_kg)).toBeCloseTo(2.71,6);expect(Number(result.total_cost)).toBe(27.1);expect(Number(result.expected_cost)).toBe(27.1);
 await row('select save_aluminum_cost_price(20)');await approve(id);
 expect(Number((await row('select total_cost from order_aluminum_costs where order_id=$1',[result.id])).total_cost)).toBe(27.1);
 expect(Number((await row('select count(*) n from order_aluminum_costs where order_id=$1',[result.id])).n)).toBe(1);
 expect(Number((await row("select count(*) n from financial_entries where entry_type='pagar'")).n)).toBe(0);
 expect(Number((await row('select count(*) n from payments')).n)).toBe(0);
 const next=await approve(await quote());expect(Number(next.expected_cost)).toBe(54.2);
});
test('configuração isolada por empresa e custos não configurados não são inventados',async()=>{
 const without=await approve(await quote());expect(without.expected_cost).toBeNull();
 await db.exec('set local role authenticated');await row('select save_aluminum_cost_price(10)');
 expect((await row('select company_id from aluminum_cost_settings')).company_id).toBe(company);
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);
 expect((await db.query('select * from aluminum_cost_settings')).rows).toHaveLength(0);
 await expect(row('select preview_quote_aluminum_cost($1)',[client])).rejects.toThrow('Orcamento nao encontrado');
});
test('fechamento misto usa o plano de 1 mm e soma os pesos tabelados das outras espessuras',async()=>{
 await row('select save_aluminum_cost_price(10)');
 const common={product:'Calha de Beiral',category:'Calhas',color:'Aluminio Natural',quantity:2,meters:5,unit_price:30};
 const result=await approve(await quote([{...common,thickness:'1.0mm',cut:'700'},{...common,thickness:'1.0mm',cut:'300'},{...common,thickness:'0.5mm',cut:'200'}]));
 expect(Number(result.aluminum_kg)).toBeCloseTo(30.21,6);expect(Number(result.expected_cost)).toBe(302.1);
 expect(Number(result.calculation.one_mm.utilization_pct)).toBe(100);
});
test('cortes usuais completos conservam a demanda com cálculo limitado',async()=>{
 const demands=[150,200,250,300,330,350,400,500,600,700,800,900,1000,1200].map(cut_mm=>({cut_mm,meters:5}));
 const result=await plan(demands);const consumed=new Map<number,number>();
 for(const pattern of result.patterns)for(const cut of pattern.cuts)consumed.set(cut.cut_mm,(consumed.get(cut.cut_mm)||0)+cut.strips*Number(pattern.coil_meters));
 for(const demand of demands)expect(consumed.get(demand.cut_mm)).toBeCloseTo(5,4);
},10000);
test('erros no cálculo revertem o fechamento inteiro',async()=>{
 await row('select save_aluminum_cost_price(10)');
 const id=await quote([{product:'Calha de Beiral',thickness:'0.8mm',cut:'200',color:'Aluminio Natural',quantity:1,meters:2,unit_price:20}]);
 await db.exec('savepoint approval');
 await row('select approve_quote($1)',[id]);
 await expect(db.exec('set constraints all immediate')).rejects.toThrow('Espessura de aluminio sem tabela');
 await db.exec('rollback to savepoint approval');
 expect((await row('select sale_id from quotes where id=$1',[id])).sale_id).toBeNull();
 expect(Number((await row('select count(*) n from order_aluminum_costs')).n)).toBe(0);
});
test('tabelas de custo não permitem escrita direta de usuário autenticado',async()=>{
 await db.exec('set local role authenticated');
 await row('select save_aluminum_cost_price(10)');
 await expect(db.query('update aluminum_cost_settings set price_per_kg=1 where company_id=$1',[company])).rejects.toThrow('permission denied');
});
