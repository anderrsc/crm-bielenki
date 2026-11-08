import { describe, expect, test } from 'vitest';
import { formatBrPhone, phoneKey, samePhone } from '@/lib/whatsapp/phone';

describe('telefones do WhatsApp x cadastro', () => {
  test('mesmo número em formatos diferentes', () => {
    expect(samePhone('5547999990000', '(47) 99999-0000')).toBe(true);
    expect(samePhone('554799990000', '(47) 99999-0000')).toBe(true); // sem o 9 extra
    expect(samePhone('5547999990000', '(48) 99999-0000')).toBe(false); // DDD diferente
    expect(samePhone('5547999990000', '')).toBe(false);
  });
  test('chave e formato', () => {
    expect(phoneKey('+55 (47) 99999-0000')).toBe('4799990000');
    expect(formatBrPhone('5547999990000')).toBe('(47) 99999-0000');
    expect(formatBrPhone('554799990000')).toBe('(47) 99999-0000');
    expect(formatBrPhone('554733710000')).toBe('(47) 3371-0000');
  });
});
