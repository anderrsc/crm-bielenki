import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { operationsDb } from '@/lib/operations';

async function context() {
  const userDb = await createClient();
  const { data: { user } } = await userDb.auth.getUser();
  if (!user) return null;
  const { data: p } = await userDb.from('profiles').select('company_id,status').eq('id',user.id).single();
  if (!p || p.status !== 'ativo') return null;
  return { db: operationsDb(), user, companyId: p.company_id };
}
export async function GET() {
  const c = await context();
  if (!c) return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 });
  const [{ data: notices, error }, { data: cfg }] = await Promise.all([
    c.db.from('notifications').select('id,title,body,link,read_at,created_at').eq('profile_id',c.user.id).eq('company_id',c.companyId).order('created_at',{ascending:false}).limit(30),
    c.db.from('crm_operations_config').select('vapid_public').eq('id',true).single(),
  ]);
  if (error) return NextResponse.json({ error: 'Não foi possível carregar os avisos' }, { status: 500 });
  return NextResponse.json({ notices, publicKey: cfg?.vapid_public ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}
const subSchema = z.object({ endpoint:z.url().max(2048), keys:z.object({auth:z.string().min(16).max(100),p256dh:z.string().min(80).max(200)}) });
export async function POST(req: NextRequest) {
  const c=await context();
  if(!c) return NextResponse.json({error:'Sessão expirada'},{status:401});
  const input=await req.json().catch(()=>null);
  if(input?.readId && z.uuid().safeParse(input.readId).success) {
    const {error}=await c.db.from('notifications').update({read_at:new Date().toISOString()}).eq('id',input.readId).eq('profile_id',c.user.id).eq('company_id',c.companyId);
    return NextResponse.json(error?{error:'Falha ao marcar aviso'}:{ok:true},{status:error?500:200});
  }
  const parsed=subSchema.safeParse(input?.subscription);
  if(!parsed.success) return NextResponse.json({error:'Inscrição inválida'},{status:400});
  const url=new URL(parsed.data.endpoint);
  // Push endpoints are outbound destinations; reject arbitrary URLs/SSRF.
  if(url.protocol!=='https:' || url.port || url.username || url.password || !(
    url.hostname==='fcm.googleapis.com' || url.hostname==='updates.push.services.mozilla.com' || url.hostname==='web.push.apple.com' || url.hostname.endsWith('.notify.windows.com')
  )) return NextResponse.json({error:'Provedor de notificações inválido'},{status:400});
  const {data: existing}=await c.db.from('push_subscriptions').select('profile_id').eq('endpoint',parsed.data.endpoint).maybeSingle();
  if(existing && existing.profile_id!==c.user.id) return NextResponse.json({error:'Este dispositivo pertence a outra sessão. Remova a inscrição anterior.'},{status:409});
  const {error}=await c.db.from('push_subscriptions').upsert({company_id:c.companyId,profile_id:c.user.id,endpoint:parsed.data.endpoint,subscription:parsed.data},{onConflict:'endpoint'});
  return NextResponse.json(error?{error:'Não foi possível ativar os alertas'}:{ok:true},{status:error?500:200});
}
