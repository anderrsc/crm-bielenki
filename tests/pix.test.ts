import { describe, expect, test } from 'vitest';
import { normalizePixKey, pixCopiaECola, pixChargeMessage } from '@/lib/pix';

describe('pix', () => {
  test('exemplo oficial do Banco Central (CRC confere)', () => {
    // Manual do BR Code: chave 123e4567-e12b-12d1-a456-426655440000, Fulano de Tal, BRASILIA, sem valor, txid ***
    const code = pixCopiaECola({ key: '123e4567-e12b-12d1-a456-426655440000', name: 'Fulano de Tal', city: 'BRASILIA', amount: 0 });
    expect(code).toBe('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D');
  });
  test('com valor e nome com acento', () => {
    const code = pixCopiaECola({ key: '26.887.887/0001-75', name: 'Calhas e Esquadrias Marquinhos', city: 'Jaraguá do Sul', amount: 1250.5 });
    expect(code).toContain('011426887887000175');
    expect(code).toContain('54071250.50');
    expect(code).toContain('5925Calhas e Esquadrias Marq');
    expect(code).toContain('6014Jaragua do Sul');
  });
  test('chaves', () => {
    expect(normalizePixKey('(47) 98835-8243')).toBe('+5547988358243');
    expect(normalizePixKey('123.456.789-09')).toBe('12345678909');
    expect(normalizePixKey('Fin@Marquinhos.com')).toBe('fin@marquinhos.com');
  });
  test('mensagem', () => {
    const m = pixChargeMessage({ firstName: 'Carlos', amount: 500, percent: 50, what: 'orçamento 1882', key: 'chave', holder: 'Marquinhos' });
    expect(m.split('\n')[0]).toBe('Carlos, segue os dados para o Pix da entrada (50%) referente a orçamento 1882:');
    expect(m).toContain('Valor: R$ 500,00');
  });
});
