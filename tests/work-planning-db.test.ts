import {beforeAll,afterAll,test,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase} from './helpers/database';
let db:PGlite,c:string,other:string,team:string,car:string,team2:string,car2:string;
const boss='00000000-0000-4000-8000-00000000b001',driver='00000000-0000-4000-8000-00000000b002',worker='00000000-0000-4000-8000-00000000b003',outsider='00000000-0000-4000-8000-00000000b004',bossB='00000000-0000-4000-8000-00000000b005';
async function row(sql:string,args:unknown[]=[]){return (await db.query<Record<string,any>>(sql,args)).rows[0];}
async function as<T>(user:string,fn:()=>Promise<T>){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
const manage=(action:string,p:Record<string,unknown>,user=boss)=>as(user,async()=>(await row('select work_manage($1,$2::jsonb) id',[action,JSON.stringify(p)])).id as string);
const dayDate=async(n:number)=>(await row('select (current_date+$1::int)::text d',[n])).d as string;
const makeDay=async(n:number,t=team,v=car,members=[driver,worker])=>manage('day',{team_id:t,vehicle_id:v,driver_id:members[0],members,work_date:await dayDate(n)});
async function event(n:number,status='agendado'){
 return (await row("insert into operational_events(company_id,event_type,title,starts_at,status,address) values($1,'medicao','Visita de teste',(current_date+$2::int)::timestamp at time zone 'America/Sao_Paulo'+interval '8 hours',$3,'Rua de teste') returning id",[c,n,status])).id as string;
}
beforeAll(async()=>{
 db=await createTestDatabase();await db.query("insert into auth.users(id,email) values($1,'manager@t.invalid'),($2,'driver@t.invalid'),($3,'worker@t.invalid'),($4,'outsider@t.invalid'),($5,'other@t.invalid')",[boss,driver,worker,outsider,bossB]);
 c=(await row("select bootstrap_company('Equipes',null,$1) id",[boss])).id;other=(await row("select bootstrap_company('Outra',null,$1) id",[bossB])).id;
 for(const [id,role] of [[driver,'instalador'],[worker,'estoque'],[outsider,'vendedor']]){
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,$3)",[id,c,role]);
  await db.query('insert into user_roles(company_id,profile_id,role) values($1,$2,$3::app_role)',[c,id,role]);
 }
 await db.exec('grant usage on schema auth to authenticated; grant select on profiles,user_roles,permissions to authenticated');
 team=await manage('team',{name:'Equipe A',leader_id:driver,active:true});
 team2=await manage('team',{name:'Equipe B',leader_id:outsider,active:true});
 await manage('member',{team_id:team,profile_id:worker,duty:'Apoio',end:false});
 car=await manage('vehicle',{name:'Utilitário A',plate:'ABC1D23',vehicle_type:'Caminhonete',status:'disponivel'});
 car2=await manage('vehicle',{name:'Utilitário B',plate:'XYZ1E45',vehicle_type:'Van',status:'disponivel'});
});
afterAll(async()=>{await db?.close();});
test('reservas impedem equipe, veículo e pessoa em duas saídas; snapshots não mudam com o cadastro',async()=>{
 const id=await makeDay(1);
 await expect(makeDay(1)).rejects.toThrow(/já alocado/);
 await expect(makeDay(1,team2,car2,[outsider,worker])).rejects.toThrow(/Funcionário já alocado/);
 await manage('team',{id:team,name:'Equipe A Renomeada',leader_id:driver,active:true});
 expect((await row('select team_name from work_days where id=$1',[id])).team_name).toBe('Equipe A');
 await manage('crew',{id,driver_id:driver,members:[driver]});
 expect((await row('select count(*)::int n from work_day_members where day_id=$1',[id])).n).toBe(3);
 expect((await row('select count(*)::int n from work_day_members where day_id=$1 and released_at is null',[id])).n).toBe(1);
 await makeDay(1,team2,car2,[outsider,worker]);
});
test('inativos e manutenção não recebem nova alocação; participação é encerrada sem apagar',async()=>{
 await manage('vehicle',{id:car2,name:'Utilitário B',plate:'XYZ1E45',vehicle_type:'Van',status:'manutencao'}).catch(async()=>{await manage('day_status',{id:(await row('select id from work_days where vehicle_id=$1 limit 1',[car2])).id,status:'cancelada'});await manage('vehicle',{id:car2,name:'Utilitário B',plate:'XYZ1E45',vehicle_type:'Van',status:'manutencao'});});
 await expect(makeDay(2,team2,car2,[outsider])).rejects.toThrow(/indisponível/);
 await manage('vehicle',{id:car2,name:'Utilitário B',plate:'XYZ1E45',vehicle_type:'Van',status:'disponivel'});
 await manage('member',{team_id:team,profile_id:worker,duty:'Apoio',end:true});
 expect((await row('select count(*)::int n from work_team_members where team_id=$1 and profile_id=$2 and ended_at is not null',[team,worker])).n).toBeGreaterThan(0);
 await db.query("update profiles set status='inativo' where id=$1",[outsider]);
 await expect(makeDay(2,team2,car2,[outsider])).rejects.toThrow(/inativo/);
 await db.query("update profiles set status='ativo' where id=$1",[outsider]);
});
test('agenda existente, visita única, reagendamento exige revisão e cancelamento preserva história',async()=>{
 const id=await makeDay(3),e=await event(3);
 const options=await as(boss,()=>row('select work_job_options(current_date+3) j'));
 expect(options.j.some((o:any)=>o.id===e)).toBe(true);
 const job=await manage('job',{day_id:id,source:'operational_events',source_id:e,position:1});
 await expect(manage('job',{day_id:id,source:'operational_events',source_id:e,position:2})).rejects.toThrow(/unique|duplicate/);
 await db.query("update operational_events set address='Outro endereço' where id=$1",[e]);
 expect((await row('select needs_review from work_day_jobs where id=$1',[job])).needs_review).toBe(true);
 await expect(manage('day_status',{id,status:'em_andamento'})).rejects.toThrow(/Revise/);
 await manage('job_review',{id:job,position:1});
 await db.query("update operational_events set starts_at=starts_at+interval '1 day' where id=$1",[e]);
 await expect(manage('job_review',{id:job,position:1})).rejects.toThrow(/outro dia/);
 await manage('job_remove',{id:job});
 expect((await row('select active from work_day_jobs where id=$1',[job])).active).toBe(false);
 await manage('day_status',{id,status:'cancelada'});
 expect((await row('select count(*)::int n from work_day_members where day_id=$1 and released_at is null',[id])).n).toBe(0);
 await makeDay(3);
});
test('carregamento tem etapas, autor e retorno sem movimentar estoque/financeiro, inclusive após cancelamento',async()=>{
 const id=await makeDay(4),e=await event(4),job=await manage('job',{day_id:id,source:'operational_events',source_id:e,position:1});
 const item=await manage('load_add',{job_id:job,description:'Escada',kind:'ferramenta',quantity:2,unit:'un'},worker);
 const counts=()=>row('select (select count(*) from stock_movements)::int stock,(select count(*) from financial_entries)::int financial');const before=await counts();
 await expect(manage('load_state',{id:item,state:'carregado',expected_state:'pendente'},driver)).rejects.toThrow(/Etapa/);
 await manage('load_state',{id:item,state:'separado',expected_state:'pendente'},worker);
 await manage('load_state',{id:item,state:'carregado',expected_state:'separado'},driver);
 await manage('load_state',{id:item,state:'carregado',expected_state:'separado'},driver);
 expect((await row('select count(*)::int n from work_load_events where item_id=$1',[item])).n).toBe(2);
 await db.query("update operational_events set status='cancelado' where id=$1",[e]);
 await manage('day_status',{id,status:'cancelada'});
 await expect(manage('load_state',{id:item,state:'retorno_conferido',expected_state:'carregado',returned_quantity:1},driver)).rejects.toThrow(/motivo/);
 await manage('load_state',{id:item,state:'retorno_conferido',expected_state:'carregado',returned_quantity:1,notes:'Uma escada ficou na obra'},driver);
 expect((await row('select returned_quantity::int q from work_load_items where id=$1',[item])).q).toBe(1);
 expect(await counts()).toEqual(before);
});
test('RLS por empresa e alocação; operadores não planejam nem gravam diretamente',async()=>{
 const id=await makeDay(5,team,car,[driver]);
 expect((await as(driver,()=>row('select count(*)::int n from work_days where id=$1',[id]))).n).toBe(1);
 expect((await as(outsider,()=>row('select count(*)::int n from work_days where id=$1',[id]))).n).toBe(0);
 expect((await as(bossB,()=>row('select count(*)::int n from work_days where company_id=$1',[c]))).n).toBe(0);
 await expect(manage('team',{name:'Não autorizado',leader_id:driver},driver)).rejects.toThrow(/permissão/);
 await expect(as(driver,()=>db.query("insert into work_teams(company_id,name,leader_id) values($1,'Direto',$2)",[c,driver]))).rejects.toThrow(/permission denied/);
 await expect(manage('crew',{id,driver_id:bossB,members:[bossB]})).rejects.toThrow(/inválido/);
 await expect(as(outsider,()=>row('select work_job_options(current_date)'))).rejects.toThrow(/permissão/);
});

test('membro removido mantém leitura histórica, mas perde conferência; inativação exige revisão',async()=>{
 const id=await makeDay(6,team,car,[driver,outsider]),e=await event(6);
 const job=await manage('job',{day_id:id,source:'operational_events',source_id:e,position:1});
 const item=await manage('load_add',{job_id:job,description:'Vidro',kind:'item',quantity:1,unit:'un'});
 await manage('crew',{id,driver_id:driver,members:[driver]});
 expect((await as(outsider,()=>row('select count(*)::int n from work_days where id=$1',[id]))).n).toBe(1);
 await expect(manage('load_state',{id:item,state:'separado',expected_state:'pendente'},outsider)).rejects.toThrow(/permissão/);
 await manage('day_status',{id,status:'em_andamento'});
 await db.query("update profiles set status='inativo' where id=$1",[driver]);
 expect((await row('select crew_review_required from work_days where id=$1',[id])).crew_review_required).toBe(true);
 await expect(manage('load_state',{id:item,state:'separado',expected_state:'pendente'},worker)).rejects.toThrow(/revisão/);
 await manage('crew',{id,driver_id:boss,members:[boss]});
 await manage('load_state',{id:item,state:'separado',expected_state:'pendente'},worker);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[boss]);
 await db.query("update profiles set status='ativo' where id=$1",[driver]);
});

test('instalação e evento espelhado são uma só visita; importação preserva quantidade/unidade e é idempotente',async()=>{
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[boss]);
 const client=(await row("insert into clients(company_id,name) values($1,'Cliente da instalação') returning id",[c])).id;
 const type=(await row('select id from sale_types where company_id=$1 limit 1',[c])).id;
 const sale=(await row("insert into sales(company_id,sale_number,client_id,sale_type_id,total) values($1,'VEN-EQUIPE',$2,$3,100) returning id",[c,client,type])).id;
 const order=(await row("insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,'PED-EQUIPE',$2,$3,$4) returning id",[c,sale,client,type])).id;
 await db.query("insert into order_items(company_id,order_id,product,quantity,unit) values($1,$2,'Calha',6.5,'m')",[c,order]);
 const install=(await row("insert into installations(company_id,order_id,scheduled_at,address) values($1,$2,(current_date+7)::timestamp at time zone 'America/Sao_Paulo','Rua A') returning id",[c,order])).id;
 const e=(await row("insert into operational_events(company_id,event_type,title,starts_at,installation_id,order_id) values($1,'instalacao','Espelho',(current_date+7)::timestamp at time zone 'America/Sao_Paulo',$2,$3) returning id",[c,install,order])).id;
 const day=await makeDay(7),job=await manage('job',{day_id:day,source:'operational_events',source_id:e,position:1});
 expect((await row('select installation_id,event_id from work_day_jobs where id=$1',[job]))).toMatchObject({installation_id:install,event_id:null});
 await expect(manage('job',{day_id:day,source:'installations',source_id:install,position:2})).rejects.toThrow(/unique|duplicate/);
 await manage('load_order',{job_id:job});await manage('load_order',{job_id:job});
 const items=(await db.query('select description,quantity::float,unit from work_load_items where job_id=$1',[job])).rows;
 expect(items).toEqual([{description:'Calha',quantity:6.5,unit:'m'}]);
 const measurement=(await row("insert into measurements(company_id,client_id,scheduled_at,address) values($1,$2,(current_date+7)::timestamp at time zone 'America/Sao_Paulo','Rua B') returning id",[c,client])).id;
 const options=(await as(boss,()=>row('select work_job_options(current_date+7) j'))).j;
 expect(options.filter((o:any)=>o.id===install)).toHaveLength(1);expect(options.some((o:any)=>o.id===measurement)).toBe(true);
 const mjob=await manage('job',{day_id:day,source:'measurements',source_id:measurement,position:2});
 await db.query("update measurements set address='Rua C' where id=$1",[measurement]);
 expect((await row('select needs_review from work_day_jobs where id=$1',[mjob])).needs_review).toBe(true);
});

test('permissão do módulo revogada bloqueia leitura e RPC do operador',async()=>{
 await db.exec("update permissions set can_view=false where role='estoque' and resource='work_planning'");
 expect((await as(worker,()=>row('select count(*)::int n from work_days'))).n).toBe(0);
 await expect(manage('load_add',{job_id:team,description:'Bloqueado',quantity:1},worker)).rejects.toThrow(/permissão/);
});

