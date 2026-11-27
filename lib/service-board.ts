/** Regras puras do quadro de serviços (agenda e produção): filtros e períodos. */
import { isAgendaDone } from '@/lib/agenda-location';
import { localISODate } from '@/lib/utils';

export type BoardEvent = {
  type: string; title: string; status: string; starts_at: string;
  client_name?: string | null; responsible_name?: string | null;
  team_name?: string | null; crew?: string[] | null;
};

export const isAgendaCancelled = (status: string) => status === 'cancelado' || status === 'cancelada';

export type StatusFilter = 'ativos' | 'concluido' | 'cancelado' | 'todos';
/** Valor especial dos filtros de funcionário e equipe: itens sem ninguém definido. */
export const NOBODY = '__sem__';
export type AgendaFilters = { search: string; person: string; team: string; types: string[]; status: StatusFilter };
export const EMPTY_FILTERS: AgendaFilters = { search: '', person: '', team: '', types: [], status: 'ativos' };

export const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const byName = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

/** Responsável do compromisso mais quem está escalado na saída da equipe. */
export function eventPeople(e: BoardEvent) {
  return [...new Set([e.responsible_name, ...(e.crew ?? [])].map((n) => n?.trim()).filter((n): n is string => !!n))];
}

export function filterOptions(events: BoardEvent[]) {
  return {
    people: [...new Set(events.flatMap(eventPeople))].sort(byName),
    teams: [...new Set(events.map((e) => e.team_name).filter((n): n is string => !!n))].sort(byName),
  };
}

export function filterEvents<T extends BoardEvent>(events: T[], f: AgendaFilters): T[] {
  const term = normalize(f.search);
  return events.filter((e) => {
    if (f.status === 'ativos' && (isAgendaDone(e.status) || isAgendaCancelled(e.status))) return false;
    if (f.status === 'concluido' && !isAgendaDone(e.status)) return false;
    if (f.status === 'cancelado' && !isAgendaCancelled(e.status)) return false;
    if (f.types.length && !f.types.includes(e.type)) return false;
    const people = eventPeople(e);
    if (f.person && (f.person === NOBODY ? people.length > 0 : !people.includes(f.person))) return false;
    if (f.team && (f.team === NOBODY ? !!e.team_name : e.team_name !== f.team)) return false;
    return !term || normalize([e.title, e.client_name, e.team_name, ...people].filter(Boolean).join(' ')).includes(term);
  });
}

export const hasFilters = (f: AgendaFilters) =>
  !!(f.search || f.person || f.team || f.types.length || f.status !== EMPTY_FILTERS.status);

export const eventDay = (e: BoardEvent) => localISODate(new Date(e.starts_at));

/** Pendentes de dias anteriores a hoje: a coluna "Atrasados". */
export function overdueEvents<T extends BoardEvent>(events: T[], today: string): T[] {
  return events.filter((e) => !isAgendaDone(e.status) && !isAgendaCancelled(e.status) && eventDay(e) < today);
}

export const MAX_BOARD_DAYS = 62;
/** Dias (AAAA-MM-DD) entre as duas datas, inclusive; aceita invertidas e limita o tamanho. */
export function dayRange(from: string, to: string): string[] {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const days: string[] = [];
  const d = new Date(`${a}T12:00:00Z`);
  while (!Number.isNaN(d.getTime()) && days.length < MAX_BOARD_DAYS) {
    const key = d.toISOString().slice(0, 10);
    if (key > b) break;
    days.push(key);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

export type ProductionItem = {
  number: string; orderNumber: string; client: string; people: string[]; deadline: string | null; finished: boolean;
};
export type ProductionFilters = { search?: string; person?: string; from?: string; to?: string; late?: boolean };

export const isLate = (item: Pick<ProductionItem, 'deadline' | 'finished'>, today: string) =>
  !item.finished && !!item.deadline && item.deadline.slice(0, 10) < today;

export function matchesProduction(item: ProductionItem, f: ProductionFilters, today: string) {
  const term = normalize(f.search ?? '');
  if (term && !normalize(`${item.number} ${item.orderNumber} ${item.client}`).includes(term)) return false;
  if (f.person && (f.person === NOBODY ? item.people.length > 0 : !item.people.includes(f.person))) return false;
  const deadline = item.deadline?.slice(0, 10);
  if (f.from && (!deadline || deadline < f.from)) return false;
  if (f.to && (!deadline || deadline > f.to)) return false;
  return !f.late || isLate(item, today);
}
