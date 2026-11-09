import 'server-only';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { whatsappCredentials } from '@/lib/whatsapp/send';
import { evolutionState } from '@/lib/whatsapp/evolution';

export function operationsDb() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Servidor sem configuração.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function runOperations(db: ReturnType<typeof operationsDb>, cfg: { vapid_public: string; vapid_private: string }) {
  const deadline=Date.now()+42000;
  const { data: agents, error } = await db.from('ai_agent_config').select('*').eq('wpp_provider', 'evolution').not('evolution_api_url', 'is', null);
  if (error) throw error;
  for (const agent of agents ?? []) {
    const c = whatsappCredentials(agent, { provider: 'evolution' });
    if (!c.evolutionInstance) continue;
    const state = await evolutionState(c.evolutionUrl, c.evolutionKey, c.evolutionInstance).catch(() => 'unreachable');
    const { error: healthError } = await db.rpc('record_whatsapp_health', { p_company_id: agent.company_id, p_state: state });
    if (healthError) throw healthError;
  }
  const { data: reminders, error: reminderError } = await db.rpc('collect_quote_followups');
  if (reminderError) throw reminderError;
  // Claim each notification atomically. Failed deliveries are retried next run.
  const { data: notices, error: noticeError } = await db.from('notifications').select('id,company_id,profile_id,title,body,link,created_at')
    .not('event_key', 'is', null).is('push_processed_at', null).or(`push_claimed_at.is.null,push_claimed_at.lt.${new Date(Date.now()-5*60_000).toISOString()}`).order('created_at').limit(20);
  if (noticeError) throw noticeError;
  let pushed = 0;
  for (const n of notices ?? []) {
    if(Date.now()>deadline)break;
    const { data: claimed, error: claimError } = await db.from('notifications').update({ push_claimed_at: new Date().toISOString() })
      .eq('id', n.id).is('push_processed_at', null).or(`push_claimed_at.is.null,push_claimed_at.lt.${new Date(Date.now()-5*60_000).toISOString()}`).select('id');
    if (claimError) throw claimError;
    if (!claimed?.length) continue;
    const { data: subscriptions, error: subError } = await db.from('push_subscriptions').select('id,subscription,profile:profiles!inner(status)')
      .eq('profile_id', n.profile_id).eq('company_id', n.company_id).eq('profile.status', 'ativo');
    let retry = !!subError;
    await Promise.all((subscriptions ?? []).map(async s => {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify({ title: n.title, body: n.body, url: n.link, tag: n.id }), {
          vapidDetails: { subject: 'https://crm-bielenki.vercel.app', publicKey: cfg.vapid_public, privateKey: cfg.vapid_private },
          TTL: 3600, timeout: 5000,
        });
        pushed++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
        else retry = true;
      }
    }));
    await db.from('notifications').update({ push_claimed_at: null, push_processed_at: retry ? null : new Date().toISOString() }).eq('id', n.id);
  }
  await db.from('crm_operations_config').update({ last_run_at: new Date().toISOString(), last_error: null }).eq('id', true);
  return { checked: agents?.length ?? 0, reminders, pushed };
}
