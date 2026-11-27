"use client";
import { useState } from "react";
import type { AgendaEvent } from "@/components/agenda-page";
import { NO_PERSON, eventDay, type AgendaMove } from "@/lib/service-board";

/** O mesmo que arrastar o cartão, para quem usa celular ou teclado. */
export function AgendaMoveForm({ event, people, onMove }: {
  event: AgendaEvent; people: string[]; onMove: (change: AgendaMove) => void;
}) {
  const currentDay = eventDay(event);
  const currentPerson = event.responsible_name?.trim() ?? "";
  const [day, setDay] = useState(currentDay);
  const [person, setPerson] = useState(currentPerson);
  const options = [...new Set([...people, currentPerson].filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const unchanged = day === currentDay && person === currentPerson;
  return (
    <form aria-label="Reagendar compromisso" className="grid gap-2 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!day || unchanged) return;
        onMove({ ...(day !== currentDay && { day }), ...(person !== currentPerson && { person: person || null }) });
      }}>
      <label className="block"><span className="label">Nova data</span>
        <input type="date" className="field" required value={day} onChange={(e) => setDay(e.target.value)} />
      </label>
      <label className="block"><span className="label">Novo responsável</span>
        <select className="field" value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">{NO_PERSON}</option>
          {options.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <button type="submit" className="button sm:col-span-2" disabled={!day || unchanged}>Salvar mudança (mantém o horário)</button>
    </form>
  );
}
