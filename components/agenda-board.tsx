"use client";
import { useState } from "react";
import { Check, Plus, Truck, User } from "lucide-react";
import type { AgendaEvent } from "@/components/agenda-page";
import { TYPE_CONFIG, statusConfig } from "@/components/agenda-event-style";
import { isAgendaDone } from "@/lib/agenda-location";
import { eventDay, eventPeople, isAgendaCancelled, overdueEvents } from "@/lib/service-board";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const byStart = (a: AgendaEvent, b: AgendaEvent) => Date.parse(a.starts_at) - Date.parse(b.starts_at);
const NO_PERSON = "Sem funcionário";

type Handlers = { onSelect: (e: AgendaEvent) => void; onNew: (day: string) => void };

/** Quadro de serviços: uma coluna por dia (como o quadro da oficina) e os atrasados na frente. */
export function AgendaBoard({ events, days, today, onSelect, onNew }: Handlers & {
  /** Já filtrados por funcionário, equipe, tipo, situação e busca. */
  events: AgendaEvent[];
  days: string[];
  today: string;
}) {
  const [group, setGroup] = useState<"dia" | "pessoa">("dia");
  const inRange = new Set(days);
  const visible = events.filter((e) => inRange.has(eventDay(e))).sort(byStart);
  const late = overdueEvents(events, today).sort(byStart);
  // Domingo só ocupa espaço quando tem serviço.
  const columns = days.filter((d) => days.length === 1 || weekday(d) !== 0 || d === today || visible.some((e) => eventDay(e) === d));
  // O que já está na coluna de atrasados não se repete no dia.
  const lateSet = new Set(late);
  const onDay = (list: AgendaEvent[], day: string) => list.filter((e) => eventDay(e) === day && !lateSet.has(e));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink/60">
          <strong className="text-ink">{visible.length}</strong> {visible.length === 1 ? "serviço" : "serviços"} no período
          {late.length > 0 && <> · <strong className="text-red-600">{late.length}</strong> {late.length === 1 ? "atrasado" : "atrasados"}</>}
        </p>
        <div className="flex rounded-xl border bg-surface" role="group" aria-label="Organizar quadro">
          {([["dia", "Por data"], ["pessoa", "Por funcionário"]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={group === value} onClick={() => setGroup(value)}
              className={`min-h-9 px-3 text-xs font-semibold first:rounded-l-xl last:rounded-r-xl ${group === value ? "bg-brand-strong text-white" : "text-ink/60 hover:bg-cream"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {group === "dia"
        ? <ByDay late={late} columns={columns} today={today} cards={(day) => onDay(visible, day)} onSelect={onSelect} onNew={onNew} />
        : <ByPerson late={late} visible={visible} columns={columns} today={today} onDay={onDay} onSelect={onSelect} onNew={onNew} />}
    </div>
  );
}

function ByDay({ late, columns, today, cards, onSelect, onNew }: Handlers & {
  late: AgendaEvent[]; columns: string[]; today: string; cards: (day: string) => AgendaEvent[];
}) {
  return (
    <div data-testid="agenda-board" className="flex flex-col gap-3 md:flex-row md:items-stretch md:overflow-x-auto md:pb-3">
      {late.length > 0 && (
        <section aria-label="Atrasados" className="flex shrink-0 flex-col rounded-2xl border border-red-300 bg-red-50/40 md:w-52">
          <header className="flex items-center justify-between rounded-t-2xl bg-red-600 px-3 py-2 text-white">
            <h2 className="text-sm font-semibold">Atrasados</h2>
            <span className="rounded-full bg-white/20 px-2 text-xs font-semibold">{late.length}</span>
          </header>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
            {late.map((e) => <Card key={`${e.source}-${e.id}`} event={e} showDate onSelect={onSelect} />)}
          </div>
        </section>
      )}
      {columns.map((day) => {
        const list = cards(day);
        const isToday = day === today;
        const label = `${WEEKDAYS[weekday(day)]} ${shortDay(day)}`;
        return (
          <section key={day} aria-label={label}
            className={`flex min-w-0 flex-1 flex-col rounded-2xl border bg-surface md:min-w-[165px] ${isToday ? "border-brand-strong ring-1 ring-brand-strong" : ""}`}>
            <header className={`flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2 ${isToday ? "bg-brand-strong text-white" : "bg-cream"}`}>
              <div>
                <h2 className="text-sm font-semibold">{WEEKDAYS[weekday(day)]}{isToday ? " · hoje" : ""}</h2>
                <p className={`text-xs ${isToday ? "text-white/80" : "text-ink/50"}`}>{shortDay(day)} · {list.length}</p>
              </div>
              <button type="button" aria-label={`Agendar em ${label}`} onClick={() => onNew(day)} className="rounded-lg p-2 hover:bg-black/10">
                <Plus className="h-4 w-4" />
              </button>
            </header>
            <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
              {list.map((e) => <Card key={`${e.source}-${e.id}`} event={e} onSelect={onSelect} />)}
              {!list.length && <p className="py-4 text-center text-xs text-ink/35">Livre</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ByPerson({ late, visible, columns, today, onDay, onSelect, onNew }: Handlers & {
  late: AgendaEvent[]; visible: AgendaEvent[]; columns: string[]; today: string;
  onDay: (list: AgendaEvent[], day: string) => AgendaEvent[];
}) {
  const names = (e: AgendaEvent) => { const p = eventPeople(e); return p.length ? p : [NO_PERSON]; };
  // Serviço com mais de uma pessoa aparece na linha de cada uma.
  const rows = [...new Set([...late, ...visible].flatMap(names))]
    .sort((a, b) => Number(a === NO_PERSON) - Number(b === NO_PERSON) || a.localeCompare(b, "pt-BR"));
  if (!rows.length) return <p className="card p-8 text-center text-sm text-ink/50">Nenhum serviço neste período.</p>;
  return (
    <div data-testid="agenda-board" className="overflow-auto rounded-2xl border bg-surface">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-cream">
            <th scope="col" className="sticky left-0 z-10 min-w-[130px] border-b border-r bg-cream p-3 text-xs font-semibold">Funcionário</th>
            {late.length > 0 && <th scope="col" className="min-w-[190px] border-b border-r bg-red-600 p-3 text-xs font-semibold !text-white">Atrasados</th>}
            {columns.map((day) => (
              <th key={day} scope="col" className={`min-w-[180px] border-b border-r p-3 text-xs font-semibold ${day === today ? "bg-brand-strong !text-white" : ""}`}>
                {WEEKDAYS[weekday(day)]} {shortDay(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((name) => {
            const mine = (e: AgendaEvent) => names(e).includes(name);
            return (
              <tr key={name} className="align-top">
                <th scope="row" className="sticky left-0 z-10 border-b border-r bg-surface p-3 text-sm font-semibold">{name}</th>
                {late.length > 0 && (
                  <td className="space-y-2 border-b border-r bg-red-50/40 p-2">
                    {late.filter(mine).map((e) => <Card key={`${e.source}-${e.id}`} event={e} showDate onSelect={onSelect} />)}
                  </td>
                )}
                {columns.map((day) => (
                  <td key={day} className="border-b border-r p-2">
                    <div className="space-y-2">
                      {onDay(visible.filter(mine), day).map((e) => <Card key={`${e.source}-${e.id}`} event={e} onSelect={onSelect} />)}
                      <button type="button" aria-label={`Agendar em ${shortDay(day)} para ${name}`} onClick={() => onNew(day)}
                        className="flex min-h-8 w-full items-center justify-center rounded-lg text-ink/25 hover:bg-cream hover:text-ink">
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Card({ event, showDate, onSelect }: { event: AgendaEvent; showDate?: boolean; onSelect: (e: AgendaEvent) => void }) {
  const cfg = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.tarefa;
  const status = statusConfig(event.status);
  const done = isAgendaDone(event.status);
  const cancelled = isAgendaCancelled(event.status);
  const people = eventPeople(event);
  return (
    <button type="button" onClick={() => onSelect(event)}
      className={`flex w-full overflow-hidden rounded-xl border bg-surface text-left shadow-sm transition hover:shadow-md ${done || cancelled ? "opacity-60" : ""}`}>
      <span aria-hidden="true" className={`w-1.5 shrink-0 ${cfg.bar}`} />
      <span className="block min-w-0 flex-1 space-y-1 p-2">
        <span className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">{showDate ? `${shortDay(eventDay(event))} · ` : ""}{time(event.starts_at)}</span>
          <span className={`truncate text-[11px] font-semibold ${cfg.color}`}>{TYPE_CONFIG[event.type]?.label ?? "Outros"}</span>
        </span>
        <span className={`block break-words text-sm font-semibold leading-snug ${cancelled ? "line-through" : ""}`}>{event.client_name || event.title}</span>
        {event.client_name && event.title !== event.client_name && <span className="line-clamp-2 text-xs text-ink/55">{event.title}</span>}
        <span className="flex items-center gap-1 text-xs text-ink/60">
          <User className="h-3 w-3 shrink-0" />
          <span className={`truncate ${people.length ? "" : "italic text-ink/40"}`}>{people.join(", ") || NO_PERSON}</span>
        </span>
        {event.team_name && (
          <span className="flex items-center gap-1 text-xs text-ink/60">
            <Truck className="h-3 w-3 shrink-0" />
            <span className="truncate">{[event.team_name, event.vehicle_name].filter(Boolean).join(" · ")}</span>
          </span>
        )}
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.color}`}>
          {done && <Check className="h-3 w-3" />}{status.label}
        </span>
      </span>
    </button>
  );
}
