import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase} from './helpers/database';
let db:PGlite,c:string,other:string,client:string,team:string,vehicle:string,day:string,date:string;
const boss='00000000-0000-4000-8000-00000000d101',driver='00000000-0000-4000-8000-00000000d102',bossB='00000000-0000-4000-8000-00000000d103';
async function row(sql:string,args:unknown[]=[]){return (await db.query<Record<string,any>>(sql,args)).rows[0];}
async function as<T>(user:string,fn:()=>Promise<T>){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
const rpc=(name:string,args:unknown[],user=boss)=>as(user,async()=>row(`select ${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) value`,args).then(r=>r.value));
const manage=(action:string,p:unknown)=>rpc('work_manage',[action,JSON.stringify(p)]);
const payload=(minutes:number|null=120)=>({client_id:client,discount:0,freight:0,installation_duration_minutes:minutes,items:[{product:'Janela',measurements:'1200 x 1000',quantity:1,unit_price:100,meters:1,thickness:'0.5',cut:'200'}]});
async function installation(n:number,hour:number,minutes=120){
 const quote=await rpc('create_window_quote',[JSON.stringify(payload(minutes))]);
 const st=(await row('select sale_type_id from quotes where id=$1',[quote])).sale_type_id;
 const sale=(await row("insert into sales(company_id,sale_number,client_id,sale_type_id,seller_id) values($1,$2,$3,$4,$5) returning id",[c,`DUR-${n}`,client,st,boss])).id;
 await db.query("update quotes set sale_id=$1,status='aprovado' where id=$2",[sale,quote]);
 const order=(await row('insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,$2,$3,$4,$5) returning id',[c,`DUR-${n}`,sale,client,st])).id;
 const id=(await row("insert into installations(company_id,order_id,scheduled_at,status,address) values($1,$2,($3::date+($4::int*interval '1 hour')) at time zone 'America/Sao_Paulo','agendada','Rua teste') returning id",[c,order,date,hour])).id;
 const starts=(await row('select scheduled_at::text v from installations where id=$1',[id])).v;
 return {id,quote,starts};
}
const apply=(install:{id:string;starts:string},minutes=120,dayId=day)=>rpc('work_apply_suggestions',[date,JSON.stringify([{day_id:dayId,source:'installations',source_id:install.id,starts_at:install.starts,duration_minutes:minutes}])]);
beforeAll(async()=>{
 db=await createTestDatabase();await db.query("insert into auth.users(id,email) values($1,'dur-manager@test.invalid'),($2,'dur-driver@test.invalid'),($3,'dur-other@test.invalid')",[boss,driver,bossB]);
 c=(await row("select bootstrap_company('Duração',null,$1) id",[boss])).id;other=(await row("select bootstrap_company('Outra',null,$1) id",[bossB])).id;
 await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Instalador')",[driver,c]);await db.query("insert into user_roles(company_id,profile_id,role) values($1,$2,'instalador')",[c,driver]);
 await db.exec('grant usage on schema auth to authenticated;grant select on profiles,user_roles,permissions to authenticated;grant select,insert on quote_items to authenticated;grant select,update on quotes to authenticated');
 client=(await row("insert into clients(company_id,name) values($1,'Cliente duração') returning id",[c])).id;
 team=await manage('team',{name:'Duração A',leader_id:driver,active:true});vehicle=await manage('vehicle',{name:'Van',vehicle_type:'Van',status:'disponivel'});
 date=(await row('select (current_date+20)::text d')).d;day=await manage('day',{team_id:team,vehicle_id:vehicle,driver_id:driver,work_date:date,members:[driver]});
});
afterAll(async()=>{await db?.close();});
test('calhas/esquadrias criam, editam e duplicam duração; ausência não limpa dado existente',async()=>{
 for(const fn of ['create_gutter_quote','create_window_quote']){
  const q=await rpc(fn,[JSON.stringify(payload(90))]);expect((await row('select installation_duration_minutes m from quotes where id=$1',[q])).m).toBe(90);
  const copy=await rpc('duplicate_quote',[q]);expect((await row('select installation_duration_minutes m from quotes where id=$1',[copy])).m).toBe(90);
 }
 const q=await rpc('save_gutter_quote_complete',[JSON.stringify(payload(120))]);const p={...payload()};delete (p as any).installation_duration_minutes;
 await rpc('save_gutter_quote_complete',[JSON.stringify(p),q]);expect((await row('select installation_duration_minutes m from quotes where id=$1',[q])).m).toBe(120);
 await rpc('save_gutter_quote_complete',[JSON.stringify(payload(45)),q]);expect((await row('select installation_duration_minutes m from quotes where id=$1',[q])).m).toBe(45);
 for(const invalid of [0,-1,1.5,14401])await expect(rpc('create_window_quote',[JSON.stringify(payload(invalid))])).rejects.toThrow(/Duração/);
});
test('tempo interno aceita ajuste autorizado e nega instalador e outra empresa',async()=>{
 const q=await rpc('create_window_quote',[JSON.stringify(payload())]);await rpc('set_quote_installation_duration',[q,180]);
 await expect(rpc('set_quote_installation_duration',[q,60],driver)).rejects.toThrow(/permissão|disponível/);
 await expect(rpc('set_quote_installation_duration',[q,60],bossB)).rejects.toThrow(/permissão|disponível/);
 expect((await row('select installation_duration_minutes m from quotes where id=$1',[q])).m).toBe(180);
});
test('sugestões não gravam antes da confirmação e aplicação copia o tempo para a OS',async()=>{
 const i=await installation(1,8);const options=await rpc('work_job_options',[date]);expect(options.find((x:any)=>x.id===i.id)).toMatchObject({duration_minutes:120,allocated:false,event_type:'instalacao'});
 expect((await row('select count(*)::int n from work_day_jobs where day_id=$1',[day])).n).toBe(0);expect(await apply(i)).toBe(1);
 expect((await row('select duration_minutes m from work_day_jobs where installation_id=$1',[i.id])).m).toBe(120);
 await expect(apply(i)).rejects.toThrow(/indisponível/);
 await rpc('set_quote_installation_duration',[i.quote,150]);expect((await row('select needs_review r from work_day_jobs where installation_id=$1',[i.id])).r).toBe(true);
 const j=(await row('select id from work_day_jobs where installation_id=$1',[i.id])).id;await manage('job_review',{id:j,position:1});expect((await row('select duration_minutes m from work_day_jobs where id=$1',[j])).m).toBe(150);
});
test('banco rejeita sobreposição, duração alterada, sobrecarga e confirmação de outro usuário',async()=>{
 const overlap=await installation(2,9);await expect(apply(overlap)).rejects.toThrow(/sobrepostos/);
 const stale=await installation(3,12);await expect(apply(stale,121)).rejects.toThrow(/mudaram/);
 await rpc('work_planning_time',['day_time',JSON.stringify({id:day,work_minutes:180,reserved_minutes:0})]);await expect(apply(stale)).rejects.toThrow(/insuficiente/);
 await expect(rpc('work_apply_suggestions',[date,JSON.stringify([{day_id:day,source:'installations',source_id:stale.id,starts_at:stale.starts,duration_minutes:120}])],driver)).rejects.toThrow(/permissão/);
 await expect(rpc('work_planning_time',['day_time',JSON.stringify({id:day,work_minutes:480,reserved_minutes:0})],bossB)).rejects.toThrow(/Ajuste/);
 await rpc('work_planning_time',['day_time',JSON.stringify({id:day,work_minutes:480,reserved_minutes:30})]);
});
test('lote inválido é atômico e reaplicar migração mantém estimativas e alocações',async()=>{
 const i=await installation(4,14);const count=(await row('select count(*)::int n from work_day_jobs where day_id=$1',[day])).n;
 await expect(rpc('work_apply_suggestions',[date,JSON.stringify([{day_id:day,source:'installations',source_id:i.id,starts_at:i.starts,duration_minutes:120},{day_id:day,source:'installations',source_id:i.id,starts_at:i.starts,duration_minutes:120}])])).rejects.toThrow(/indisponível/);
 expect((await row('select count(*)::int n from work_day_jobs where day_id=$1',[day])).n).toBe(count);
 await db.exec(readFileSync('supabase/migrations/20261124183741_duracao_instalacao_planejamento_diario.sql','utf8'));
 expect((await row('select reserved_minutes r from work_days where id=$1',[day])).r).toBe(30);expect((await row('select installation_duration_minutes m from quotes where id=$1',[i.quote])).m).toBe(120);
});
