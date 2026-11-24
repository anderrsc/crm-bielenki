import {createHash} from 'node:crypto';

export type TrackingErrorCode='credentials'|'permission'|'unavailable'|'invalid_response'|'rate_limit'|'configuration';
export const TRACKING_ERRORS:Record<TrackingErrorCode,string>={
 credentials:'Conta ou senha não aceita pelo TrackCEO. Confira os dados.',
 permission:'O TrackCEO não autorizou a consulta. Confirme a liberação da API com o fornecedor.',
 unavailable:'O TrackCEO não respondeu. As últimas posições foram preservadas; tente novamente.',
 invalid_response:'O TrackCEO devolveu dados incompletos. As últimas posições foram preservadas.',
 rate_limit:'Aguarde 30 segundos antes de consultar novamente.',
 configuration:'Não foi possível abrir a conexão protegida. Avise o administrador.',
};
export class TrackingError extends Error{
 constructor(public code:TrackingErrorCode,public expired=false,diagnostic?:{providerCode:number;stage:TrackingStage}){
  super(TRACKING_ERRORS[code]);this.name='TrackingError';
  // Somente código numérico e rótulos locais; nunca a mensagem ou URL do fornecedor.
  if(diagnostic&&Number.isInteger(diagnostic.providerCode)&&diagnostic.providerCode>=10000&&diagnostic.providerCode<=99999&&Object.hasOwn(TRACKING_STAGES,diagnostic.stage)){
   const reason=PERMISSION_REASONS[diagnostic.providerCode]??TRACKING_ERRORS[code];
   this.message=`TrackCEO ${diagnostic.providerCode} · ${TRACKING_STAGES[diagnostic.stage]}: ${reason}`;
  }
 }
}
const TRACKING_STAGES={authorization:'autenticação',devices:'lista de rastreadores',positions:'localização'};
type TrackingStage=keyof typeof TRACKING_STAGES;
const PERMISSION_REASONS:Record<number,string>={
 10007:'Permissão negada pelo TrackCEO. Esta resposta não informa se a restrição é da API ou da conta.',
 10013:'Um rastreador não está autorizado para esta conta no TrackCEO.',
 10016:'A conta está bloqueada no TrackCEO.',
 20089:'Um rastreador está bloqueado no TrackCEO.',
};
export type TrackingDevice={imei:string;name:string;model:string|null;plate:string|null;latitude:number|null;longitude:number|null;gps_at:string|null;heartbeat_at:string|null;speed:number|null;ignition:number|null;provider_status:number|null};
export type StoredTrackceo={account:string;password_encrypted:string;token_encrypted:string|null;token_expires_at:string|null;lease_id:string;active:boolean};
type ProviderRecord=Record<string,unknown>;
const object=(v:unknown):v is ProviderRecord=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const md5=(s:string)=>createHash('md5').update(s,'utf8').digest('hex');
export const trackceoSignature=(password:string,time:number)=>md5(md5(password)+time);
const text=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
const finite=(v:unknown,min:number,max:number)=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?n:null;};
const stamp=(v:unknown,now:number)=>{const n=finite(v,1,Math.floor(now/1000)+300);return n===null?null:new Date(n*1000).toISOString();};

export function normalizeDevices(value:unknown):TrackingDevice[]{
 if(!Array.isArray(value)||value.length>500)throw new TrackingError('invalid_response');
 const seen=new Set<string>();
 return value.map(row=>{
  if(!object(row)||typeof row.imei!=='string'||!/^\d{10,20}$/.test(row.imei)||seen.has(row.imei))throw new TrackingError('invalid_response');
  seen.add(row.imei);
  return {imei:row.imei,name:text(row.devicename,160)||`Rastreador ${row.imei.slice(-4)}`,model:text(row.devicetype,80)||null,plate:text(row.platenumber,15)||null,
   latitude:null,longitude:null,gps_at:null,heartbeat_at:null,speed:null,ignition:null,provider_status:null};
 });
}
export function addPositions(devices:TrackingDevice[],value:unknown,now=Date.now()):TrackingDevice[]{
 if(!Array.isArray(value))throw new TrackingError('invalid_response');
 const allowed=new Set(devices.map(d=>d.imei));const positions=new Map<string,ProviderRecord>();
 for(const row of value){
  if(!object(row)||typeof row.imei!=='string'||!allowed.has(row.imei)||positions.has(row.imei))throw new TrackingError('invalid_response');
  positions.set(row.imei,row);
 }
 return devices.map(d=>{
  const p=positions.get(d.imei);if(!p)return d;
  const latitude=finite(p.latitude,-90,90),longitude=finite(p.longitude,-180,180),gps=stamp(p.gpstime,now);
  const valid=latitude!==null&&longitude!==null&&gps!==null;
  const ignition=finite(p.accstatus,-1,1),status=finite(p.datastatus,1,5);
  return {...d,latitude:valid?latitude:null,longitude:valid?longitude:null,gps_at:valid?gps:null,heartbeat_at:stamp(p.hearttime,now),
   speed:valid?finite(p.speed,0,400):null,ignition:ignition!==null&&Number.isInteger(ignition)?ignition:null,provider_status:status!==null&&Number.isInteger(status)?status:null};
 });
}
// O único desvio é o servidor fictício isolado da suíte E2E, nunca uma URL informada por usuário.
function apiOrigin(){
 return process.env.CRM_E2E_TEST_MODE==='1'&&process.env.NEXT_PUBLIC_SUPABASE_URL==='http://localhost:54321'
  &&process.env.TRACKCEO_TEST_API_ORIGIN==='http://127.0.0.1:54323'?'http://127.0.0.1:54323':'https://api.trackceo.com';
}
const PATHS=new Set(['/api/authorization','/api/device/list','/api/track']);
async function jsonLimited(response:Response){
 if(!response.ok)throw new TrackingError('unavailable',response.status===401);
 const reader=response.body?.getReader();if(!reader)throw new TrackingError('invalid_response');
 const parts:Uint8Array[]=[];let size=0;
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>1024*1024){await reader.cancel();throw new TrackingError('invalid_response');}parts.push(r.value);}}
 finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;}catch{throw new TrackingError('invalid_response');}
}
export function createTrackceoClient({account,password,token:cachedToken,expiresAt,fetchImpl=fetch,now=Date.now}:{account:string;password:string;token?:string|null;expiresAt?:string|null;fetchImpl?:typeof fetch;now?:()=>number}){
 let token=cachedToken??'',expiry=expiresAt??'',authenticated=false;
 async function request(path:string,params:Record<string,string>){
  if(!PATHS.has(path))throw new TrackingError('permission');
  const url=new URL(path,apiOrigin());for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  let body:unknown;
  try{body=await jsonLimited(await fetchImpl(url,{method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(6000),headers:{Accept:'application/json'}}));}
  catch(e){if(e instanceof TrackingError)throw e;throw new TrackingError('unavailable');}
  if(!object(body)||typeof body.code!=='number')throw new TrackingError('invalid_response');
  if(body.code!==0){
   const stage:TrackingStage=path==='/api/authorization'?'authorization':path==='/api/device/list'?'devices':'positions';
   const diagnostic={providerCode:body.code,stage};
   if([10002,10003,10010,10011,10012].includes(body.code))throw new TrackingError('credentials',true,diagnostic);
   throw new TrackingError(body.code===20001?'credentials':[10007,10013,10016,20089].includes(body.code)?'permission':body.code===10009?'rate_limit':'unavailable',false,diagnostic);
  }
  return body.record;
 }
 async function authenticate(){
  authenticated=true;const time=Math.floor(now()/1000);
  const r=await request('/api/authorization',{account,time:String(time),signature:trackceoSignature(password,time)});
  if(!object(r)||typeof r.access_token!=='string'||!r.access_token||r.access_token.length>4096)throw new TrackingError('invalid_response');
  const seconds=finite(r.expires_in,60,86400);if(seconds===null)throw new TrackingError('invalid_response');
  token=r.access_token;expiry=new Date(now()+seconds*1000).toISOString();
 }
 async function call(path:string,params:Record<string,string>){
  if(!token||!Number.isFinite(Date.parse(expiry))||Date.parse(expiry)<=now()+60000)await authenticate();
  try{return await request(path,{...params,access_token:token});}
  catch(e){if(e instanceof TrackingError&&e.expired&&!authenticated){await authenticate();return request(path,{...params,access_token:token});}throw e;}
 }
 return {async sync(){
  const devices=normalizeDevices(await call('/api/device/list',{account}));const rows:unknown[]=[];
  for(let i=0;i<devices.length;i+=100){const result=await call('/api/track',{imeis:devices.slice(i,i+100).map(d=>d.imei).join(',')});if(!Array.isArray(result))throw new TrackingError('invalid_response');rows.push(...result);}
  return {devices:addPositions(devices,rows,now()),token,expiresAt:expiry};
 }};
}
