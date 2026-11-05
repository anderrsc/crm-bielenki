import { expect, test } from 'vitest';
import { daysBetween, whatsappLink } from '@/components/pipeline-board';

test('whatsapp link adds Brazil code only to local numbers', () => {
  expect(whatsappLink('(47) 99953-3518')).toBe('https://wa.me/5547999533518');
  expect(whatsappLink('5547999533518')).toBe('https://wa.me/5547999533518');
  expect(whatsappLink('123')).toBeNull();
  expect(whatsappLink(null)).toBeNull();
});

test('days in stage counts whole days and never goes negative', () => {
  const now = new Date('2026-11-15T12:00:00Z').getTime();
  expect(daysBetween('2026-11-05T12:00:00Z', now)).toBe(10);
  expect(daysBetween('2026-11-20T12:00:00Z', now)).toBe(0);
  expect(daysBetween(null, now)).toBe(0);
});
