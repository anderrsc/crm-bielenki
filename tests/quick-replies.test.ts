import { describe, expect, test } from 'vitest';
import { fillQuickReply, quickReplyQuery } from '@/lib/quick-replies';

describe('respostas prontas', () => {
  test('coloca o primeiro nome', () => {
    expect(fillQuickReply('{nome}, me manda uma foto', 'FABIANO silva')).toBe('Fabiano, me manda uma foto');
    expect(fillQuickReply('{nome}, me manda uma foto', '(47) 99999-0000')).toBe('Me manda uma foto');
    expect(fillQuickReply('Olá {nome}!', null)).toBe('Olá !'.replace(' !', '!'));
  });
  test('atalho com barra', () => {
    expect(quickReplyQuery('/pi')).toBe('pi');
    expect(quickReplyQuery('/')).toBe('');
    expect(quickReplyQuery('/pix agora')).toBeNull();
    expect(quickReplyQuery('oi')).toBeNull();
  });
});
