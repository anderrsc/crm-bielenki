import type { SupabaseClient } from '@supabase/supabase-js';
import { channelCredentials, defaultChannel } from '@/lib/whatsapp/channels';
import { recordOutbound } from '@/lib/whatsapp/inbox-store';
import { sendWhatsAppText } from '@/lib/whatsapp/send';
import { FOLLOWUP_TEXTS, followUpDecision, type FollowUpDecision } from '@/lib/ai/lia-rules';
import { startOfBrasiliaDay } from '@/lib/ai/lia-mode';

export type FollowUpCandidate = {
  conversation_id: string; channel_id: string | null; phone: string; contact_name: string | null;
  last_inbound_at: string; last_outbound_at: string; opted_out: boolean; attempts: number; last_attempt_at: string | null;
};
export type FollowUpPlan = { candidate: FollowUpCandidate; attempt: number; key: string; text: string };

/** Escolhe quem recebe agora. Puro e testável: respeita expediente, espaçamento, limite do dia e máximo por rodada. */
export function planFollowUps(candidates: FollowUpCandidate[], o: { now: Date; sentToday: number; dailyLimit: number; maxPerRun?: number }): FollowUpPlan[] {
  const plans: FollowUpPlan[] = [];
  let sent = o.sentToday;
  for (const c of candidates) {
    if (plans.length >= (o.maxPerRun ?? 3)) break;
    const decision: FollowUpDecision = followUpDecision({
      now: o.now, attempts: c.attempts, lastOutboundAt: new Date(c.last_outbound_at), lastAttemptAt: c.last_attempt_at ? new Date(c.last_attempt_at) : null,
      lastInboundAt: new Date(c.last_inbound_at), optedOut: c.opted_out, sentToday: sent, dailyLimit: o.dailyLimit,
    });
    if (decision !== 'enviar') continue;
    const attempt = c.attempts + 1;
    const first = (c.contact_name ?? '').trim().split(/\s+/)[0] ?? '';
    // Só usa o nome se parecer um nome (não número, não "Cliente").
    const nome = /^[A-Za-zÀ-ÿ]{2,}$/.test(first) && !/^(cliente|contato|whatsapp)$/i.test(first) ? `, ${first}` : '';
    plans.push({ candidate: c, attempt, key: `followup:${c.conversation_id}:${attempt}:${Math.floor(Date.parse(c.last_inbound_at) / 1000)}`, text: FOLLOWUP_TEXTS[Math.min(attempt - 1, FOLLOWUP_TEXTS.length - 1)](nome) });
    sent += 1;
  }
  return plans;
}

/**
 * Acompanhamento comercial automático (ligado por empresa, desligado por padrão).
 * Só para quem já conversou, no expediente, no máximo 3 tentativas, com limite diário e poucas por rodada
 * (a rotina roda a cada minuto, então os envios saem espaçados e nunca em rajada).
 */
export async function runLiaFollowups(db: SupabaseClient, now = new Date()): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;
  const { data: configs } = await db.from('ai_agent_config').select('*').eq('active', true).eq('lia_followups_enabled', true);
  for (const cfg of configs ?? []) {
    const companyId = cfg.company_id as string;
    const since = startOfBrasiliaDay(now);
    const { count } = await db.from('lia_automation_executions').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('kind', 'followup').eq('status', 'enviada').gte('created_at', since);
    const dailyLimit = Number(cfg.lia_followups_daily_limit ?? 15);
    const { data: candidates, error } = await db.rpc('lia_followup_candidates', { p_company: companyId, p_now: now.toISOString() });
    if (error) { console.error('Acompanhamento da Lia:', error.message); continue; }
    const plans = planFollowUps((candidates ?? []) as FollowUpCandidate[], { now, sentToday: count ?? 0, dailyLimit });
    if (!plans.length) continue;
    const channel = await defaultChannel(db, companyId).catch(() => null);
    const credentials = channelCredentials(cfg, channel);
    const agentName = cfg.agent_name && cfg.agent_name !== 'Ana' ? String(cfg.agent_name) : 'Lia';
    for (const plan of plans) {
      // Reserva única: se outro processo já pegou esta tentativa, não envia de novo.
      const { data: claimed, error: claimError } = await db.from('lia_automation_executions')
        .insert({ company_id: companyId, conversation_id: plan.candidate.conversation_id, kind: 'followup', attempt: plan.attempt, event_key: plan.key, status: 'enviando' }).select('id').maybeSingle();
      if (claimError || !claimed) continue;
      try {
        const externalId = await sendWhatsAppText(credentials, plan.candidate.phone, plan.text);
        await recordOutbound(db, { companyId, conversationId: plan.candidate.conversation_id, body: plan.text, author: 'automacao', senderName: agentName, externalId, deliveryStatus: 'enviada' });
        await db.from('lia_automation_executions').update({ status: 'enviada' }).eq('id', claimed.id);
        sent += 1;
      } catch (e) {
        failed += 1;
        await db.from('lia_automation_executions').update({ status: 'falhou', detail: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).eq('id', claimed.id);
      }
    }
  }
  return { sent, failed };
}
