import type {SupabaseClient} from '@supabase/supabase-js';
export async function resolveMessageChannel(db:SupabaseClient,companyId:string,channelId?:string|null):Promise<string|null>{
  if(channelId)return channelId;
  const {data,error}=await db.from('whatsapp_channels').select('id').eq('company_id',companyId).eq('is_default',true).is('deleted_at',null).maybeSingle();
  if(error)throw new Error(`Canal não consultado: ${error.message}`);
  return data?.id??null;
}
/** Nunca deixa uma busca por ID externo alcançar outro número. */
export function scopeMessages<T>(query:T,channelId?:string|null):T{
  const filter=query as {eq(column:string,value:string):unknown;is(column:string,value:null):unknown};
  return (channelId?filter.eq('channel_id',channelId):filter.is('channel_id',null)) as T;
}
/** Tupla sem ambiguidades; a PK existente continua compatível com o código anterior. */
export function webhookEventKey(scope:string,eventId:string){return JSON.stringify([scope,eventId]);}
