import 'server-only';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { whatsappCredentials } from '@/lib/whatsapp/send';
import { evolutionOwnerPhone, evolutionProbe, evolutionRestart, evolutionSetWebhook, evolutionState, evolutionWebhookConfig, webhookConfigProblems } from '@/lib/whatsapp/evolution';
import { BUSY_QUIET_FALLBACK_MINUTES, looksStale, shouldRestart, type ProbeResult } from '@/lib/whatsapp/watchdog';
import { syncRecentEvolutionMessages } from '@/lib/whatsapp/evolution-history';
import { channelCredentials, type WhatsappChannel } from '@/lib/whatsapp/channels';
import { decryptSecret } from '@/lib/encrypt';
import { runLiaFollowups } from '@/lib/lia-followups';

export function operationsDb() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Servidor sem configuração.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function runOperations(db: ReturnType<typeof operationsDb>, cfg: { vapid_public: string; vapid_private: string }) {
  const deadline=Date.now()+42000;
  let reconciled = 0;
  const { data: agents, error } = await db.from('ai_agent_config').select('*').eq('wpp_provider', 'evolution').not('evolution_api_url', 'is', null);
  if (error) throw error;
  // Mesmo servidor + instância consultados uma vez por rodada (o principal aparece nos dois laços).
  const states = new Map<string, Promise<string>>();
  const stateOf = (url: string, key: string, instance: string, onError?: (e: unknown) => void) => {
    const k = `${url}|${instance}`;
    if (!states.has(k)) states.set(k, evolutionState(url, key, instance).catch((e) => { onError?.(e); return 'unreachable'; }));
    return states.get(k)!;
  };
  for (const agent of agents ?? []) {
    const c = whatsappCredentials(agent, { provider: 'evolution' });
    if (!c.evolutionInstance) continue;
    const state = await stateOf(c.evolutionUrl, c.evolutionKey, c.evolutionInstance);
    const { error: healthError } = await db.rpc('record_whatsapp_health', { p_company_id: agent.company_id, p_state: state });
    if (healthError) throw healthError;
  }
  // Reconciliação automática das mensagens recentes de cada número (canal), mesmo com
  // ninguém no Atendimento. Só grava como histórico: não dispara a Lia nem muda atribuição.
  const { data: channels } = await db.from('whatsapp_channels').select('id,company_id,name,provider,instance,phone_number_id,phone_display,api_url,api_key,meta_token,webhook_secret,is_default,active,last_event_at,last_message_event_at,last_restart_at,restart_count')
    .eq('provider', 'evolution').eq('active', true).is('deleted_at', null);
  const byCompany = new Map((agents ?? []).map((a) => [a.company_id as string, a]));
  for (const ch of (channels ?? []) as WhatsappChannel[]) {
    if (Date.now() > deadline - 15000) break;
    const agent = byCompany.get(ch.company_id) ?? (await db.from('ai_agent_config').select('*').eq('company_id', ch.company_id).maybeSingle()).data;
    const c = channelCredentials(agent, ch);
    if (!c.evolutionUrl || !c.evolutionKey || !c.evolutionInstance) continue;
    const state = await stateOf(c.evolutionUrl, c.evolutionKey, c.evolutionInstance, (e) => {
      // Registra falha de conexão no histórico para diagnóstico (B2/R05)
      db.rpc('record_whatsapp_connection_event', {
        p_company_id: ch.company_id, p_channel_id: ch.id, p_provider: 'evolution',
        p_event_type: 'connection_check_failed', p_status: 'error',
        p_error_message: e instanceof Error ? e.message.slice(0, 500) : String(e),
      }).then(() => undefined, () => undefined);
    });
    // Registra evento de conexão no histórico sempre que o estado mudar ou for diferente de open
    // (evita duplicação: só grava se o último evento registrado for diferente do estado atual)
    const { data: lastEvent } = await db.from('whatsapp_connection_history')
      .select('event_type').eq('channel_id', ch.id).not('event_type', 'in', '(probe_ok,probe_failed,webhook_ok,webhook_invalid,webhook_check_failed)')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (lastEvent?.event_type !== state) {
      await db.rpc('record_whatsapp_connection_event', {
        p_company_id: ch.company_id, p_channel_id: ch.id, p_provider: 'evolution',
        p_event_type: state, p_status: state,
      }).then(() => undefined, () => undefined);
    }
    await db.from('whatsapp_channels').update({ status: state, updated_at: new Date().toISOString() }).eq('id', ch.id);
    if (state !== 'open') continue;
    // Conexão "zumbi": diz que está conectada, mas nenhum evento de mensagem chega há 20 min no
    // expediente. Reinicia (sem pedir QR); o WhatsApp entrega o que ficou parado e a próxima
    // reconciliação grava no Atendimento.
    const row = ch as WhatsappChannel & { last_event_at?: string | null; last_message_event_at?: string | null; last_restart_at?: string | null; restart_count?: number };
    const watch = { state, lastMessageEventAt: row.last_message_event_at ?? row.last_event_at ?? null, lastRestartAt: row.last_restart_at ?? null, now: new Date() };
    // Silêncio não prova que travou: antes de reiniciar, testa a conexão com o WhatsApp de verdade.
    let probe: ProbeResult | undefined;
    let ownPhone = ch.phone_display;
    if (looksStale(watch) && !ownPhone) {
      // Número do canal ainda não gravado (canal migrado): pergunta à Evolution e guarda.
      ownPhone = await evolutionOwnerPhone(c.evolutionUrl, c.evolutionKey, c.evolutionInstance).catch(() => null);
      if (ownPhone) await db.from('whatsapp_channels').update({ phone_display: ownPhone }).eq('id', ch.id).is('phone_display', null);
    }
    if (looksStale(watch) && ownPhone) {
      probe = await evolutionProbe(c.evolutionUrl, c.evolutionKey, c.evolutionInstance, ownPhone).then((ok) => (ok ? 'ok' : 'failed'), () => 'failed' as const);
      await db.rpc('record_whatsapp_connection_event', {
        p_company_id: ch.company_id, p_channel_id: ch.id, p_provider: 'evolution',
        p_event_type: probe === 'ok' ? 'probe_ok' : 'probe_failed', p_status: state,
      }).then(() => undefined, () => undefined);
    }
    if (shouldRestart({ ...watch, probe, quietFallbackMinutes: ch.is_default ? BUSY_QUIET_FALLBACK_MINUTES : undefined })) {
      try {
        await evolutionRestart(c.evolutionUrl, c.evolutionKey, c.evolutionInstance);
        const at = new Date().toISOString();
        await db.from('whatsapp_channels').update({ last_restart_at: at, restart_count: (row.restart_count ?? 0) + 1 }).eq('id', ch.id);
        const motivo = probe === 'failed' ? 'sem mensagens há 20 min e a conexão não respondeu ao teste' : probe === 'ok' ? `sem nenhum evento há ${ch.is_default ? BUSY_QUIET_FALLBACK_MINUTES + ' min' : '2 h'} (reserva)` : 'sem mensagens há 20 min com a conexão aberta';
        await db.from('audit_logs').insert({ company_id: ch.company_id, table_name: 'whatsapp_channels', record_id: ch.id, action: 'AUTO_RESTART', new_data: { name: ch.name, motivo } });
        await db.rpc('notify_team_service', { p_company_id: ch.company_id, p_event: `wa-restart:${ch.id}:${at.slice(0, 16)}`, p_title: 'WhatsApp reiniciado', p_body: `O número ${ch.name} parou de receber mensagens e a conexão foi reiniciada sozinha. As mensagens paradas entram em seguida.`, p_link: '/atendimento/canais' }).then(() => undefined, () => undefined);
      } catch (e) { console.error('Reiniciar WhatsApp:', ch.id, e instanceof Error ? e.message : e); }
      // Pós-reinício: recupera mensagens que ficaram paradas enquanto o webhook estava falho.
      // Sem isso o cron pula a reconciliação neste ciclo e as mensagens do gap só chegam
      // quando o webhook retoma entrega (que pode não ocorrer para mensagens antigas).
      try {
        const r = await syncRecentEvolutionMessages(db, ch.company_id, c.evolutionUrl, c.evolutionKey, c.evolutionInstance, ch.id, { maxPages: 20 });
        const now = new Date().toISOString();
        await db.from('whatsapp_channels').update({ last_sync_at: now }).eq('id', ch.id);
        if (ch.is_default) await db.from('ai_agent_config').update({ inbox_reconciled_at: now }).eq('company_id', ch.company_id);
        reconciled += r.inserted;
      } catch (e) { console.error('Reconciliação pós-reinício WhatsApp:', ch.id, e instanceof Error ? e.message : e); }
      continue;
    }
    // A cada hora: o webhook da instância ainda aponta para o CRM, ligado e com os eventos certos?
    // Só avisa (não reconfigura sozinho: o segredo do cabeçalho fica no servidor da Evolution).
    try { await checkWebhookConfig(db, ch, c); } catch (e) { console.error('Conferência do webhook:', ch.id, e instanceof Error ? e.message : e); }
    try {
      const r = await syncRecentEvolutionMessages(db, ch.company_id, c.evolutionUrl, c.evolutionKey, c.evolutionInstance, ch.id, { maxPages: 5 });
      const now = new Date().toISOString();
      await db.from('whatsapp_channels').update({ last_sync_at: now }).eq('id', ch.id);
      if (ch.is_default) await db.from('ai_agent_config').update({ inbox_reconciled_at: now }).eq('company_id', ch.company_id);
      reconciled += r.inserted;
    } catch (e) { console.error('Reconciliação WhatsApp:', ch.id, e instanceof Error ? e.message : e); }
  }
  // Uma vez por hora: a trava contra repetidos só precisa dos últimos dias (a Evolution não reenvia depois disso).
  if (new Date().getUTCMinutes() === 30) {
    const { error: cleanupError } = await db.from('whatsapp_webhook_events').delete().lt('received_at', new Date(Date.now() - 30 * 86400_000).toISOString());
    if (cleanupError) console.error('Limpeza de eventos do WhatsApp:', cleanupError.message);
  }
  // Alertas automáticos de desconexão: notifica gerência quando canal fica >30min sem conexão.
  // Falha aqui não pode parar o resto da rotina.
  try { await db.rpc('check_whatsapp_disconnections'); } catch (e) { console.error('Alerta de desconexão WhatsApp:', e instanceof Error ? e.message : e); }
  // Acompanhamento comercial da Lia (24 h sem resposta, até 3 tentativas): só roda onde o dono ligou.
  // Falha aqui não pode parar o resto da rotina.
  try { await runLiaFollowups(db); } catch (e) { console.error('Acompanhamento da Lia:', e instanceof Error ? e.message : e); }
  const { data: reminders, error: reminderError } = await db.rpc('collect_quote_followups');
  if (reminderError) throw reminderError;
  // Cliente sem resposta há mais de 2 h (dentro do horário de atendimento): avisa quem está atribuído.
  // Falha aqui não pode parar o resto da rotina.
  const { error: unansweredError } = await db.rpc('collect_unanswered_conversations');
  if (unansweredError) console.error('Lembrete de conversa sem resposta:', unansweredError.message);
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
  return { checked: agents?.length ?? 0, reconciled, reminders, pushed };
}

const PROCESS_STARTED_AT = Date.now();

async function checkWebhookConfig(db: ReturnType<typeof operationsDb>, ch: WhatsappChannel, c: { evolutionUrl: string; evolutionKey: string; evolutionInstance: string }) {
  const { data: last } = await db.from('whatsapp_connection_history').select('created_at,event_type').eq('channel_id', ch.id)
    .in('event_type', ['webhook_ok', 'webhook_invalid', 'webhook_check_failed']).order('created_at', { ascending: false }).limit(1).maybeSingle();
  // Só pula a verificação se o último resultado foi OK há menos de 1h; se foi inválido ou falhou, tenta de novo.
  // Depois de uma publicação nova (ex.: troca de hospedagem) confere de novo, mesmo com OK recente.
  if (last?.created_at && last.event_type === 'webhook_ok' && Date.now() - Date.parse(last.created_at) < 60 * 60_000 && Date.parse(last.created_at) > PROCESS_STARTED_AT) return;
  let problems: string[];
  try { problems = webhookConfigProblems(await evolutionWebhookConfig(c.evolutionUrl, c.evolutionKey, c.evolutionInstance), process.env.NEXT_PUBLIC_SITE_URL); }
  catch (e) {
    await db.rpc('record_whatsapp_connection_event', { p_company_id: ch.company_id, p_channel_id: ch.id, p_provider: 'evolution', p_event_type: 'webhook_check_failed', p_status: 'error', p_error_message: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
    return;
  }
  if (problems.length) {
    // Tenta corrigir automaticamente se tiver o segredo do canal e a URL do CRM configurada.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const secret = ch.webhook_secret ? decryptSecret(ch.webhook_secret) : null;
    if (siteUrl && secret) {
      try {
        await evolutionSetWebhook(c.evolutionUrl, c.evolutionKey, c.evolutionInstance, `${siteUrl}/api/whatsapp/webhook`, secret);
        // Verifica de novo após a correção.
        const after = webhookConfigProblems(await evolutionWebhookConfig(c.evolutionUrl, c.evolutionKey, c.evolutionInstance), process.env.NEXT_PUBLIC_SITE_URL);
        if (!after.length) {
          await db.rpc('record_whatsapp_connection_event', { p_company_id: ch.company_id, p_channel_id: ch.id, p_provider: 'evolution', p_event_type: 'webhook_ok', p_status: 'ok', p_error_message: null });
          await db.rpc('notify_team_service', { p_company_id: ch.company_id, p_event: `wa-webhook-fixed:${ch.id}:${new Date().toISOString().slice(0, 10)}`, p_title: 'WhatsApp: webhook reconfigurado automaticamente',
            p_body: `O webhook do número ${ch.name} estava com problema (${problems.join('; ')}) e foi reconfigurado. Mensagens em tempo real retomadas.`, p_link: '/atendimento/canais' }).then(() => undefined, () => undefined);
          return;
        }
        problems = after;
      } catch (e) { console.error('Reconfiguração automática do webhook:', ch.id, e instanceof Error ? e.message : e); }
    }
    await db.rpc('record_whatsapp_connection_event', { p_company_id: ch.company_id, p_channel_id: ch.id, p_provider: 'evolution', p_event_type: 'webhook_invalid', p_status: 'error', p_error_message: problems.join('; ') || null });
    await db.rpc('notify_team_service', { p_company_id: ch.company_id, p_event: `wa-webhook:${ch.id}:${new Date().toISOString().slice(0, 10)}`, p_title: 'WhatsApp: configuração do servidor com problema',
      p_body: `O número ${ch.name} pode não estar entregando mensagens na hora (${problems.join('; ')}). As mensagens continuam chegando pela verificação de 1 minuto.`, p_link: '/atendimento/canais' }).then(() => undefined, () => undefined);
  } else {
    await db.rpc('record_whatsapp_connection_event', { p_company_id: ch.company_id, p_channel_id: ch.id, p_provider: 'evolution', p_event_type: 'webhook_ok', p_status: 'ok', p_error_message: null });
  }
}
