// Real-browser mobile flows and desktop preservation, against the isolated test DB.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {launch,login,visit,BASE,trackRequests,settle} from './helpers.mjs';
const out=path.join(process.env.TEST_WORK_DIR??'.test-work','mobile');
let browser,page,db,eventId,clientId;
const title='Medição de esquadrias com detalhes completos para uso no celular';
const address='Rua das Esquadrias, 123, Rau, Jaraguá do Sul, SC';
before(async()=>{
 db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const {rows:[p]}=await db.query("select p.id,p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1",[process.env.E2E_EMAIL??'admin@teste.local']);
 const c=await db.query("insert into clients(company_id,name,address,neighborhood,city,state,phone) values($1,$2,'Rua Cliente, 10','Rau','Jaraguá do Sul','SC',$3) returning id",[p.company_id,'Cliente Mobile '+Date.now(),'55479'+String(Date.now()).slice(-8)]);clientId=c.rows[0].id;
 const e=await db.query("insert into operational_events(company_id,client_id,event_type,title,starts_at,address,phone,notes,status) values($1,$2,'medicao',$3,now(),$4,'5547998887766','Ligar antes de chegar. Portão preto.','agendado') returning id",[p.company_id,clientId,title,address]);eventId=e.rows[0].id;
 browser=await launch();page=await browser.newPage();trackRequests(page);await login(page,process.env.E2E_EMAIL??'admin@teste.local',process.env.E2E_PASSWORD??'senha-de-teste-123');fs.mkdirSync(out,{recursive:true});
});
after(async()=>{await browser?.close();await db?.end()});
async function capture(name){await page.screenshot({path:path.join(out,name+'.png'),fullPage:true})}
async function noOverflow(label){const d=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(d.scroll<=d.width+1,`${label}: viewport ${d.width}px, página ${d.scroll}px`)}
test('mobile: core modules fit 320px and 430px without page-wide scrolling', {timeout:180000},async()=>{
 for(const width of [320,430]){
  await page.setViewport({width,height:932,isMobile:true,hasTouch:true,deviceScaleFactor:1});
  for(const route of ['/dashboard','/clientes','/orcamentos','/pipeline','/financeiro','/agenda','/medicoes','/atendimento']){
   const r=await visit(page,route);assert.equal(r.error,null,`${width}px ${route}: ${r.error}`);assert.equal(r.status,200);await noOverflow(`${width}px ${route}`);
   const bell=await page.$eval('button[aria-label^="Avisos"]',b=>{const r=b.getBoundingClientRect();return {visible:getComputedStyle(b).display!=='none',w:r.width,x:r.left,right:r.right}});
   assert.ok(bell.visible&&bell.w>=40&&bell.x>=0&&bell.right<=width,'Sino visível e alcançável');
   if(width===430)await capture(route.slice(1)+'-430');
  }
 }
});
test('mobile: tapping an appointment opens its address, map routes, contacts and information',async()=>{
 await page.setViewport({width:393,height:852,isMobile:true,hasTouch:true});await page.goto(`${BASE}/agenda`,{waitUntil:'networkidle0'});
 await page.waitForSelector('[data-testid="mobile-agenda"]');const selector=`button[aria-label="Abrir compromisso: ${title}"]`;await page.waitForSelector(selector);await page.click(selector);
 await page.waitForSelector('[role="dialog"][aria-modal="true"]');await page.waitForFunction(a=>document.querySelector('[role="dialog"]')?.textContent.includes(a),{},address);
 const links=await page.$$eval('[role="dialog"] a',as=>as.map(a=>({text:a.innerText,href:a.href})));
 assert.ok(links.some(a=>a.text.includes('Google Maps')&&a.href.includes(encodeURIComponent(address))));assert.ok(links.some(a=>a.text.includes('Waze')&&a.href.includes('navigate=yes')));assert.ok(links.some(a=>a.text.includes('Ligar')&&a.href.startsWith('tel:')));assert.ok(links.some(a=>a.text.includes('WhatsApp')&&a.href.startsWith('https://wa.me/')));
 assert.ok((await page.$eval('[role="dialog"]',e=>e.innerText)).includes('Portão preto'));await noOverflow('Agenda aberta');await capture('compromisso-393');
 await page.click('button[aria-label="Fechar compromisso"]');assert.equal(await page.$('[role="dialog"]'),null);
});
test('mobile: direct event links work and new commitments preserve their location',async()=>{
 await page.goto(`${BASE}/agenda?evento=${eventId}&origem=operational_events`,{waitUntil:'networkidle0'});await page.waitForSelector('[role="dialog"]');await page.click('button[aria-label="Fechar compromisso"]');
 await page.click('button[aria-label="Novo compromisso"]');await page.waitForSelector('input[name="address"]');const newTitle='Visita Mobile '+Date.now();await page.type('input[name="title"]',newTitle);await page.type('input[name="address"]',address);await page.type('input[name="phone"]','47998887766');
 await page.evaluate(()=>document.querySelector('input[name="title"]').form.requestSubmit());await settle(page);
 const {rows}=await db.query('select address,phone from operational_events where title=$1',[newTitle]);assert.equal(rows[0]?.address,address);assert.equal(rows[0]?.phone,'47998887766');
});
test('mobile: quote cards open the quote directly and tables expose labeled record cards',async()=>{
 await page.goto(`${BASE}/clientes`,{waitUntil:'networkidle0'});assert.equal(await page.$eval('.mobile-record-table',e=>getComputedStyle(e).minWidth),'0px');assert.ok(await page.$('.mobile-record-table td[data-label]'));
 await page.goto(`${BASE}/orcamentos`,{waitUntil:'networkidle0'});await page.click('.quote-list-row');await page.waitForFunction(()=>/^\/orcamentos\/[0-9a-f-]+$/.test(location.pathname));
});
test('desktop: original calendar, quote detail panel, tables and 4-column dashboard remain',async()=>{
 await page.setViewport({width:1366,height:900,isMobile:false,hasTouch:false});
 await page.goto(`${BASE}/agenda`,{waitUntil:'networkidle0'});assert.equal(await page.$('[data-testid="mobile-agenda"]'),null);assert.ok(await page.$('.grid.grid-cols-7'));await capture('agenda-desktop');
 await page.goto(`${BASE}/clientes`,{waitUntil:'networkidle0'});assert.equal(await page.$eval('.mobile-record-table',e=>getComputedStyle(e).display),'table');
 await page.goto(`${BASE}/orcamentos`,{waitUntil:'networkidle0'});assert.notEqual(await page.$eval('.quote-list-detail',e=>getComputedStyle(e).display),'none');
 await page.goto(`${BASE}/dashboard`,{waitUntil:'networkidle0'});assert.equal(await page.$eval('.mobile-kpis',e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),4);await capture('dashboard-desktop');
});
