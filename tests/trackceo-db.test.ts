import {beforeAll,afterAll,test,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase} from './helpers/database';
import {readFileSync} from 'node:fs';
let db:PGlite,c:string,other:string,deviceId:string,vehicleId:string;
const boss='00000000-0000-4000-8000-00000000c001',worker='00000000-0000-4000-8000-00000000c002',bossB='00000000-0000-4000-8000-00000000c003';
const imei='860000000000001',position={imei,name:'Van teste',model:'TEST',plate:'ABC1D23',latitude:-26.4,longitude:-49.1,gps_at:'2026-11-24T15:00:00Z',heartbeat_at:'2026-11-24T15:00:00Z',speed:30,ignition:1,provider_status:2};
async function row(sql:string,args:unknown[]=[]){return (await db.query<Record<string,any>>(sql,args)).rows[0];}
async function as<T>(user:string,role:'authenticated'|'service_role',fn:()=>Promise<T>){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec(`set role ${role}`);try{return await fn();}finally{await db.exec('reset role');}}
const auth=<T>(fn:()=>Promise<T>,user=boss)=>as(user,'authenticated',fn);
const server=(action:string,p:Record<string,unknown>={})=>as(boss,'service_role',async()=>(await row('select trackceo_server($1,$2,$3::jsonb) data',[c,action,JSON.stringify({actor_id:boss,...p})])).data);
async function begin(connect=false){await db.query("update crm_private.trackceo_connections set last_attempt_at=now()-interval '1 minute' where company_id=$1",[c]);return server('begin',{connect});}
async function finish(lease:string,connect=false,devices=[position]){return server('finish',{lease_id:lease,connect,account:'conta-teste',password_encrypted:'enc:senha-ficticia',token_encrypted:'enc:token-ficticio',token_expires_at:'2027-01-01T00:00:00Z',devices});}
beforeAll(async()=>{
 db=await createTestDatabase();await db.query("insert into auth.users(id,email) values($1,'gpsboss@t.invalid'),($2,'gpsworker@t.invalid'),($3,'gpsother@t.invalid')",[boss,worker,bossB]);
 c=(await row("select bootstrap_company('GPS A',null,$1) id",[boss])).id;other=(await row("select bootstrap_company('GPS B',null,$1) id",[bossB])).id;
 await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Instalador')",[worker,c]);await db.query("insert into user_roles(company_id,profile_id,role) values($1,$2,'instalador')",[c,worker]);
 await db.exec('grant usage on schema auth to authenticated;grant select on profiles,user_roles,permissions to authenticated;grant select,insert,update on integrations to authenticated');
});
afterAll(async()=>{await db?.close();});
test('segredos privados e RPC do servidor são inacessíveis até à gerência autenticada',async()=>{
 const status=(await auth(()=>row('select trackceo_status() data'))).data;expect(status).toMatchObject({active:false,configured:false,company_id:c});
 await expect(auth(()=>row("select trackceo_server($1,'begin',$2::jsonb)",[c,JSON.stringify({actor_id:boss,connect:true})]))).rejects.toThrow(/permission denied/);
 await expect(auth(()=>row('select * from crm_private.trackceo_connections'))).rejects.toThrow(/permission denied/);
 await expect(auth(()=>row('select trackceo_status()'),worker)).rejects.toThrow(/permissão/);
});
test('conectar cadastra o provedor, não duplica veículo nem expõe senha/token no status ou auditoria',async()=>{
 const lease=await begin(true);await finish(lease.lease_id,true);
 deviceId=(await row('select id from trackceo_devices where imei=$1',[imei])).id;
 const status=(await auth(()=>row('select trackceo_status() data'))).data;
 expect(status).toMatchObject({active:true,configured:true,account:'conta-teste'});expect(JSON.stringify(status)).not.toMatch(/enc:|senha-ficticia|token-ficticio/);
 expect((await auth(()=>row("select count(*)::int n from integrations where provider='trackceo'"))).n).toBe(0);
 await expect(auth(()=>db.query("insert into integrations(company_id,provider,name) values($1,'trackceo','Forjado')",[c]))).rejects.toThrow(/row-level security/);
 const logs=(await db.query("select old_data,new_data from audit_logs where action like 'TRACKCEO_%'")).rows;expect(JSON.stringify(logs)).not.toMatch(/enc:|senha-ficticia|token-ficticio/);
});
test('RLS isola empresa e cargo; gravação direta dos dispositivos é negada',async()=>{
 expect((await auth(()=>row('select count(*)::int n from trackceo_devices'))).n).toBe(1);
 expect((await auth(()=>row('select count(*)::int n from trackceo_devices'),worker)).n).toBe(0);
 expect((await auth(()=>row('select count(*)::int n from trackceo_devices'),bossB)).n).toBe(0);
 await expect(auth(()=>db.query('update trackceo_devices set vehicle_id=null where id=$1',[deviceId]))).rejects.toThrow(/permission denied/);
 const otherCar=(await row("insert into work_vehicles(company_id,name) values($1,'Outro carro') returning id",[other])).id;
 await expect(auth(()=>row('select trackceo_link($1,$2,false)',[deviceId,otherCar]))).rejects.toThrow(/inválido/);
 await expect(auth(()=>row('select trackceo_link($1,null,true)',[deviceId]),worker)).rejects.toThrow(/permissão/);
});
test('cadastro e vínculo usam a frota existente; outra pessoa não ocupa o mesmo veículo',async()=>{
 vehicleId=(await auth(()=>row('select trackceo_link($1,null,true) id',[deviceId]))).id;
 expect((await row('select name,plate from work_vehicles where id=$1',[vehicleId]))).toEqual({name:'Van teste',plate:'ABC1D23'});
 expect((await auth(()=>row('select trackceo_link($1,null,true) id',[deviceId]))).id).toBe(vehicleId);
 const lease=await begin();await finish(lease.lease_id,false,[position,{...position,imei:'860000000000002',name:'Outro rastreador'}]);
 const second=(await row("select id from trackceo_devices where imei='860000000000002'")).id;
 await expect(auth(()=>row('select trackceo_link($1,$2,false)',[second,vehicleId]))).rejects.toThrow(/já vinculado/);
 await db.query('update trackceo_devices set plate=null where id=$1',[second]);
 const created=(await auth(()=>row('select trackceo_link($1,null,true) id',[second]))).id;
 expect((await auth(()=>row('select trackceo_link($1,null,true) id',[second]))).id).toBe(created);
});
test('lease serializa sincronizações; erro e GPS atrasado preservam a posição e o vínculo',async()=>{
 const lease=await begin();expect(await server('begin',{})).toMatchObject({busy:true});
 await finish(lease.lease_id,false,[{...position,latitude:-20,gps_at:'2026-11-23T15:00:00Z'}]);
 expect((await row('select latitude,vehicle_id from trackceo_devices where id=$1',[deviceId]))).toEqual({latitude:-26.4,vehicle_id:vehicleId});
 const retry=await begin();await server('fail',{lease_id:retry.lease_id,error:'unavailable'});
 expect((await row('select latitude from trackceo_devices where id=$1',[deviceId])).latitude).toBe(-26.4);
 expect((await auth(()=>row('select trackceo_status() data'))).data.last_error).toBe('unavailable');
});
test('troca de conta oculta rastreadores antigos; desconectar invalida sincronização em voo sem apagar dados',async()=>{
 const lease=await begin(true);await finish(lease.lease_id,true,[]);
 expect((await auth(()=>row('select count(*)::int n from trackceo_devices'))).n).toBe(0);
 expect((await row('select count(*)::int n from trackceo_devices')).n).toBe(2);
 const current=await begin();await auth(()=>row('select trackceo_disconnect()'));
 await expect(finish(current.lease_id,false)).rejects.toThrow(/conexão mudou/);
 expect((await row('select count(*)::int n from work_vehicles where id=$1',[vehicleId])).n).toBe(1);
 expect((await auth(()=>row('select trackceo_status() data'))).data.active).toBe(false);
 await expect(server('begin',{})).rejects.toThrow(/Conecte/);
});
test('migração pode ser reaplicada sem apagar frota, rastreadores ou auditoria',async()=>{
 const before=await row('select (select count(*) from trackceo_devices)::int devices,(select count(*) from work_vehicles)::int vehicles,(select count(*) from audit_logs)::int logs');
 await db.exec(readFileSync('supabase/migrations/20261124162014_trackceo_localizacao_veiculos.sql','utf8'));
 expect(await row('select (select count(*) from trackceo_devices)::int devices,(select count(*) from work_vehicles)::int vehicles,(select count(*) from audit_logs)::int logs')).toEqual(before);
});
