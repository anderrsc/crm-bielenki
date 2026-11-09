"use client";

import { useState, useTransition } from "react";
import { Ruler, UserCheck } from "lucide-react";
import { updateQuoteTeam } from "@/app/(crm)/actions";

type Person = { id: string; full_name: string | null };

// Medidor e atendente responsável pela obra. Uso interno: não sai no PDF.
const NEW = "__novo";
const OUT = "nome:";

export function QuoteTeamFields({ quoteId, people, measurerId, measurerName = null, outsideMeasurers = [], attendantId }: {
  quoteId: string; people: Person[]; measurerId: string | null; measurerName?: string | null; outsideMeasurers?: string[]; attendantId: string | null;
}) {
  const [values, setValues] = useState({ measurer_id: measurerName ? OUT + measurerName : measurerId ?? "", attendant_id: attendantId ?? "" });
  const [outside, setOutside] = useState(() => [...new Set([...(measurerName ? [measurerName] : []), ...outsideMeasurers])]);
  const [typing, setTyping] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function save(field: "measurer_id" | "attendant_id", value: string) {
    const previous = values[field];
    setValues((v) => ({ ...v, [field]: value }));
    setMessage("");
    const fd = new FormData();
    fd.set("quote_id", quoteId);
    const external = field === "measurer_id" && value.startsWith(OUT);
    fd.set("field", external ? "measurer_name" : field);
    fd.set("profile_id", external ? value.slice(OUT.length) : value);
    startTransition(async () => {
      const result = await updateQuoteTeam(fd);
      if (result.error) {
        setValues((v) => ({ ...v, [field]: previous }));
        setMessage(result.error);
      } else setMessage("Salvo.");
    });
  }

  function adicionar() {
    const name = (typing ?? "").replace(/\s+/g, " ").trim();
    if (!name) return setTyping(null);
    setOutside((o) => (o.includes(name) ? o : [...o, name].sort((a, b) => a.localeCompare(b, "pt-BR"))));
    setTyping(null);
    save("measurer_id", OUT + name);
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
        onChange={(e) => e.target.value === NEW ? setTyping("") : save(field, e.target.value)}
      >
        <option value="">Não definido</option>
        {options(values[field].startsWith(OUT) ? "" : values[field]).map((p) => <option key={p.id} value={p.id}>{p.full_name || "Sem nome"}</option>)}
        {field === "measurer_id" && outside.map((n) => <option key={n} value={OUT + n}>{n} (de fora)</option>)}
        {field === "measurer_id" && <option value={NEW}>+ Outro medidor (sem usuário)…</option>}
      </select>
      {field === "measurer_id" && typing !== null && (
        <span className="mt-2 flex gap-2">
          <input autoFocus value={typing} onChange={(e) => setTyping(e.target.value)} placeholder="Nome do medidor" className="field min-w-0 flex-1 p-2 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } if (e.key === "Escape") setTyping(null); }} />
          <button type="button" onClick={adicionar} className="rounded-xl bg-forest px-3 text-xs font-bold text-white">Salvar</button>
        </span>
      )}
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
