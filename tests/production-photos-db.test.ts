import { beforeAll,afterAll,test,expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './helpers/database';
let db:PGlite,company:string,production:string,photo:string,path:string;
const boss='00000000-0000-4000-8000-000000000fa1',worker='00000000-0000-4000-8000-000000000fa2',denied='00000000-0000-4000-8000-000000000fa3';
async function row(sql:string,args:unknown[]=[]){return (await db.query<Record<string,any>>(sql,args)).rows[0];}
async function as<T>(user:string,fn:()=>Promise<T>){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
beforeAll(async()=>{
  db=await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'photosboss@test.invalid'),($2,'photosworker@test.invalid'),($3,'photosdenied@test.invalid')",[boss,worker,denied]);
  company=(await row("select bootstrap_company('Fotos',null,$1) id",[boss])).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$3,'Produção'),($2,$3,'Sem acesso')",[worker,denied,company]);
  await db.query("insert into user_roles(company_id,profile_id,role) values($1,$2,'producao')",[company,worker]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[boss]);
  const client=(await row("insert into clients(company_id,name) values($1,'Cliente') returning id",[company])).id;
  const type=(await row('select id from sale_types where company_id=$1 limit 1',[company])).id;
  const sale=(await row("insert into sales(company_id,sale_number,client_id,sale_type_id,total) values($1,'VEN-PHOTO',$2,$3,100) returning id",[company,client,type])).id;
  const order=(await row("insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,'PED-PHOTO',$2,$3,$4) returning id",[company,sale,client,type])).id;
  production=(await row('select id from production_orders where order_id=$1',[order])).id;
  path=`${company}/production/${production}/step-1/photo.jpg`;
  await db.exec('grant usage on schema auth,storage to authenticated; grant select on profiles,production_orders,production_step_logs,quotes,orders,sales,sale_types to authenticated; grant select,insert on storage.objects to authenticated');
});
afterAll(async()=>{await db?.close();});
test('bucket privado e upload pela produção sem permissão em serviços',async()=>{
  expect((await row("select public from storage.buckets where id='production-photos'")).public).toBe(false);
  await as(worker,()=>db.query("insert into storage.objects(bucket_id,name) values('production-photos',$1)",[path]));
  // Antes de vincular o arquivo, ele não é visível nem por URL assinada.
  expect((await as(worker,()=>row('select count(*)::int n from storage.objects where name=$1',[path]))).n).toBe(0);
  photo=(await as(worker,()=>row('select add_production_step_photo($1,1,$2,null) id',[production,path]))).id;
  expect((await as(worker,()=>row('select count(*)::int n from storage.objects where name=$1',[path]))).n).toBe(1);
  expect((await as(worker,()=>row('select count(*)::int n from v_production_step_photos where id=$1',[photo]))).n).toBe(1);
});
test('RPC e storage barram usuário sem acesso, outra empresa, etapa futura e arquivo inexistente',async()=>{
  await expect(as(denied,()=>row('select add_production_step_photo($1,1,$2,null)',[production,path]))).rejects.toThrow();
  expect((await as(denied,()=>row('select count(*)::int n from production_step_photos'))).n).toBe(0);
  await expect(as(worker,()=>db.query("insert into storage.objects(bucket_id,name) values('production-photos',$1)",[`00000000-0000-4000-8000-000000000fff/production/${production}/step-1/x.jpg`]))).rejects.toThrow();
  await expect(as(worker,()=>row('select add_production_step_photo($1,7,$2,null)',[production,path]))).rejects.toThrow(/Etapa/);
  await expect(as(worker,()=>row('select add_production_step_photo($1,1,$2,null)',[production,path.replace('photo.jpg','missing.jpg')]))).rejects.toThrow(/Arquivo/);
  await expect(as(worker,()=>db.query("insert into production_step_photos(company_id,production_order_id,step_number,photo_url) values($1,$2,1,$3)",[company,production,path]))).rejects.toThrow(/permission denied/);
});
test('arquivar oculta da galeria e preserva linha e arquivo; apagar diretamente é bloqueado',async()=>{
  await expect(as(worker,()=>db.query('delete from production_step_photos where id=$1',[photo]))).rejects.toThrow(/permission denied/);
  await as(worker,()=>db.query('update production_step_photos set deleted_at=now() where id=$1',[photo]));
  expect((await as(worker,()=>row('select count(*)::int n from v_production_step_photos where id=$1',[photo]))).n).toBe(0);
  expect((await row('select deleted_at is not null archived from production_step_photos where id=$1',[photo])).archived).toBe(true);
  expect((await row('select count(*)::int n from storage.objects where name=$1',[path])).n).toBe(1);
});
