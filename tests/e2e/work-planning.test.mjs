import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {launch,login,BASE,pageProblem} from './helpers.mjs';
let db,browser,page,admin,company,team,vehicle,event,date;
const selector=action=>`form:has(input[name="action"][value="${action}"])`;
async function openForm(action){await page.$eval(selector(action),f=>{for(let p=f.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});}
async function submit(action){
 await openForm(action);
 await Promise.all([page.waitForNavigation({waitUntil:'networkidle0',timeout:60000}),page.click(`${selector(action)} button[type="submit"]`)]);
 assert.equal(await pageProblem(page),null);
}
before(async()=>{
 db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 ({id:admin,company_id:company}=(await db.query("select id,company_id from profiles where id=(select id from auth.users where email='admin@teste.local')")).rows[0]);
 date=(await db.query("select ((now() at time zone 'America/Sao_Paulo')::date+8)::text d")).rows[0].d;
 const run=Date.now().toString(36);
 await db.query('begin');await db.query('set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[admin]);
 const manage=async(action,payload)=>(await db.query('select work_manage($1,$2::jsonb) id',[action,JSON.stringify(payload)])).rows[0].id;
 team=await manage('team',{name:`Equipe E2E ${run}`,leader_id:admin});vehicle=await manage('vehicle',{name:`Van E2E ${run}`,vehicle_type:'Van'});
 await db.query('commit');
 event=(await db.query("insert into operational_events(company_id,event_type,title,starts_at,address,status) values($1,'medicao',$2,($3::date+time '08:00') at time zone 'America/Sao_Paulo','Rua do teste, 123','agendado') returning id",[company,`Medição E2E ${run}`,date])).rows[0].id;
 browser=await launch();page=await browser.newPage();await page.setViewport({width:375,height:812,isMobile:true,hasTouch:true});
 await login(page,'admin@teste.local','senha-de-teste-123');
}, {timeout:60000});
after(async()=>{await browser?.close();await db?.end();});
test('celular: planejar saída, selecionar visita da agenda e conferir separado/carregado/retorno',{timeout:120000},async()=>{
 await page.goto(`${BASE}/equipes?dia=${date}`,{waitUntil:'networkidle0'});assert.equal(await pageProblem(page),null);
 await openForm('day');await page.select(`${selector('day')} select[name="team_id"]`,team);await page.select(`${selector('day')} select[name="vehicle_id"]`,vehicle);await page.select(`${selector('day')} select[name="driver_id"]`,admin);await submit('day');
 await page.select(`${selector('job')} select[name="source_choice"]`,`operational_events:${event}`);await submit('job');
 await openForm('load_add');await page.type(`${selector('load_add')} input[name="description"]`,'Escada de teste');await page.select(`${selector('load_add')} select[name="kind"]`,'ferramenta');await page.type(`${selector('load_add')} input[name="quantity"]`,'1');await submit('load_add');
 await submit('load_state');await submit('load_state');await submit('load_state');
 const result=(await db.query('select i.state,i.returned_quantity,(select count(*)::int from work_load_events e where e.item_id=i.id) n from work_load_items i join work_day_jobs j on j.id=i.job_id where j.event_id=$1',[event])).rows[0];
 assert.equal(result.state,'retorno_conferido');assert.equal(Number(result.returned_quantity),1);assert.equal(result.n,3);
 assert.ok((await page.evaluate(()=>document.body.innerText)).includes('Retorno conferido'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'tela não pode vazar horizontalmente no celular');
 const out=path.join(process.env.TEST_WORK_DIR??'.test-work','mobile');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'equipes-carregamento-375.png'),fullPage:true});
});
