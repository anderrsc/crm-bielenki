// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AgendaPage, type AgendaEvent } from '@/components/agenda-page';
import { getAgendaEvents, moveAgendaEvent, schedulePendingService } from '@/app/(crm)/agenda-actions';
import {
  EMPTY_FILTERS, NOBODY, dayRange, filterEvents, filterOptions, matchesProduction, movedStart, overdueEvents,
} from '@/lib/service-board';

vi.mock('@/lib/use-mobile', () => ({ useMobile: () => false }));
vi.mock('@/app/(crm)/agenda-actions', () => ({ getAgendaEvents: vi.fn(), updateAgendaEventStatus: vi.fn(), createAgendaEvent: vi.fn(), getAgendaEventDetails: vi.fn(async () => ({})), moveAgendaEvent: vi.fn(), getPendingServices: vi.fn(async () => []), schedulePendingService: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.mocked(moveAgendaEvent).mockReset(); });

/** DataTransfer mínimo (o jsdom não tem). */
function transfer() {
  const data = new Map<string, string>();
  return { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', get types() { return [...data.keys()]; } };
}
async function dragTo(title: string, target: Element) {
  const dataTransfer = transfer();
  const card = within(screen.getByTestId('agenda-board')).getAllByText(title)[0].closest('[draggable]')!;
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  await act(async () => { fireEvent.drop(target, { dataTransfer }); });
}
function openBoard(list: AgendaEvent[]) {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-27T12:00:00-03:00'));
  vi.mocked(getAgendaEvents).mockImplementation(() => new Promise(() => {}));
  render(<AgendaPage initialEvents={list} />);
}
const region = (name: string) => screen.getByRole('region', { name });

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

test('mover mantém o horário de Brasília', () => {
  expect(movedStart('2026-11-20T11:30:00+00:00', '2026-12-01')).toBe('2026-12-01T08:30:00-03:00');
  expect(movedStart('2026-11-21T00:00:00-03:00', '2026-12-01')).toBe('2026-12-01T00:00:00-03:00');
});

test('arrastar um atrasado para um dia reagenda; soltar em Atrasados não grava nada', async () => {
  vi.mocked(moveAgendaEvent).mockResolvedValue({});
  openBoard(events);
  await dragTo('João Silva', region('Atrasados'));
  await dragTo('Serviço atrasado', region('Atrasados'));
  expect(moveAgendaEvent).not.toHaveBeenCalled();

  await dragTo('Serviço atrasado', region('Sábado 28/11'));
  expect(moveAgendaEvent).toHaveBeenCalledWith({ id: 'atrasado', source: 'operational_events', day: '2026-11-28' });
  expect(within(region('Sábado 28/11')).getByText('Serviço atrasado')).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Atrasados' })).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('sábado 28/11/2026 às 08:00');
});

test('se o banco recusar, mostra o erro e o cartão volta', async () => {
  vi.mocked(moveAgendaEvent).mockResolvedValue({ error: 'Sem permissão.' });
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  openBoard(events);
  await dragTo('João Silva', region('Sábado 28/11'));
  expect(alert).toHaveBeenCalledWith('Não foi possível mover "João Silva". Sem permissão.');
  expect(within(region('Sexta 27/11')).getByText('João Silva')).toBeTruthy();
  vi.mocked(moveAgendaEvent).mockRejectedValue(new Error('rede'));
  await dragTo('João Silva', region('Sábado 28/11'));
  expect(alert).toHaveBeenLastCalledWith(expect.stringContaining('internet'));
  expect(within(region('Sexta 27/11')).getByText('João Silva')).toBeTruthy();
});

test('data passada pede confirmação; concluído não arrasta', async () => {
  vi.mocked(moveAgendaEvent).mockResolvedValue({});
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  openBoard(events);
  await dragTo('João Silva', region('Segunda 23/11'));
  expect(confirm).toHaveBeenCalled();
  expect(moveAgendaEvent).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'concluido' } });
  expect(screen.getByText('Serviço feito').closest('[draggable]')!.getAttribute('draggable')).toBe('false');
});

test('por funcionário: outra linha troca o responsável; linha da escala não', async () => {
  vi.mocked(moveAgendaEvent).mockResolvedValue({});
  openBoard([...events, event('outro', '2026-11-27T10:00:00-03:00', { responsible_name: 'Carla' })]);
  fireEvent.click(screen.getByRole('button', { name: 'Por funcionário' }));
  const cell = (name: string, day: string) => screen.getByRole('cell', { name: `${name}, ${day}` });

  // João Silva: responsável Ana, Beto escalado. Arrastar da linha do Beto não troca ninguém.
  const dataTransfer = transfer();
  fireEvent.dragStart(within(cell('Beto', '27/11')).getByText('João Silva').closest('[draggable]')!, { dataTransfer });
  await act(async () => { fireEvent.drop(cell('Carla', '27/11'), { dataTransfer }); });
  expect(moveAgendaEvent).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('escala');

  await dragTo('Serviço outro', cell('Ana', '28/11'));
  expect(moveAgendaEvent).toHaveBeenLastCalledWith({ id: 'outro', source: 'operational_events', day: '2026-11-28', person: 'Ana' });
  await dragTo('Serviço outro', cell('Sem funcionário', '28/11'));
  expect(moveAgendaEvent).toHaveBeenLastCalledWith({ id: 'outro', source: 'operational_events', person: null });
});

test('o detalhe permite reagendar sem arrastar (teclado)', async () => {
  vi.mocked(moveAgendaEvent).mockResolvedValue({});
  openBoard(events);
  await act(async () => { fireEvent.click(screen.getByText('João Silva')); });
  const form = within(screen.getByRole('form', { name: 'Reagendar compromisso' }));
  fireEvent.change(form.getByLabelText('Nova data'), { target: { value: '2026-12-02' } });
  await act(async () => { fireEvent.click(form.getByRole('button', { name: /Salvar mudança/ })); });
  expect(moveAgendaEvent).toHaveBeenCalledWith({ id: 'hoje', source: 'operational_events', day: '2026-12-02' });
});

const undated = {
  id: 'srv', type: 'manutencao', kind_label: 'Manutenção de calhas', title: 'Vedar emenda', status: 'solicitacao_recebida',
  priority: 'urgente', expected_date: null, starts_at: '', client_name: 'Francisco', responsible_name: 'Rosa',
};

test('serviço sem data aparece no quadro e, arrastado para um dia, pede confirmação e agenda', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-27T12:00:00-03:00'));
  vi.mocked(getAgendaEvents).mockImplementation(() => new Promise(() => {}));
  vi.mocked(schedulePendingService).mockResolvedValue({});
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<AgendaPage initialEvents={[]} initialPending={[undated]} />);
  const card = within(region('Sem data')).getByText('Francisco').closest('a')!;
  expect(card.getAttribute('href')).toBe('/servicos/srv');
  await dragTo('Francisco', region('Sábado 28/11'));
  expect(confirm.mock.calls[0][0]).toContain('28/11/2026 às 08:00');
  expect(schedulePendingService).toHaveBeenCalledWith({ id: 'srv', day: '2026-11-28', person: undefined });
  expect(screen.queryByRole('region', { name: 'Sem data' })).toBeNull();
});

test('serviço sem data continua no lugar se desistir ou se o banco recusar', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-27T12:00:00-03:00'));
  vi.mocked(schedulePendingService).mockReset().mockResolvedValue({ error: 'Sem permissão.' });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  render(<AgendaPage initialEvents={[]} initialPending={[undated]} />);
  await dragTo('Francisco', region('Sábado 28/11'));
  expect(schedulePendingService).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await dragTo('Francisco', region('Sábado 28/11'));
  expect(alert.mock.calls[0][0]).toContain('Sem permissão.');
  expect(within(region('Sem data')).getByText('Francisco')).toBeTruthy();
});