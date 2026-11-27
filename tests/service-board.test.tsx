// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AgendaPage, type AgendaEvent } from '@/components/agenda-page';
import {
  EMPTY_FILTERS, NOBODY, dayRange, filterEvents, filterOptions, matchesProduction, overdueEvents,
} from '@/lib/service-board';

vi.mock('@/lib/use-mobile', () => ({ useMobile: () => false }));
vi.mock('@/app/(crm)/agenda-actions', () => ({ getAgendaEvents: vi.fn(), updateAgendaEventStatus: vi.fn(), createAgendaEvent: vi.fn(), getAgendaEventDetails: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

const event = (id: string, starts_at: string, extra: Partial<AgendaEvent> = {}): AgendaEvent =>
  ({ id, source: 'operational_events', type: 'instalacao', title: `Serviço ${id}`, status: 'agendado', starts_at, ...extra });

const events = [
  event('hoje', '2026-11-27T08:00:00-03:00', { client_name: 'João Silva', responsible_name: 'Ana', team_name: 'Equipe A', crew: ['Beto'] }),
  event('atrasado', '2026-11-20T08:00:00-03:00', { type: 'medicao' }),
  event('feito', '2026-11-26T08:00:00-03:00', { status: 'concluida', responsible_name: 'Ana' }),
  event('cancelado', '2026-11-26T09:00:00-03:00', { status: 'cancelada' }),
];
const ids = (list: AgendaEvent[]) => list.map((e) => e.id);

test('filtra por funcionário (responsável ou escalado), equipe, tipo, situação e busca sem acento', () => {
  const f = (patch: object) => ids(filterEvents(events, { ...EMPTY_FILTERS, ...patch }));
  expect(f({})).toEqual(['hoje', 'atrasado']);
  expect(f({ person: 'Beto' })).toEqual(['hoje']);
  expect(f({ person: 'Ana', status: 'todos' })).toEqual(['hoje', 'feito']);
  expect(f({ person: NOBODY })).toEqual(['atrasado']);
  expect(f({ team: 'Equipe A' })).toEqual(['hoje']);
  expect(f({ team: NOBODY })).toEqual(['atrasado']);
  expect(f({ types: ['medicao'] })).toEqual(['atrasado']);
  expect(f({ status: 'concluido' })).toEqual(['feito']);
  expect(f({ status: 'cancelado' })).toEqual(['cancelado']);
  expect(f({ search: 'joao' })).toEqual(['hoje']);
  expect(filterOptions(events)).toEqual({ people: ['Ana', 'Beto'], teams: ['Equipe A'] });
});

test('atrasados são só os pendentes de dias anteriores', () => {
  expect(ids(overdueEvents(events, '2026-11-27'))).toEqual(['atrasado']);
});

test('período inclui as pontas, aceita datas invertidas e tem limite', () => {
  expect(dayRange('2026-11-30', '2026-12-02')).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
  expect(dayRange('2026-12-02', '2026-12-01')).toEqual(['2026-12-01', '2026-12-02']);
  expect(dayRange('2026-01-01', '2027-01-01')).toHaveLength(62);
  expect(dayRange('x', 'y')).toEqual([]);
});

test('produção filtra por funcionário, prazo e atraso', () => {
  const item = { number: 'OP-1', orderNumber: 'PED-9', client: 'Márcia', people: ['Ana'], deadline: '2026-11-20', finished: false };
  const ok = (f: object, patch: object = {}) => matchesProduction({ ...item, ...patch }, f, '2026-11-27');
  expect(ok({ search: 'marcia' })).toBe(true);
  expect(ok({ person: 'Beto' })).toBe(false);
  expect(ok({ person: NOBODY }, { people: [] })).toBe(true);
  expect(ok({ from: '2026-11-20', to: '2026-11-20' })).toBe(true);
  expect(ok({ from: '2026-11-21' })).toBe(false);
  expect(ok({ to: '2026-11-30' }, { deadline: null })).toBe(false);
  expect(ok({ late: true })).toBe(true);
  expect(ok({ late: true }, { finished: true })).toBe(false);
});

test('quadro abre na semana, separa atrasados, filtra e agrupa por funcionário', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-27T12:00:00-03:00'));
  render(<AgendaPage initialEvents={events} />);
  const board = () => within(screen.getByTestId('agenda-board'));
  expect(within(screen.getByRole('region', { name: 'Atrasados' })).getByText('Serviço atrasado')).toBeTruthy();
  expect(board().getByText('João Silva')).toBeTruthy();
  expect(board().queryByText('Serviço feito')).toBeNull();

  fireEvent.change(screen.getByLabelText('Funcionário'), { target: { value: 'Beto' } });
  expect(screen.queryByRole('region', { name: 'Atrasados' })).toBeNull();
  expect(board().getByText('João Silva')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /Limpar filtros/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Por funcionário' }));
  expect(board().getByRole('rowheader', { name: 'Ana' })).toBeTruthy();
  expect(board().getByRole('rowheader', { name: 'Sem funcionário' })).toBeTruthy();
});

test('quadro permite escolher as datas', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-27T12:00:00-03:00'));
  render(<AgendaPage initialEvents={[]} />);
  expect(screen.getByText('23/11/2026 — 29/11/2026')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'datas' } });
  fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-12-01' } });
  fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-12-03' } });
  expect(screen.getByText('01/12/2026 — 03/12/2026')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Próximo período' }));
  expect(screen.getByText('04/12/2026 — 06/12/2026')).toBeTruthy();
});
