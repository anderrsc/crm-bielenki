import { describe, expect, test } from 'vitest';
import { evolutionCloudInit, evolutionUrlFromIp } from '@/lib/whatsapp/evolution';

describe('Evolution', () => {
  test('IP público vira endereço HTTPS; IP interno é recusado', () => {
    expect(evolutionUrlFromIp(' 129.146.10.20 ')).toBe('https://129-146-10-20.sslip.io');
    expect(evolutionUrlFromIp('10.0.0.5')).toBeNull();
    expect(evolutionUrlFromIp('169.254.169.254')).toBeNull();
    expect(evolutionUrlFromIp('300.1.1.1')).toBeNull();
    expect(evolutionUrlFromIp('abc')).toBeNull();
  });
  test('script leva a chave e deixa as variáveis para o Docker', () => {
    const key = 'a'.repeat(64);
    const s = evolutionCloudInit(key);
    expect(s).toContain(`API_KEY=${key}`);
    expect(s).toContain('AUTHENTICATION_API_KEY: ${API_KEY}');
    expect(s).toContain('SERVER_URL: https://${HOST}');
    expect(s).toContain('{$HOST} {');
    expect(() => evolutionCloudInit('chave com espaço')).toThrow();
    // A Oracle recusa script com caractere fora do ASCII ("Incorrectly formatted request").
    expect([...s].every(c => c.charCodeAt(0) < 128)).toBe(true);
  });
});
