import { describe, expect, test } from 'vitest';
import { q, safeBack } from '@/lib/back-url';
import { friendlyError } from '@/lib/friendly-error';
import { validIsoDate } from '@/lib/valid-date';

describe('helpers da etapa 2', () => {
  test('retorno so interno e parametros com ? ou &', () => {
    expect(safeBack('https://mal.com', '/x')).toBe('/x');
    expect(safeBack('//mal.com', '/x')).toBe('/x');
    expect(safeBack('/financeiro?pagina=2', '/x')).toBe('/financeiro?pagina=2');
    expect(q('/configuracoes/tabela-calhas?aba=pintura') + 'erro=a').toBe('/configuracoes/tabela-calhas?aba=pintura&erro=a');
    expect(q('/financeiro') + 'recebido=1').toBe('/financeiro?recebido=1');
    expect(q('/financeiro?pagina=2&erro=x') + 'recebido=1').toBe('/financeiro?pagina=2&recebido=1');
  });
  test('erros tecnicos em portugues', () => {
    expect(friendlyError('new row violates row-level security policy for table "x"')).toMatch(/permissão/);
    expect(friendlyError('invalid input syntax for type date: "2026-02-30"')).toMatch(/Data inválida/);
    expect(friendlyError('Cliente sem telefone')).toBe('Cliente sem telefone');
  });
  test('datas reais', () => {
    expect(validIsoDate('2026-02-28')).toBe(true);
    expect(validIsoDate('2026-02-30')).toBe(false);
    expect(validIsoDate('12/11/2026')).toBe(false);
  });
});
