"use client";

import { useId } from "react";

export function MeasureCallBefore({ interactive = true }: { interactive?: boolean }) {
  const name = useId();

  return (
    <fieldset className="measure-card min-w-0" aria-label="Ligar antes de ir?">
      <p className="measure-card-label">LIGAR ANTES DE IR?</p>
      <div className="measure-card-value mt-1 flex flex-wrap gap-x-2 gap-y-1">
        {["Sim", "Não"].map(option => (
          <label key={option} className="inline-flex items-center gap-1">
            <input type="radio" name={name} value={option} disabled={!interactive}
              className="h-3 w-3 shrink-0 appearance-none rounded-sm border border-black checked:bg-black" />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
