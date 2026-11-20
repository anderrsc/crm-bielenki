import { describe, it, expect } from 'vitest';
import { shouldRestart, STALE_MINUTES, RESTART_EVERY_MINUTES } from '@/lib/whatsapp/watchdog';

describe('WhatsApp Connection History & Watchdog', () => {
  describe('shouldRestart', () => {
    const now = new Date('2026-11-20T15:00:00Z'); // Sexta-feira, 12h Brasília (dentro do expediente)

    it('não reinicia fora do horário comercial', () => {
      const nightTime = new Date('2026-11-20T03:00:00Z'); // 0h Brasília
      expect(shouldRestart({
        state: 'open',
        lastMessageEventAt: new Date(nightTime.getTime() - 30 * 60_000).toISOString(),
        lastRestartAt: null,
        now: nightTime,
      })).toBe(false);
    });

    it('não reinicia quando conexão não está open', () => {
      expect(shouldRestart({
        state: 'close',
        lastMessageEventAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
        lastRestartAt: null,
        now,
      })).toBe(false);
    });

    it('não reinicia quando houve mensagem recente (< 20 min)', () => {
      expect(shouldRestart({
        state: 'open',
        lastMessageEventAt: new Date(now.getTime() - 10 * 60_000).toISOString(),
        lastRestartAt: null,
        now,
      })).toBe(false);
    });

    it('reinicia quando sem mensagens há >= 20 min e último restart foi há >= 45 min', () => {
      expect(shouldRestart({
        state: 'open',
        lastMessageEventAt: new Date(now.getTime() - STALE_MINUTES * 60_000).toISOString(),
        lastRestartAt: new Date(now.getTime() - RESTART_EVERY_MINUTES * 60_000).toISOString(),
        now,
      })).toBe(true);
    });

    it('não reinicia quando último restart foi recente (< 45 min)', () => {
      expect(shouldRestart({
        state: 'open',
        lastMessageEventAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
        lastRestartAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
        now,
      })).toBe(false);
    });

    it('reinicia quando nunca houve restart (lastRestartAt null)', () => {
      expect(shouldRestart({
        state: 'open',
        lastMessageEventAt: new Date(now.getTime() - 25 * 60_000).toISOString(),
        lastRestartAt: null,
        now,
      })).toBe(true);
    });
  });

  describe('Migração whatsapp_connection_history', () => {
    it('arquivo da migração existe e contém estrutura esperada', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const migrationPath = path.join(process.cwd(), 'supabase/migrations/20261120100000_whatsapp_connection_history.sql');

      expect(fs.existsSync(migrationPath)).toBe(true);

      const content = fs.readFileSync(migrationPath, 'utf-8');
      expect(content).toContain('create table if not exists public.whatsapp_connection_history');
      expect(content).toContain('record_whatsapp_connection_event');
      expect(content).toContain('v_whatsapp_health_summary');
      expect(content).toContain('enable row level security');
    });
  });
});