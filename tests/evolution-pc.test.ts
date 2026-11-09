import { describe, expect, test } from 'vitest';
import { evolutionWindowsScript, isTunnelUrl } from '@/lib/whatsapp/evolution';

const base = { apiKey: 'a'.repeat(64), hookSecret: 'b'.repeat(48), crmUrl: 'https://crm-bielenki.vercel.app', instance: 'crm', pgPass: 'c'.repeat(32) };

describe('Evolution no PC (Windows)', () => {
  test('script PowerShell leva o compose completo e só ASCII', () => {
    const s = evolutionWindowsScript(base);
    expect([...s].every(c => c.charCodeAt(0) < 128)).toBe(true);
    const compose = s.split("@'\n")[1].split("'@")[0];
    for (const svc of ['evolution:', 'postgres:', 'redis:', 'cloudflared:', 'avisador:']) expect(compose).toContain(`\n  ${svc}`);
    expect(compose).toContain(`AUTHENTICATION_API_KEY: ${base.apiKey}`);
    expect(compose).toContain('https://crm-bielenki.vercel.app/api/whatsapp/evolution-url');
    expect(compose).toContain('$$H');
    expect(s).not.toContain('__');
  });
  test('valores estranhos são recusados', () => {
    expect(() => evolutionWindowsScript({ ...base, crmUrl: 'https://x.com"; rm -rf /' })).toThrow();
  });
  test('só aceita endereço do túnel', () => {
    expect(isTunnelUrl('https://abc-def-123.trycloudflare.com')).toBe(true);
    expect(isTunnelUrl('https://evil.com')).toBe(false);
    expect(isTunnelUrl('https://x.trycloudflare.com.evil.com')).toBe(false);
  });
});
