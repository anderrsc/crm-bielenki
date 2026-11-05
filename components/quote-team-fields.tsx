"use client";

import { useState, useTransition } from "react";
import { Ruler, UserCheck } from "lucide-react";
import { updateQuoteTeam } from "@/app/(crm)/actions";

type Person = { id: string; full_name: string | null };

// Medidor e atendente responsável pela obra. Uso interno: não sai no PDF.
export function QuoteTeamFields({ quoteId, people, measurerId, attendantId }: { quoteId: string; people: Person[]; measurerId: string | null; attendantId: string | null }) {
  const [values, setValues] = useState({ measurer_id: measurerId ?? "", attendant_id: attendantId ?? "" });
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function save(field: "measurer_id" | "attendant_id", value: string) {
    const previous = values[field];
    setValues((v) => ({ ...v, [field]: value }));
    setMessage("");
    const fd = new FormData();
    fd.set("quote_id", quoteId);
    fd.set("field", field);
    fd.set("profile_id", value);
    startTransition(async () => {
      const result = await updateQuoteTeam(fd);
      if (result.error) {
        setValues((v) => ({ ...v, [field]: previous }));
        setMessage(result.error);
      } else setMessage("Salvo.");
    });
  }

  // Mantém na lista quem já estava escolhido, mesmo se ficou inativo.
  const options = (current: string) => current && !people.some((p) => p.id === current) ? [{ id: current, full_name: "(funcionário inativo)" }, ...people] : people;

  const select = (field: "measurer_id" | "attendant_id", label: string, Icon: typeof Ruler) => (
    <label className="min-w-0 flex-1 basis-56">
      <span className="label flex items-center gap-1.5"><Icon size={14} />{label}</span>
      <select
        name={field}
        className="field mt-2 w-full p-2 text-sm"
        value={values[field]}
        disabled={pending}
        onChange={(e) => save(field, e.target.value)}
      >
        <option value="">Não definido</option>
        {options(values[field]).map((p) => <option key={p.id} value={p.id}>{p.full_name || "Sem nome"}</option>)}
      </select>
    </label>
  );

  return (
    <section className="card no-print mb-6 p-5" aria-label="Equipe da obra">
      <h2 className="text-sm font-bold">Equipe da obra · somente a equipe</h2>
      <div className="mt-3 flex flex-wrap gap-4">
        {select("measurer_id", "Medidor", Ruler)}
        {select("attendant_id", "Atendente responsável", UserCheck)}
      </div>
      {message && <p className="mt-3 text-xs" role="status">{message}</p>}
    </section>
  );
}
