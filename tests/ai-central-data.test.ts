import { describe, expect, test } from 'vitest';
import { AI_FALLBACK_MARK, loadCentralData } from '@/lib/ai/central-data';

const now = new Date().toISOString();
const rows: Record<string, unknown[]> = {
  ai_agent_config: [{ active: true, agent_name: 'Ana', ai_provider: 'groq', groq_api_key: '', wpp_provider: 'evolution' }],
  companies: [{ whatsapp_phone_number_id: 'PNID' }],
  triage_sessions: [
    { id: '1', nome: 'João', status: 'concluida', tipo_servico: 'esquadrias', updated_at: now, messages: [{ role: 'assistant', content: 'Registrado!' }] },
    { id: '2', phone: '5547999991234', status: 'em_andamento', updated_at: now, messages: [{ role: 'assistant', content: `Em instantes ${AI_FALLBACK_MARK}.` }] },
  ],
  leads: [{ id: 'l1', name: 'João', score: 80, priority: 'alta', created_at: now }],
  outbound_messages: [{ automation_type: 'payment_reminder', status: 'failed', error_message: 'token expirado', phone: '5547', scheduled_at: now }],
  workflow_executions: [],
};
const db = { rpc: async () => ({ data: rows.triage_sessions, error: null }), from: (t: string) => { const q: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'gte', 'order', 'limit']) q[m] = () => q;
  q.maybeSingle = async () => ({ data: rows[t][0] ?? null }); q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows[t] }).then(ok); return q; } };

describe('loadCentralData', () => {
  test('conta dados reais e aponta o que falta', async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const d = await loadCentralData(db as never, 'c1');
    expect(d.stats).toMatchObject({ conversas: 2, concluidas: 1, emAndamento: 1, leads: 1, falhasIa: 1, falhasEnvio: 1 });
    // Escolheu Evolution: um numero antigo da Meta salvo nao muda isso.
    expect(d.wppProvider).toBe('evolution');
    expect(d.checks.find(c => c.label.startsWith('Chave da IA'))!.ok).toBe(false);
    expect(d.checks.some(c => c.label.startsWith('Segredo'))).toBe(false);
    expect(d.checks.find(c => c.label === 'WhatsApp (Evolution)')!.detail).toMatch(/ainda não mandou o endereço/);
    expect(d.events.some(e => e.kind === 'falha' && e.title.includes('…1234'))).toBe(true);
  });

  test('sem provedor escolhido, numero da Meta preenchido leva aos requisitos da Meta', async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const original = rows.ai_agent_config;
    rows.ai_agent_config = [{ active: true, ai_provider: 'groq', groq_api_key: 'enc:x' }];
    try {
      const d = await loadCentralData(db as never, 'c1');
      expect(d.wppProvider).toBe('meta');
      expect(d.checks.find(c => c.label.startsWith('Segredo'))!.ok).toBe(false);
    } finally { rows.ai_agent_config = original; }
  });
});
