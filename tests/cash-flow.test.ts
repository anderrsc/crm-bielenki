import { expect, test } from 'vitest';
import { currentBalance, projectScenario, weeklyProjection, type CashOverview } from '@/lib/cash-flow';

const base: CashOverview = {
  today: '2026-11-13', days: 14,
  accounts: [
    { id: 'a', name: 'Banco', active: true, opening_balance: 1000, opening_date: '2026-11-01', inflow: 500.1, outflow: 200, balance: 1300.1 },
    { id: 'b', name: 'Caixa', active: true, opening_balance: 0, opening_date: null, inflow: 0.2, outflow: 0, balance: 0.2 },
  ],
  unassigned: { inflow: 100, outflow: 50 },
  overdue_receivable: 400, overdue_payable: 300, undated: 0,
  flows: [
    { date: '2026-11-15', receivable: 0, payable: 2000 },
    { date: '2026-11-22', receivable: 1000, payable: 0 },
  ],
};

test('saldo atual soma as contas e as baixas sem conta, sem erro de centavos', () => {
  expect(currentBalance(base)).toBe(1350.3);
});

test('cenarios: saidas inteiras, entradas conforme o cenario, e aviso do dia em que falta caixa', () => {
  const provavel = projectScenario(base, 'provavel');
  expect(provavel.final).toBe(250.3);
  expect(provavel.min).toBe(-749.7);
  expect(provavel.minDate).toBe('2026-11-15');
  expect(provavel.negativeOn).toBe('2026-11-15');
  expect(projectScenario(base, 'conservador').final).toBe(-149.7);
  expect(projectScenario(base, 'otimista').final).toBe(450.3);
  expect(projectScenario({ ...base, flows: [] }, 'otimista').negativeOn).toBeNull();
});

test('semana a semana fecha com o saldo final do cenario', () => {
  const weeks = weeklyProjection(base, 'provavel');
  expect(weeks.map((w) => [w.start, w.end])).toEqual([['2026-11-13', '2026-11-19'], ['2026-11-20', '2026-11-26'], ['2026-11-27', '2026-11-27']]);
  expect(weeks[0]).toMatchObject({ receivable: 0, payable: 2000, balance: -749.7 });
  expect(weeks.at(-1)!.balance).toBe(projectScenario(base, 'provavel').final);
});
