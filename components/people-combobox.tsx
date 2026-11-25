"use client";
import { useState, useRef, useEffect } from "react";

type Person = { id: string; full_name: string };

export function PeopleCombobox({
  people,
  name,
  label = "Funcionário",
  defaultValue = "",
  required = false,
}: {
  people: Person[];
  name: string;
  label?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const defaultPerson = people.find((p) => p.id === defaultValue);
  const [query, setQuery] = useState(defaultPerson?.full_name ?? "");
  const [selectedId, setSelectedId] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? people.filter((p) => p.full_name.toLowerCase().includes(query.toLowerCase()))
    : people;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        // Se o texto não bate com nenhum selecionado, reseta
        if (!selectedId) setQuery("");
        else {
          const p = people.find((x) => x.id === selectedId);
          if (p) setQuery(p.full_name);
        }
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [selectedId, people]);

  function select(p: Person) {
    setSelectedId(p.id);
    setQuery(p.full_name);
    setOpen(false);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setSelectedId("");
    setOpen(true);
  }

  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={selectedId} />
      <div ref={containerRef} className="relative">
        <input
          className="field"
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={() => setOpen(true)}
          placeholder="Digite para buscar…"
          autoComplete="off"
          required={required && !selectedId}
        />
        {open && filtered.length > 0 && (
          <ul className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-[var(--border,#e4e4e7)] bg-white shadow-lg text-sm">
            {filtered.map((p) => (
              <li
                key={p.id}
                onMouseDown={() => select(p)}
                className="cursor-pointer px-3 py-2 hover:bg-[var(--bg-raised,#f4f4f5)]"
              >
                {p.full_name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </label>
  );
}
