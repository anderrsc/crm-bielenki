"use client";
import { useState, type DragEvent } from "react";
import Link from "next/link";
import { Check, Plus, Truck, User } from "lucide-react";
import type { AgendaEvent } from "@/components/agenda-page";
import { TYPE_CONFIG, statusConfig } from "@/components/agenda-event-style";
import { isAgendaDone } from "@/lib/agenda-location";
import { SERVICE_STATUS } from "@/lib/service-orders";
import { NO_PERSON, WEEKDAYS, canMoveEvent, eventDay, eventPeople, eventTime, isAgendaCancelled, overdueEvents, pendingKey, type AgendaMove, type PendingService } from "@/lib/service-board";

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const byStart = (a: AgendaEvent, b: AgendaEvent) => Date.parse(a.starts_at) - Date.parse(b.starts_at);
export const eventKey = (e: Pick<AgendaEvent, "source" | "id">) => `${e.source}:${e.id}`;
const DRAG_TYPE = "agenda-card";

type Handlers = { onSelect: (e: AgendaEvent) => void; onNew: (day: string) => void };
type Move = (event: AgendaEvent, change: AgendaMove) => void;
/** Onde o cartão foi solto. `row` é o funcionário da linha, na visão por funcionário. */
type Target = { day?: string; row?: string };
type Dropped = Target & { key: string; from?: string };
type Drag = {
  over: string; saving: string[];
  zone: (id: string, target: Target) => {
    onDragOver: (e: DragEvent) => void; onDragLeave: (e: DragEvent) => void; onDrop: (e: DragEvent) => void;
  };
  end: () => void;
};

/** Quadro de serviços: uma coluna por dia (como o quadro da oficina) e os atrasados na frente. */
export function AgendaBoard({ events, pending = [], days, today, saving = [], onSelect, onNew, onMove, onSchedule }: Handlers & {
  /** Já filtrados por funcionário, equipe, tipo, situação e busca. */
  events: AgendaEvent[];
  days: string[];
  today: string;
  /** Cartões com mudança ainda sendo gravada. */
  saving?: string[];
  onMove: Move;
  /** Serviços sem visita marcada (já filtrados): aparecem na coluna "Sem data". */
  pending?: PendingService[];
  onSchedule?: (service: PendingService, change: AgendaMove) => void;
}) {
  const [group, setGroup] = useState<"dia" | "pessoa">("dia");
  const [over, setOver] = useState("");
  const [warning, setWarning] = useState("");
  const inRange = new Set(days);
  const visible = events.filter((e) => inRange.has(eventDay(e))).sort(byStart);
  const late = overdueEvents(events, today).sort(byStart);
  // Domingo só ocupa espaço quando tem serviço.
  const columns = days.filter((d) => days.length === 1 || weekday(d) !== 0 || d === today || visible.some((e) => eventDay(e) === d));
  // O que já está na coluna de atrasados não se repete no dia.
  const lateSet = new Set(late);
  const onDay = (list: AgendaEvent[], day: string) => list.filter((e) => eventDay(e) === day && !lateSet.has(e));

  const drop = ({ key, from, day, row }: Dropped) => {
    const service = pending.find((s) => pendingKey(s) === key);
    if (service) {
      if (!day) return;
      const change: AgendaMove = { day };
      if (row && from && row !== from) {
        if (row === NO_PERSON) { setWarning("Para deixar este serviço sem responsável, altere em Serviços."); return; }
        change.person = row;
      }
      setWarning("");
      onSchedule?.(service, change);
      return;
    }
    const event = events.find((e) => eventKey(e) === key);
    if (!event) return;
    const change: AgendaMove = {};
    // Atrasado solto no próprio dia (ou cartão solto onde já estava) não muda nada.
    if (day && day !== eventDay(event)) change.day = day;
    const responsible = event.responsible_name?.trim() || null;
    if (row && from && row !== from) {
      const target = row === NO_PERSON ? null : row;
      if (from !== NO_PERSON && from !== responsible) {
        // Está na linha pela escala: trocar o responsável não tiraria a pessoa do serviço.
        if (target !== responsible) { setWarning(`${from} está nesse serviço pela escala da equipe. Para trocar, use Equipes e veículos.`); return; }
      } else if (target !== responsible) change.person = target;
    }
    setWarning("");
    if (change.day !== undefined || change.person !== undefined) onMove(event, change);
  };

  const drag: Drag = {
    over, saving,
    end: () => setOver(""),
    zone: (id, target) => ({
      onDragOver: (e) => { if (!e.dataTransfer.types.includes(DRAG_TYPE)) return; e.preventDefault(); setOver(id); },
      onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === id ? "" : o)); },
      onDrop: (e) => {
        setOver("");
        const data = e.dataTransfer.getData(DRAG_TYPE);
        if (!data) return;
        e.preventDefault();
        drop({ ...(JSON.parse(data) as { key: string; from?: string }), ...target });
      },
    }),
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink/60">
          <strong className="text-ink">{visible.length}</strong> {visible.length === 1 ? "serviço" : "serviços"} no período
          {late.length > 0 && <> · <strong className="text-red-600">{late.length}</strong> {late.length === 1 ? "atrasado" : "atrasados"}</>}
          {pending.length > 0 && <> · <strong className="text-amber-700">{pending.length}</strong> sem data</>}
          <span className="hidden md:inline"> · arraste um cartão para {group === "dia" ? "reagendar" : "trocar o dia ou o responsável"}</span>
        </p>
        <div className="flex rounded-xl border bg-surface" role="group" aria-label="Organizar quadro">
          {([["dia", "Por data"], ["pessoa", "Por funcionário"]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={group === value} onClick={() => { setGroup(value); setWarning(""); }}
              className={`min-h-9 px-3 text-xs font-semibold first:rounded-l-xl last:rounded-r-xl ${group === value ? "bg-brand-strong text-white" : "text-ink/60 hover:bg-cream"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {warning && <p role="alert" className="mb-3 rounded-xl bg-amber-500/15 p-3 text-sm text-ink">{warning}</p>}
      {group === "dia"
        ? <ByDay pending={pending} late={late} columns={columns} today={today} cards={(day) => onDay(visible, day)} drag={drag} onSelect={onSelect} onNew={onNew} />
        : <ByPerson pending={pending} late={late} visible={visible} columns={columns} today={today} onDay={onDay} drag={drag} onSelect={onSelect} onNew={onNew} />}
    </div>
  );
}

function ByDay({ pending, late, columns, today, cards, drag, onSelect, onNew }: Handlers & { pending: PendingService[];
  late: AgendaEvent[]; columns: string[]; today: string; cards: (day: string) => AgendaEvent[]; drag: Drag;
}) {
  return (
    <div data-testid="agenda-board" className="flex flex-col gap-3 md:flex-row md:items-stretch md:overflow-x-auto md:pb-3">
      {/* Atrasados não aceita soltar: não é uma data. */}
      {late.length > 0 && (
        <section aria-label="Atrasados" className="flex shrink-0 flex-col rounded-2xl border border-red-300 bg-red-50/40 md:w-52">
          <header className="flex items-center justify-between rounded-t-2xl bg-red-600 px-3 py-2 text-white">
            <h2 className="text-sm font-semibold">Atrasados</h2>
            <span className="rounded-full bg-white/20 px-2 text-xs font-semibold">{late.length}</span>
          </header>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
            {late.map((e) => <Card key={eventKey(e)} event={e} showDate drag={drag} onSelect={onSelect} />)}
          </div>
        </section>
      )}
      {pending.length > 0 && (
        <section aria-label="Sem data" className="flex shrink-0 flex-col rounded-2xl border border-amber-300 bg-amber-500/10 md:w-52">
          <header className="flex items-center justify-between rounded-t-2xl bg-amber-600 px-3 py-2 text-white">
            <h2 className="text-sm font-semibold">Sem data</h2>
            <span className="rounded-full bg-white/20 px-2 text-xs font-semibold">{pending.length}</span>
          </header>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
            {pending.map((s) => <ServiceCard key={s.id} service={s} today={today} drag={drag} />)}
          </div>
        </section>
      )}
      {columns.map((day) => {
        const list = cards(day);
        const isToday = day === today;
        const label = `${WEEKDAYS[weekday(day)]} ${shortDay(day)}`;
        return (
          <section key={day} aria-label={label} {...drag.zone(day, { day })}
            className={`flex min-w-0 flex-1 flex-col rounded-2xl border bg-surface transition md:min-w-[165px] ${drag.over === day ? "border-forest ring-2 ring-forest/40" : isToday ? "border-brand-strong ring-1 ring-brand-strong" : ""}`}>
            <header className={`flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2 ${isToday ? "bg-brand-strong text-white" : "bg-cream"}`}>
              <div>
                <h2 className="text-sm font-semibold">{WEEKDAYS[weekday(day)]}{isToday ? " · hoje" : ""}</h2>
                <p className={`text-xs ${isToday ? "text-white/80" : "text-ink/50"}`}>{shortDay(day)} · {list.length}</p>
              </div>
              <button type="button" aria-label={`Agendar em ${label}`} onClick={() => onNew(day)} className="rounded-lg p-2 hover:bg-black/10">
                <Plus className="h-4 w-4" />
              </button>
            </header>
            <div className="max-h-[70vh] min-h-28 flex-1 space-y-2 overflow-y-auto p-2">
              {list.map((e) => <Card key={eventKey(e)} event={e} drag={drag} onSelect={onSelect} />)}
              {!list.length && <p className="py-4 text-center text-xs text-ink/35">Livre</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ByPerson({ pending, late, visible, columns, today, onDay, drag, onSelect, onNew }: Handlers & { pending: PendingService[];
  late: AgendaEvent[]; visible: AgendaEvent[]; columns: string[]; today: string; drag: Drag;
  onDay: (list: AgendaEvent[], day: string) => AgendaEvent[];
}) {
  const names = (e: AgendaEvent | PendingService) => { const p = eventPeople(e); return p.length ? p : [NO_PERSON]; };
  // Serviço com mais de uma pessoa aparece na linha de cada uma.
  const rows = [...new Set([...late, ...pending, ...visible].flatMap(names))]
    .sort((a, b) => Number(a === NO_PERSON) - Number(b === NO_PERSON) || a.localeCompare(b, "pt-BR"));
  if (!rows.length) return <p className="card p-8 text-center text-sm text-ink/50">Nenhum serviço neste período.</p>;
  const ring = (id: string) => (drag.over === id ? "ring-2 ring-inset ring-forest/60" : "");
  return (
    <div data-testid="agenda-board" className="overflow-auto rounded-2xl border bg-surface">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-cream">
            <th scope="col" className="sticky left-0 z-10 min-w-[130px] border-b border-r bg-cream p-3 text-xs font-semibold">Funcionário</th>
            {late.length > 0 && <th scope="col" className="min-w-[190px] border-b border-r bg-red-600 p-3 text-xs font-semibold !text-white">Atrasados</th>}
            {pending.length > 0 && <th scope="col" className="min-w-[190px] border-b border-r bg-amber-600 p-3 text-xs font-semibold !text-white">Sem data</th>}
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
            const lateId = `late|${name}`;
            return (
              <tr key={name} className="align-top">
                <th scope="row" className="sticky left-0 z-10 border-b border-r bg-surface p-3 text-sm font-semibold">{name}</th>
                {late.length > 0 && (
                  // Aqui só troca o responsável: a data continua a mesma.
                  <td {...drag.zone(lateId, { row: name })} className={`space-y-2 border-b border-r bg-red-50/40 p-2 ${ring(lateId)}`}>
                    {late.filter(mine).map((e) => <Card key={eventKey(e)} event={e} row={name} showDate drag={drag} onSelect={onSelect} />)}
                  </td>
                )}
                {pending.length > 0 && (
                  <td className="space-y-2 border-b border-r bg-amber-500/10 p-2">
                    {pending.filter((s) => names(s).includes(name)).map((s) => <ServiceCard key={s.id} service={s} row={name} today={today} drag={drag} />)}
                  </td>
                )}
                {columns.map((day) => {
                  const id = `${day}|${name}`;
                  return (
                    <td key={day} aria-label={`${name}, ${shortDay(day)}`} {...drag.zone(id, { day, row: name })} className={`border-b border-r p-2 ${ring(id)}`}>
                      <div className="space-y-2">
                        {onDay(visible.filter(mine), day).map((e) => <Card key={eventKey(e)} event={e} row={name} drag={drag} onSelect={onSelect} />)}
                        <button type="button" aria-label={`Agendar em ${shortDay(day)} para ${name}`} onClick={() => onNew(day)}
                          className="flex min-h-8 w-full items-center justify-center rounded-lg text-ink/25 hover:bg-cream hover:text-ink">
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Serviço sem visita marcada: arraste para um dia, ou abra para agendar com horário (celular e teclado). */
function ServiceCard({ service, row, today, drag }: { service: PendingService; row?: string; today: string; drag: Drag }) {
  const cfg = TYPE_CONFIG[service.type] ?? TYPE_CONFIG.tarefa;
  const saving = drag.saving.includes(pendingKey(service));
  const late = !!service.expected_date && service.expected_date < today;
  return (
    <div draggable={!saving} aria-busy={saving || undefined} onDragEnd={drag.end}
      onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ key: pendingKey(service), from: row }))}>
      <Link href={`/servicos/${service.id}`} draggable={false}
        className={`flex w-full cursor-grab overflow-hidden rounded-xl border bg-surface text-left shadow-sm transition hover:shadow-md active:cursor-grabbing ${service.priority === "urgente" ? "border-red-400" : ""} ${saving ? "opacity-60" : ""}`}>
        <span aria-hidden="true" className={`w-1.5 shrink-0 ${cfg.bar}`} />
        <span className="block min-w-0 flex-1 space-y-1 p-2">
          <span className={`block text-[11px] font-semibold ${cfg.color}`}>{service.kind_label}</span>
          <span className="block break-words text-sm font-semibold leading-snug">{service.client_name || service.title}</span>
          <span className="line-clamp-2 text-xs text-ink/55">{service.title}</span>
          <span className="flex items-center gap-1 text-xs text-ink/60">
            <User className="h-3 w-3 shrink-0" />
            <span className={`truncate ${service.responsible_name ? "" : "italic text-ink/40"}`}>{service.responsible_name || NO_PERSON}</span>
          </span>
          {service.expected_date && <span className={`block text-xs ${late ? "font-semibold text-red-700" : "text-ink/60"}`}>Previsto {shortDay(service.expected_date)}{late ? " · atrasado" : ""}</span>}
          {service.priority === "urgente" && <span className="block text-xs font-semibold text-red-700">Urgente</span>}
          <span className="inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold">{saving ? "Salvando…" : SERVICE_STATUS[service.status] ?? service.status}</span>
        </span>
      </Link>
    </div>
  );
}

function Card({ event, row, showDate, drag, onSelect }: { event: AgendaEvent; row?: string; showDate?: boolean; drag: Drag; onSelect: (e: AgendaEvent) => void }) {
  const cfg = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.tarefa;
  const status = statusConfig(event.status);
  const done = isAgendaDone(event.status);
  const cancelled = isAgendaCancelled(event.status);
  const people = eventPeople(event);
  const saving = drag.saving.includes(eventKey(event));
  const movable = canMoveEvent(event) && !saving;
  return (
    <div draggable={movable} aria-busy={saving || undefined} onDragEnd={drag.end}
      onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ key: eventKey(event), from: row }))}>
      <button type="button" onClick={() => onSelect(event)}
        className={`flex w-full overflow-hidden rounded-xl border bg-surface text-left shadow-sm transition hover:shadow-md ${movable ? "cursor-grab active:cursor-grabbing" : ""} ${done || cancelled || saving ? "opacity-60" : ""}`}>
        <span aria-hidden="true" className={`w-1.5 shrink-0 ${cfg.bar}`} />
        <span className="block min-w-0 flex-1 space-y-1 p-2">
          <span className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">{showDate ? `${shortDay(eventDay(event))} · ` : ""}{eventTime(event.starts_at)}</span>
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
            {done && <Check className="h-3 w-3" />}{saving ? "Salvando…" : status.label}
          </span>
        </span>
      </button>
    </div>
  );
}
