"use client";

import { useState } from "react";

/* Linha extra da ficha de medidas: tipo de serviço e observações.
   Na tela dá para digitar a observação; na impressão sai o texto (ou linhas em branco). */
export function MeasureExtraRow() {
  const [notes, setNotes] = useState("");
  const text = notes.trim();
  return (
    <section className="measure-grid measure-grid-extra">
      <fieldset className="measure-card min-w-0" aria-label="Tipo de serviço">
        <p className="measure-card-label">TIPO DE SERVIÇO</p>
        <div className="measure-card-value mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {["Calhas", "Esquadrias"].map(option => (
            <label key={option} className="inline-flex items-center gap-1">
              <input type="checkbox" value={option}
                className="h-3 w-3 shrink-0 appearance-none rounded-sm border border-black checked:bg-black" />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="measure-card min-w-0">
        <span className="measure-card-label block">OBSERVAÇÕES</span>
        <input className="measure-card-value measure-obs-input print:hidden" maxLength={140} value={notes}
          placeholder="Digite aqui antes de imprimir (opcional)" onChange={event => setNotes(event.target.value)} />
        <span className="hidden print:block">
          {text
            ? <span className="measure-card-value measure-obs-text">{text}</span>
            : <span className="measure-card-line block" />}
        </span>
      </label>
    </section>
  );
}
