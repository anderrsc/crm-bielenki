import { describe, expect, test } from 'vitest';
import { parseSheet, sheetDescription, isSheet } from '@/components/gutter-quote';

describe('chapa lisa', () => {
  test('descrição vai e volta igual', () => {
    const sh = { thickness: '0.6mm', cut: '1000 mm', color: 'Pintura Preto', length: 2.5, perMeter: 80 };
    const d = sheetDescription(sh);
    expect(d).toBe('Espessura 0.6mm · C/ 1000 mm · Comprimento 2,5 m · Cor: Pintura Preto');
    expect(parseSheet(d, 200)).toEqual(sh);
    expect(isSheet('chapa lisa')).toBe(true);
  });
});
