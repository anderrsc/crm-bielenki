import { expect, test } from 'vitest';
import { safeExternalUrl } from '@/lib/safe-url';

test.each([
  ['https://evolution-api-production-668c.up.railway.app', 'https://evolution-api-production-668c.up.railway.app'],
  ['https://evo.exemplo.com.br/api/', 'https://evo.exemplo.com.br/api'],
])('aceita HTTPS publico %s', (entrada, saida) => expect(safeExternalUrl(entrada)).toBe(saida));

test.each([
  'http://evo.exemplo.com.br', 'https://localhost:8080', 'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.0.10',
  'https://172.20.1.1', 'https://169.254.169.254/latest/meta-data', 'https://[::1]', 'https://intranet', 'https://user:senha@evo.exemplo.com',
  'https://api.internal', 'javascript:alert(1)', 'ftp://evo.exemplo.com', '', 'nao e url',
])('rejeita destino inseguro %s (auditoria A05)', (entrada) => expect(safeExternalUrl(entrada)).toBeNull());
