import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {launch,login,BASE,pageProblem} from './helpers.mjs';import {SERVICE_ROLE_KEY} from './fake-supabase.mjs';
let db,browser,page,boss,company,date,dayA,dayB,quoteA,email;const password='planejamento-teste';
async function row(sql,args=[]){return (await db.query(sql,args)).rows[0];}
async function manage(action,payload){return (await row('select work_manage($1,$2::jsonb) id',[action,JSON.stringify(payload)])).id;}
async function button(selector){await page.$eval(selector,b=>b.scrollIntoView({block:'center'}));await page.click(selector);}
before(async()=>{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(BASE).hostname));assert.ok(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
 db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();email=`planejamento-${Date.now()}@teste.local`;
 const result=await fetch('http://localhost:54321/auth/v1/admin/users',{method:'POST',headers:{Authorization:`Bearer ${SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({email,password,user_metadata:{full_name:'Gerente de teste'}})});assert.equal(result.status,200);boss=(await result.json()).id;
 company=(await row("select bootstrap_company('Planejamento E2E',null,$1) id",[boss])).id;await db.query("select set_config('request.jwt.claim.sub',$1,false)",[boss]);
 date=(await row('select (current_date+12)::text d')).d;
 for(const name of ['A','B']){const driver=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[driver,`${driver}@teste.local`]);await db.query('insert into profiles(id,company_id,full_name) values($1,$2,$3)',[driver,company,`Instalador ${name}`]);await db.query("insert into user_roles(company_id,profile_id,role) values($1,$2,'instalador')",[company,driver]);const team=await manage('team',{name:`Equipe ${name}`,leader_id:driver,active:true}),vehicle=await manage('vehicle',{name:`Van ${name}`,vehicle_type:'Van',status:'disponivel'});const id=await manage('day',{work_date:date,team_id:team,vehicle_id:vehicle,driver_id:driver,members:[driver]});if(name==='A')dayA=id;else dayB=id;}
 const client=(await row("insert into clients(company_id,name) values($1,'Cliente do planejamento') returning id",[company])).id;
 for(const [i,hour,minutes]of [[1,8,120],[2,8,180],[3,12,60]]){const quote=(await row('select create_window_quote($1::jsonb) id',[JSON.stringify({client_id:client,installation_duration_minutes:minutes,discount:0,freight:0,items:[{product:'Janela',measurements:'1200 x 1000',quantity:1,unit_price:100}]})])).id;if(i===1)quoteA=quote;const st=(await row('select sale_type_id from quotes where id=$1',[quote])).sale_type_id;const sale=(await row('insert into sales(company_id,sale_number,client_id,sale_type_id,seller_id) values($1,$2,$3,$4,$5) returning id',[company,`DUR-E2E-${i}`,client,st,boss])).id;await db.query("update quotes set status='aprovado',sale_id=$1 where id=$2",[sale,quote]);const order=(await row('insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,$2,$3,$4,$5) returning id',[company,`PED-DUR-${i}`,sale,client,st])).id;await db.query("insert into installations(company_id,order_id,scheduled_at,status,address) values($1,$2,($3::date+($4::int*interval '1 hour')) at time zone 'America/Sao_Paulo','agendada','Rua do planejamento, 123')",[company,order,date,hour]);}
 browser=await launch();page=await browser.newPage();await page.setViewport({width:375,height:812,isMobile:true,hasTouch:true});await login(page,email,password);
},{timeout:60000});
after(async()=>{await browser?.close();await db?.end();});
test('celular: duração interna, jornada, revisão e OS por equipe sem alterar o PDF do cliente',{timeout:120000},async()=>{
 await page.goto(`${BASE}/orcamentos/${quoteA}`,{waitUntil:'networkidle0'});assert.equal(await pageProblem(page),null);
 await page.$eval('[data-testid="installation-duration-hours"]',el=>{el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));});
 // Campo React: troca pelo setter nativo e dispara o evento do usuário.
 await page.$eval('[data-testid="installation-duration-hours"]',el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'2.5');el.dispatchEvent(new Event('input',{bubbles:true}));});
 await button('section[aria-label="Tempo de instalação interno"] button');await page.waitForFunction(()=>document.body.innerText.includes('Duração salva.'));
 assert.equal((await row('select installation_duration_minutes m from quotes where id=$1',[quoteA])).m,150);
 await page.goto(`${BASE}/equipes?dia=${date}`,{waitUntil:'networkidle0'});assert.equal(await pageProblem(page),null);
 const scope=`[data-testid="work-day"]:has(form input[name="id"][value="${dayA}"])`;const form=`${scope} form:has(input[name="action"][value="day_time"])`;
 await page.$eval(form,f=>{f.closest('details').open=true;});await page.$eval(`${form} input[name="work_hours"]`,el=>el.value='4');await page.$eval(`${form} input[name="reserved_minutes"]`,el=>el.value='60');
 await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),button(`${form} button[type="submit"]`)]);assert.equal(await pageProblem(page),null);
 assert.equal((await row('select work_minutes m from work_days where id=$1',[dayA])).m,240);
 assert.equal((await row('select count(*)::int n from work_day_jobs where company_id=$1',[company])).n,0,'sugestão não pode gravar sozinha');
 const suggestions='section[aria-label="Sugestão de ordens do dia"]';assert.equal((await page.$$(`${suggestions} input[type="checkbox"]`)).length,3);
 await button(`${suggestions} button[type="submit"]`);await page.waitForFunction(()=>document.body.innerText.includes('3 serviço(s) incluído(s)'));
 assert.equal((await row('select count(*)::int n from work_day_jobs where company_id=$1',[company])).n,3);
 const loadA=(await row('select sum(duration_minutes)::int n from work_day_jobs where day_id=$1',[dayA])).n,loadB=(await row('select sum(duration_minutes)::int n from work_day_jobs where day_id=$1',[dayB])).n;
 assert.ok(loadA<=180,'Equipe A precisa respeitar a jornada ajustada e a reserva');assert.ok(loadB<=480,'Equipe B precisa respeitar 8 horas');assert.equal(loadA+loadB,390,'todos os tempos devem entrar no planejamento');
 await page.waitForFunction(()=>document.querySelectorAll('[data-testid="work-job"]').length===3);assert.equal((await page.$$(`${suggestions} input[type="checkbox"]`)).length,0,'a tela precisa refletir a confirmação sem manter sugestões já aplicadas');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 const out=path.join(process.env.TEST_WORK_DIR??'.test-work','mobile');fs.mkdirSync(out,{recursive:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'planejamento-instalacao-375.png'),fullPage:true});
 const printDay=(await row('select j.day_id from work_day_jobs j join orders o on o.id=j.order_id join quotes q on q.sale_id=o.sale_id where q.id=$1',[quoteA])).day_id;
 await page.goto(`${BASE}/equipes/${printDay}/ordem-do-dia`,{waitUntil:'networkidle0'});assert.equal(await pageProblem(page),null);assert.ok((await page.evaluate(()=>document.body.innerText)).includes('2 h 30 min'));
 await page.emulateMediaType('print');assert.equal(await page.$eval('h1',el=>getComputedStyle(el).visibility),'visible','a OS deve ficar visível no modo de impressão');
 await page.pdf({path:path.join(out,'os-instalacao.pdf'),format:'A4',printBackground:true});await page.emulateMediaType('screen');
 await page.goto(`${BASE}/orcamentos/${quoteA}/impressao`,{waitUntil:'networkidle0'});assert.equal(await pageProblem(page),null);const printed=await page.evaluate(()=>document.body.innerText);assert.ok(!printed.includes('Duração da instalação'));assert.ok(!printed.includes('Planejamento da instalação'));assert.ok(!printed.includes('2 h 30 min'));
});
