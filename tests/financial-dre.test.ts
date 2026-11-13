import { expect, test } from 'vitest';
import { buildDre, monthsBetween } from '@/lib/financial-dre';

test('meses do periodo', () => {
  expect(monthsBetween('2026-11-01', '2027-01-31')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
});

test('as 11 linhas fecham por mes e no total, sem erro de centavos', () => {
  const months = ['2026-01-01', '2026-02-01'];
  const rows = buildDre([
    { month: '2026-01-01', grp: 'receita', category: 'Venda de calhas', amount: 1000.1 },
    { month: '2026-01-01', grp: 'receita', category: 'Serviços', amount: 0.2 },
    { month: '2026-02-01', grp: 'receita', category: 'Venda de calhas', amount: 500 },
    { month: '2026-01-01', grp: 'deducao', category: 'Impostos', amount: 100 },
    { month: '2026-01-01', grp: 'custo', category: 'Compra de bobinas', amount: 300 },
    { month: '2026-02-01', grp: 'comercial', category: 'Comissões', amount: 50 },
    { month: '2026-01-01', grp: 'administrativa', category: 'Aluguel', amount: 200 },
    { month: '2026-02-01', grp: 'outras', category: 'Despesas sem categoria', amount: 10 },
    { month: '2026-02-01', grp: 'financeiro', category: 'Juros pagos', amount: -20 },
    { month: '2026-03-01', grp: 'receita', category: 'Fora do período', amount: 999 },
  ], months);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  expect(rows).toHaveLength(11);
  expect(by.receita_bruta.values).toEqual([1000.3, 500]);
  expect(by.receita_liquida.values).toEqual([900.3, 500]);
  expect(by.lucro_bruto.values).toEqual([600.3, 500]);
  expect(by.operacional.values).toEqual([400.3, 440]);
  expect(by.resultado.values).toEqual([400.3, 420]);
  expect(by.resultado.total).toBe(820.3);
  expect(by.custos.values).toEqual([-300, -0]);
  expect(by.custos.details![0]).toMatchObject({ category: 'Compra de bobinas', total: -300 });
  expect(by.receita_bruta.details!.map((d) => d.category)).toEqual(['Venda de calhas', 'Serviços']);
});
