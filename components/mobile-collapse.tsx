"use client";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

/** No celular os filtros ficam atrás de um botão (menos letra na tela); no PC o conteúdo aparece sempre. */
export function MobileCollapse({ label = "Filtros", count = 0, children }: { label?: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mc" data-open={open ? "true" : "false"}>
      <button type="button" className="mc-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <SlidersHorizontal size={18} />{label}{count > 0 && <b className="mc-count">{count}</b>}<ChevronDown size={18} className="mc-chevron" />
      </button>
      <div className="mc-body">{children}</div>
    </div>
  );
}
