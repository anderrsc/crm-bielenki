import {createClient as createAdmin,type SupabaseClient} from '@supabase/supabase-js';
import {decryptSecret,encryptSecret} from '@/lib/encrypt';
import {createTrackceoClient,TrackingError,type StoredTrackceo} from '@/lib/trackceo';

export function trackingBackend(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new TrackingError('configuration');
 return createAdmin(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function syncTracking({companyId,actorId,credentials,backend=trackingBackend()}:{companyId:string;actorId:string;credentials?:{account:string;password:string};backend?:SupabaseClient}){
 const server=async(action:string,payload:Record<string,unknown>)=>{
  const result=await backend.rpc('trackceo_server',{p_company:companyId,p_action:action,p_payload:{...payload,actor_id:actorId}});
  if(result.error)throw new TrackingError('configuration');return result.data;
 };
 const lease=await server('begin',{connect:Boolean(credentials)});
 if(lease?.busy||lease?.throttled)throw new TrackingError('rate_limit');
 const stored=lease as StoredTrackceo;
 try{
  const account=credentials?.account??stored.account;
  const password=credentials?.password??decryptSecret(stored.password_encrypted??'');
  if(!account||!password)throw new TrackingError('configuration');
  const result=await createTrackceoClient({account,password,token:credentials?null:decryptSecret(stored.token_encrypted??''),expiresAt:credentials?null:stored.token_expires_at}).sync();
  await server('finish',{lease_id:stored.lease_id,connect:Boolean(credentials),account,
   ...(credentials?{password_encrypted:encryptSecret(password)}:{}),
   token_encrypted:encryptSecret(result.token),token_expires_at:result.expiresAt,devices:result.devices});
  return {devices:result.devices.length};
 }catch(error){
  const safe=error instanceof TrackingError?error:new TrackingError('unavailable');
  // Nunca registrar a exceção original: ela pode conter a URL com assinatura/token.
  await server('fail',{lease_id:stored.lease_id,error:safe.code}).catch(()=>{});
  throw safe;
 }
}
