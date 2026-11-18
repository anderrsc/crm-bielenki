import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { BASE, launch, login, clickAndWait, pageProblem } from './helpers.mjs';

let browser,page,db,company,quoteId,oldPrice;
before(async()=>{
 db=new pg.Client({connectionString:process.env.DATABASE_URL??'postgres://postgres@localhost:5499/crm'});await db.connect();
 const actor=(await db.query('select id,company_id from profiles order by created_at limit 1')).rows[0];company=actor.company_id;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor.id]);
 oldPrice=(await db.query('select price_per_kg from aluminum_cost_settings where company_id=$1',[company])).rows[0]?.price_per_kg;
 const client=(await db.query("insert into clients(company_id,name) values($1,'Cliente Custo Aluminio') returning id",[company])).rows[0].id;
 const payload={client_id:client,discount:0,freight:0,items:[{product:'Calha de Beiral',thickness:'0.5mm',cut:'200',color:'Aluminio Natural',quantity:2,meters:5,unit_price:20}],special_items:[]};
 quoteId=(await db.query('select save_gutter_quote_complete($1) id',[JSON.stringify(payload)])).rows[0].id;
 browser=await launch();page=await browser.newPage();page.on('dialog',d=>d.accept());
 await login(page,process.env.E2E_EMAIL??'admin@teste.local',process.env.E2E_PASSWORD??'senha-de-teste-123');
});
after(async()=>{
 if(db&&company){if(oldPrice===undefined)await db.query('delete from aluminum_cost_settings where company_id=$1',[company]);else await db.query('update aluminum_cost_settings set price_per_kg=$1 where company_id=$2',[oldPrice,company]);}
 await browser?.close();await db?.end();
});
async function setPrice(value){
 await page.goto(`${BASE}/tabela-calhas?aba=custo-aluminio`,{waitUntil:'networkidle0'});
 await page.waitForSelector('input[name="price_per_kg"]');
 await page.click('input[name="price_per_kg"]');
 await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
 await page.type('input[name="price_per_kg"]',value);
 assert.equal(await page.$eval('input[name="price_per_kg"]',el=>el.value),value,'substitui todo o preço anterior antes de salvar');
 await clickAndWait(page,'Salvar preço do kg');
 assert.equal(await pageProblem(page),null);
}
test('preço do kg é ajustável na tela e aparece na previsão do orçamento',async()=>{
 await setPrice('10,00');assert.equal(Number((await db.query('select price_per_kg from aluminum_cost_settings where company_id=$1',[company])).rows[0].price_per_kg),10);
 await page.goto(`${BASE}/orcamentos/${quoteId}`,{waitUntil:'networkidle0'});
 const text=await page.$eval('body',el=>el.innerText);assert.ok(text.includes('Previsão de custo do alumínio'));assert.ok(text.includes('27,10'));
});
test('PDF do cliente não inclui o custo interno do alumínio',async()=>{
 const cookie=(await page.cookies()).map(c=>`${c.name}=${c.value}`).join('; ');
 const response=await fetch(`${BASE}/api/orcamentos/${quoteId}/pdf`,{headers:{cookie}});
 assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/pdf/);
 const file='.test-work/aluminum-cost-private.pdf';await fs.mkdir('.test-work',{recursive:true});await fs.writeFile(file,Buffer.from(await response.arrayBuffer()));
 const text=execFileSync('pdftotext',[file,'-'],{encoding:'utf8'});
 assert.doesNotMatch(text,/Previsão de custo do alumínio|custo previsto no fechamento|preço preservado neste pedido/i);
});
test('aprovação grava custo no pedido e reajuste do kg preserva o fechamento anterior',async()=>{
 await page.goto(`${BASE}/orcamentos/${quoteId}`,{waitUntil:'networkidle0'});await clickAndWait(page,'Aprovar orçamento');assert.equal(await pageProblem(page),null);
 const snapshot=(await db.query('select o.id,o.expected_cost,a.total_cost,a.aluminum_kg from orders o join order_aluminum_costs a on a.order_id=o.id where a.quote_id=$1',[quoteId])).rows[0];
 assert.ok(snapshot);assert.equal(Number(snapshot.aluminum_kg),2.71);assert.equal(Number(snapshot.expected_cost),27.1);
 await page.goto(`${BASE}/pedidos/${snapshot.id}`,{waitUntil:'networkidle0'});assert.ok((await page.$eval('body',el=>el.innerText)).includes('Alumínio · custo previsto no fechamento'));
 await setPrice('20,00');
 assert.equal(Number((await db.query('select total_cost from order_aluminum_costs where order_id=$1',[snapshot.id])).rows[0].total_cost),27.1);
});
