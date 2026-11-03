import { afterEach, expect, test, vi } from 'vitest';
import { addDaysISO, localISODate, shortDate, todayISO } from '@/lib/utils';

afterEach(() => { vi.useRealTimers(); });

test('22h30 em Brasilia (01h30 UTC do dia seguinte) ainda e hoje no sistema', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T01:30:00Z'));
  expect(todayISO()).toBe('2026-11-02');
  expect(localISODate()).toBe('2026-11-02');
  expect(shortDate('2026-11-03T01:30:00Z')).toBe('02/11/2026');
});

test('datas sem horario nao mudam de dia', () => {
  expect(shortDate('2026-03-01')).toBe('01/03/2026');
  expect(addDaysISO('2026-02-27', 2)).toBe('2026-03-01');
  expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
});
