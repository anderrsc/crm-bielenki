"use client";

import { useEffect, useState, useCallback, useTransition } from "react";
import { ChevronLeft, ChevronRight, Plus, X, Calendar, Clock, User, Tag, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { createAgendaEvent, updateAgendaEventStatus, getAgendaEvents } from "@/app/(crm)/agenda-actions";

/* ─── Tipos ──────────────────────────────────────────────────────────────── */
export type AgendaEvent = {
  id: string;
  type: "medicao" | "instalacao" | "producao" | "compra" | "reuniao" | "venda" | "pos_venda" | "tarefa" | "lembrete";
  title: string;
  subtitle?: string | null;
  client_name?: string | null;
  starts_at: string;
  ends_at?: string | null;
  status: string;
  responsible_name?: string | null;
  description?: string | null;
};

type View = "mes" | "semana" | "dia";

/* ─── Config de tipos ────────────────────────────────────────────────────── */
const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  medicao:    { label: "Medição",        color: "text-blue-700",   bg: "bg-blue-100 border-blue-300" },
  instalacao: { label: "Instalação",     color: "text-green-700",  bg: "bg-green-100 border-green-300" },
  producao:   { label: "Produção",       color: "text-orange-700", bg: "bg-orange-100 border-orange-300" },
  compra:     { label: "Compra",         color: "text-amber-700",  bg: "bg-amber-100 border-amber-300" },
  reuniao:    { label: "Reunião",        color: "text-purple-700", bg: "bg-purple-100 border-purple-300" },
  venda:      { label: "Venda",          color: "text-emerald-700",bg: "bg-emerald-100 border-emerald-300" },
  pos_venda:  { label: "Pós-venda",      color: "text-teal-700",   bg: "bg-teal-100 border-teal-300" },
  tarefa:     { label: "Tarefa",         color: "text-gray-700",   bg: "bg-gray-100 border-gray-300" },
  lembrete:   { label: "Lembrete",       color: "text-pink-700",   bg: "bg-pink-100 border-pink-300" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  agendado:     { label: "Agendado",    color: "bg-blue-50 text-blue-700" },
  confirmado:   { label: "Confirmado",  color: "bg-green-50 text-green-700" },
  em_andamento: { label: "Em andamento",color: "bg-amber-50 text-amber-700" },
  concluido:    { label: "Concluído",   color: "bg-emerald-50 text-emerald-700" },
  reagendado:   { label: "Reagendado",  color: "bg-orange-50 text-orange-700" },
  cancelado:    { label: "Cancelado",   color: "bg-red-50 text-red-700" },
};

const DAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d: Date) { const r = new Date(d); r.setDate(d.getDate() - d.getDay()); return r; }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }
function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function eventDate(e: AgendaEvent) { return new Date(e.starts_at); }
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
function fmtDate(iso: string) { const d = new Date(iso); return `${DAYS_PT[d.getDay()]}, ${d.getDate()} ${MONTHS_PT[d.getMonth()]} ${d.getFullYear()}`; }

/* ─── Componente principal ───────────────────────────────────────────────── */
export function AgendaPage({ initialEvents }: { initialEvents: AgendaEvent[] }) {
  const [view, setView] = useState<View>("mes");
  const [cursor, setCursor] = useState(new Date());
  const [events, setEvents] = useState<AgendaEvent[]>(initialEvents);
  const [selected, setSelected] = useState<AgendaEvent | null>(null);
  const [createFor, setCreateFor] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    startTransition(async () => {
      const data = await getAgendaEvents();
      setEvents(data);
      setLoading(false);
    });
  }, []);

  const navigate = (n: number) => {
    setCursor(prev => {
      const d = new Date(prev);
      if (view === "mes")    d.setMonth(d.getMonth() + n);
      if (view === "semana") d.setDate(d.getDate() + n * 7);
      if (view === "dia")    d.setDate(d.getDate() + n);
      return d;
    });
  };

  const titleLabel = () => {
    if (view === "mes") return `${MONTHS_PT[cursor.getMonth()]} ${cursor.getFullYear()}`;
    if (view === "semana") {
      const start = startOfWeek(cursor);
      const end = addDays(start, 6);
      return `${start.getDate()} ${MONTHS_PT[start.getMonth()]} — ${end.getDate()} ${MONTHS_PT[end.getMonth()]} ${end.getFullYear()}`;
    }
    return fmtDate(cursor.toISOString());
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* ── Header ── */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Operação</p>
          <h1 className="mt-1 text-3xl font-black">Agenda</h1>
          <p className="mt-1 text-sm text-ink/50">Medições, instalações, reuniões e tarefas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View selector */}
          <div className="flex rounded-xl border bg-white">
            {(["mes","semana","dia"] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-2 text-sm font-semibold capitalize transition-colors first:rounded-l-xl last:rounded-r-xl ${view===v?"bg-forest text-white":"text-ink/60 hover:bg-cream"}`}>
                {v === "mes" ? "Mês" : v === "semana" ? "Semana" : "Dia"}
              </button>
            ))}
          </div>
          {/* Navigation */}
          <div className="flex items-center gap-1 rounded-xl border bg-white">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-cream rounded-l-xl"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => setCursor(new Date())} className="px-3 py-2 text-sm font-semibold hover:bg-cream">Hoje</button>
            <button onClick={() => navigate(1)} className="p-2 hover:bg-cream rounded-r-xl"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <button onClick={() => setCreateFor(ymd(cursor))}
            className="flex items-center gap-2 rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white hover:bg-[#18221e]">
            <Plus className="h-4 w-4" /> Novo evento
          </button>
          <button onClick={reload} className={`p-2 rounded-xl border bg-white hover:bg-cream ${loading?"opacity-50":""}`}>
            <RefreshCw className={`h-4 w-4 ${loading?"animate-spin":""}`} />
          </button>
        </div>
      </div>

      {/* ── Título do período ── */}
      <p className="mb-4 text-lg font-black text-ink">{titleLabel()}</p>

      {/* ── Grid ── */}
      {view === "mes"    && <MonthView    cursor={cursor} events={events} onDayClick={setCreateFor} onEventClick={setSelected} />}
      {view === "semana" && <WeekView     cursor={cursor} events={events} onDayClick={setCreateFor} onEventClick={setSelected} />}
      {view === "dia"    && <DayView      cursor={cursor} events={events} onEventClick={setSelected} onNewEvent={setCreateFor} />}

      {/* ── Modais ── */}
      {selected && (
        <EventModal event={selected} onClose={() => setSelected(null)}
          onStatusChange={async (id, status) => {
            await updateAgendaEventStatus(id, status);
            reload();
            setSelected(null);
          }} />
      )}
      {createFor && (
        <CreateEventModal date={createFor} onClose={() => setCreateFor(null)}
          onCreated={() => { reload(); setCreateFor(null); }} />
      )}
    </div>
  );
}

/* ─── Visualização: Mês ──────────────────────────────────────────────────── */
function MonthView({ cursor, events, onDayClick, onEventClick }:
  { cursor: Date; events: AgendaEvent[]; onDayClick: (d: string) => void; onEventClick: (e: AgendaEvent) => void }) {
  const today = new Date();
  const first = startOfMonth(cursor);
  const start = startOfWeek(first);
  const cells: Date[] = Array.from({ length: 42 }, (_, i) => addDays(start, i));

  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b bg-cream">
        {DAYS_PT.map(d => <div key={d} className="py-2 text-center text-xs font-bold text-ink/50 uppercase tracking-wider">{d}</div>)}
      </div>
      {/* Weeks */}
      <div className="grid grid-cols-7 divide-x divide-y">
        {cells.map((day, i) => {
          const isCurrentMonth = day.getMonth() === cursor.getMonth();
          const isToday = sameDay(day, today);
          const dayEvents = events.filter(e => sameDay(eventDate(e), day));
          return (
            <div key={i} onClick={() => onDayClick(ymd(day))}
              className={`min-h-[110px] p-2 cursor-pointer transition-colors hover:bg-lime/10 ${!isCurrentMonth ? "bg-gray-50/70" : ""}`}>
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold transition-colors
                ${isToday ? "bg-forest text-white" : isCurrentMonth ? "text-ink" : "text-ink/30"}`}>
                {day.getDate()}
              </span>
              <div className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 3).map(e => (
                  <EventChip key={e.id} event={e} onClick={ev => { ev.stopPropagation(); onEventClick(e); }} />
                ))}
                {dayEvents.length > 3 && (
                  <p className="text-xs text-ink/40 font-medium pl-1">+{dayEvents.length - 3} mais</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Visualização: Semana ───────────────────────────────────────────────── */
function WeekView({ cursor, events, onDayClick, onEventClick }:
  { cursor: Date; events: AgendaEvent[]; onDayClick: (d: string) => void; onEventClick: (e: AgendaEvent) => void }) {
  const today = new Date();
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const hours = Array.from({ length: 13 }, (_, i) => i + 7); // 7h–19h

  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      {/* Day headers */}
      <div className="grid grid-cols-8 border-b bg-cream">
        <div className="py-3" />
        {days.map((d, i) => {
          const isToday = sameDay(d, today);
          return (
            <div key={i} className="py-3 text-center">
              <p className="text-xs font-bold text-ink/40 uppercase">{DAYS_PT[d.getDay()]}</p>
              <span onClick={() => onDayClick(ymd(d))}
                className={`mt-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-lg font-black transition-colors hover:bg-lime/20
                  ${isToday ? "bg-forest text-white" : "text-ink"}`}>
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>
      {/* Time grid */}
      <div className="overflow-y-auto max-h-[600px]">
        {hours.map(h => (
          <div key={h} className="grid grid-cols-8 border-b">
            <div className="py-2 pr-3 text-right text-xs text-ink/35 font-medium">{h}:00</div>
            {days.map((d, di) => {
              const dayEvents = events.filter(e => {
                const ed = eventDate(e);
                return sameDay(ed, d) && ed.getHours() === h;
              });
              return (
                <div key={di} onClick={() => onDayClick(ymd(d))}
                  className="min-h-[52px] border-l p-1 cursor-pointer hover:bg-lime/10 transition-colors">
                  {dayEvents.map(e => (
                    <EventChip key={e.id} event={e} onClick={ev => { ev.stopPropagation(); onEventClick(e); }} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Visualização: Dia ──────────────────────────────────────────────────── */
function DayView({ cursor, events, onEventClick, onNewEvent }:
  { cursor: Date; events: AgendaEvent[]; onEventClick: (e: AgendaEvent) => void; onNewEvent: (d: string) => void }) {
  const dayEvents = events.filter(e => sameDay(eventDate(e), cursor));
  const hours = Array.from({ length: 14 }, (_, i) => i + 6);

  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="border-b bg-cream px-6 py-3 flex items-center justify-between">
        <p className="font-bold text-ink">{fmtDate(cursor.toISOString())}</p>
        <p className="text-sm text-ink/50">{dayEvents.length} evento{dayEvents.length !== 1 ? "s" : ""}</p>
      </div>
      {/* All-day / sem horário */}
      {dayEvents.filter(e => !e.starts_at.includes("T") || e.starts_at.endsWith("00:00:00+00")).map(e => (
        <div key={e.id} onClick={() => onEventClick(e)} className="border-b px-6 py-3 cursor-pointer hover:bg-lime/10">
          <EventChip event={e} />
        </div>
      ))}
      {/* Hourly slots */}
      <div className="overflow-y-auto max-h-[600px]">
        {hours.map(h => {
          const slotEvents = dayEvents.filter(e => eventDate(e).getHours() === h);
          return (
            <div key={h} className="flex border-b min-h-[60px]" onClick={() => onNewEvent(ymd(cursor))}>
              <div className="w-20 shrink-0 py-2 pr-3 text-right text-xs text-ink/35 font-medium">{h}:00</div>
              <div className="flex-1 border-l p-2 cursor-pointer hover:bg-lime/10 transition-colors space-y-1">
                {slotEvents.map(e => (
                  <div key={e.id} onClick={ev => { ev.stopPropagation(); onEventClick(e); }}>
                    <EventChip event={e} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── EventChip ──────────────────────────────────────────────────────────── */
function EventChip({ event, onClick }: { event: AgendaEvent; onClick?: (e: React.MouseEvent) => void }) {
  const cfg = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.tarefa;
  const cancelled = event.status === "cancelado";
  return (
    <div onClick={onClick}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold border cursor-pointer transition-opacity hover:opacity-80 ${cfg.bg} ${cfg.color} ${cancelled ? "opacity-40 line-through" : ""}`}>
      <span className="truncate max-w-[140px]">
        {event.starts_at.includes("T") ? fmtTime(event.starts_at) + " " : ""}{event.title}
      </span>
    </div>
  );
}

/* ─── Modal: Visualizar evento ───────────────────────────────────────────── */
function EventModal({ event, onClose, onStatusChange }:
  { event: AgendaEvent; onClose: () => void; onStatusChange: (id: string, status: string) => void }) {
  const cfg = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.tarefa;
  const statusCfg = STATUS_CONFIG[event.status] ?? { label: event.status, color: "bg-gray-100 text-gray-700" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className={`rounded-t-2xl px-6 py-4 ${cfg.bg}`}>
          <div className="flex items-start justify-between">
            <div>
              <span className={`text-xs font-bold uppercase tracking-widest ${cfg.color}`}>{cfg.label}</span>
              <h2 className="mt-1 text-xl font-black text-ink">{event.title}</h2>
              {event.subtitle && <p className="mt-0.5 text-sm text-ink/60">{event.subtitle}</p>}
            </div>
            <button onClick={onClose} className="rounded-xl p-1.5 hover:bg-black/10"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="space-y-3 px-6 py-4">
          {event.client_name && (
            <Row icon={<User className="h-4 w-4" />} label="Cliente" value={event.client_name} />
          )}
          <Row icon={<Clock className="h-4 w-4" />} label="Data/hora" value={
            fmtDate(event.starts_at) + (event.starts_at.includes("T") ? " às " + fmtTime(event.starts_at) : "")
          } />
          {event.responsible_name && (
            <Row icon={<User className="h-4 w-4" />} label="Responsável" value={event.responsible_name} />
          )}
          {event.description && (
            <Row icon={<Tag className="h-4 w-4" />} label="Descrição" value={event.description} />
          )}
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-ink/40" />
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusCfg.color}`}>{statusCfg.label}</span>
          </div>
        </div>
        {/* Ações rápidas */}
        <div className="flex flex-wrap gap-2 border-t px-6 py-4">
          {event.status !== "concluido" && (
            <button onClick={() => onStatusChange(event.id, "concluido")}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100">
              <CheckCircle2 className="h-4 w-4" /> Concluir
            </button>
          )}
          {event.status !== "cancelado" && (
            <button onClick={() => onStatusChange(event.id, "cancelado")}
              className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100">
              <XCircle className="h-4 w-4" /> Cancelar
            </button>
          )}
          {event.status === "agendado" && (
            <button onClick={() => onStatusChange(event.id, "confirmado")}
              className="flex items-center gap-1.5 rounded-xl bg-green-50 px-3 py-2 text-xs font-bold text-green-700 hover:bg-green-100">
              <CheckCircle2 className="h-4 w-4" /> Confirmar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-ink/40 shrink-0">{icon}</span>
      <div>
        <p className="text-xs font-bold text-ink/40 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium text-ink">{value}</p>
      </div>
    </div>
  );
}

/* ─── Modal: Criar evento ────────────────────────────────────────────────── */
function CreateEventModal({ date, onClose, onCreated }: { date: string; onClose: () => void; onCreated: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError("");
    startTransition(async () => {
      const result = await createAgendaEvent(fd);
      if (result?.error) { setError(result.error); return; }
      onCreated();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between rounded-t-2xl bg-forest px-6 py-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-white/70" />
            <h2 className="text-lg font-black text-white">Novo evento</h2>
          </div>
          <button onClick={onClose} className="rounded-xl p-1.5 hover:bg-white/10"><X className="h-5 w-5 text-white" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Título *</label>
              <input className="field" name="title" required placeholder="Ex: Medição João da Silva" />
            </div>
            <div>
              <label className="label">Tipo *</label>
              <select className="field" name="type" required>
                {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="field" name="status">
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Data *</label>
              <input className="field" name="date" type="date" defaultValue={date} required />
            </div>
            <div>
              <label className="label">Horário</label>
              <input className="field" name="time" type="time" defaultValue="08:00" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Cliente (opcional)</label>
              <input className="field" name="client_name" placeholder="Nome do cliente" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Responsável</label>
              <input className="field" name="responsible_name" placeholder="Nome do responsável" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Descrição</label>
              <textarea className="field" name="description" rows={2} placeholder="Observações sobre o evento" />
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <button type="button" onClick={onClose} className="button-ghost">Cancelar</button>
            <button type="submit" disabled={isPending} className="button">
              {isPending ? "Salvando..." : "Criar evento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
