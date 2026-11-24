import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import pg from 'pg';
import {launch,login,BASE,pageProblem} from './helpers.mjs';
import {SERVICE_ROLE_KEY} from './fake-supabase.mjs';
let db,browser,page,company,device,vehicle,callsBefore=0;const remote=[];
const form=action=>`form:has(input[name="action"][value="${action}"])`;
async function submit(selector){
 await page.$eval(selector,b=>b.scrollIntoView({block:'center'}));
 await Promise.all([page.waitForNavigation({waitUntil:'networkidle0',timeout:60000}),page.click(selector)]);
 assert.equal(await pageProblem(page),null);
}
before(async()=>{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(BASE).hostname),'este teste só pode usar o CRM local');
 assert.ok(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname),'este teste só pode usar banco local');
 const health=(await (await fetch('http://127.0.0.1:54323/health')).json()).record;assert.equal(health.fake,true,'servidor fictício precisa estar ativo');callsBefore=health.calls.length;
 db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const email=`gps-${Date.now()}@teste.local`,password='senha-gps-login-teste';
 const created=await fetch('http://localhost:54321/auth/v1/admin/users',{method:'POST',headers:{Authorization:`Bearer ${SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({email,password,user_metadata:{full_name:'Gerente GPS teste'}})});
 assert.equal(created.status,200);const user=await created.json();company=(await db.query("select bootstrap_company('GPS E2E isolado',null,$1) id",[user.id])).rows[0].id;
 browser=await launch();page=await browser.newPage();await page.setViewport({width:375,height:812,isMobile:true,hasTouch:true});
 await page.setRequestInterception(true);page.on('request',req=>{
  const url=req.url();if(url.includes('api.trackceo.com')||url.includes('54323'))remote.push(url);
  if(url.startsWith('https://tile.openstreetmap.org/'))return req.respond({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNJkAAAAASUVORK5CYII=','base64')});
  return req.continue();
 });
 await login(page,email,password);
},{timeout:60000});
after(async()=>{await browser?.close();await db?.end();});
test('celular: conexão protegida, vínculo, mapa, atualização e desconexão preservando a frota',{timeout:120000},async()=>{
 await page.goto(`${BASE}/equipes/rastreamento`,{waitUntil:'networkidle0'});assert.equal(await pageProblem(page),null);
 await page.type('[data-testid="tracking-connect"] input[name="account"]','frota-teste');await page.type('[data-testid="tracking-connect"] input[name="password"]','senha-gps-teste');
 await submit('[data-testid="tracking-connect"] button[type="submit"]');
 assert.equal((await page.$$('[data-testid="tracking-device"]')).length,2);
 const secret=(await db.query('select password_encrypted,token_encrypted from crm_private.trackceo_connections where company_id=$1',[company])).rows[0];assert.match(secret.password_encrypted,/^enc:/);assert.match(secret.token_encrypted,/^enc:/);assert.ok(!JSON.stringify(secret).includes('senha-gps-teste'));
 device=(await db.query("select id from trackceo_devices where company_id=$1 and imei='860000000000001'",[company])).rows[0].id;
 const card=`[data-testid="tracking-device"]:has(input[name="device"][value="${device}"])`;
 await submit(`${card} form:has(input[name="create"][value="true"]) button[type="submit"]`);
 vehicle=(await db.query('select vehicle_id from trackceo_devices where id=$1',[device])).rows[0].vehicle_id;assert.ok(vehicle);
 await page.waitForSelector('[data-testid="tracking-map"] .leaflet-interactive',{timeout:15000});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'rastreamento precisa caber em 375 px');
 const html=await page.content();assert.ok(!html.includes('senha-gps-teste'));assert.ok(!html.includes('trackceo-token-ficticio'));assert.equal(remote.length,0,'browser não pode receber token nem consultar a API do rastreador diretamente');
 await db.query("update crm_private.trackceo_connections set last_attempt_at=now()-interval '1 minute' where company_id=$1",[company]);
 await submit(`${form('sync')} button[type="submit"]`);
 const calls=(await (await fetch('http://127.0.0.1:54323/health')).json()).record.calls.slice(callsBefore);assert.equal(calls.filter(p=>p==='/api/authorization').length,1,'token precisa ser reutilizado entre requisições');assert.ok(calls.every(p=>['/api/authorization','/api/device/list','/api/track'].includes(p)));
 const out=path.join(process.env.TEST_WORK_DIR??'.test-work','mobile');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'trackceo-375.png'),fullPage:true});
 await page.$eval('[data-testid="tracking-map"]',map=>map.scrollIntoView({block:'center'}));await (await page.$('[data-testid="tracking-map"]')).screenshot({path:path.join(out,'trackceo-mapa-375.png')});
 page.on('dialog',dialog=>dialog.accept());await submit(`${form('disconnect')} button[type="submit"]`);
 assert.equal(await page.$('[data-testid="tracking-map"]'),null);assert.equal((await db.query('select count(*)::int n from work_vehicles where id=$1',[vehicle])).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from trackceo_devices where company_id=$1',[company])).rows[0].n,2);
});
