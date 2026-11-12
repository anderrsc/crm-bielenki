"use client";

import { useEffect, useState, useId } from "react";
import { searchClientOptions } from "@/app/(crm)/client-options-actions";

type Option = { id: string; name: string };
const emptyOptions: Option[] = [];
export function ClientSelect({ items = emptyOptions, value, onChange, name, required = true }: {
  items?: Option[]; value?: string; onChange?: (id: string) => void; name?: string; required?: boolean;
}) {
  const [localValue, setLocalValue] = useState("");
  const selectedId = value ?? localValue;
  const [selected, setSelected] = useState<Option | undefined>(() => items.find(item => item.id === selectedId));
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(items);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const selectId = useId();

  useEffect(() => {
    if (!selectedId || selected?.id === selectedId) return;
    const existing = items.find(item => item.id === selectedId);
    if (existing) { setSelected(existing); return; }
    let current = true;
    searchClientOptions("", selectedId).then(result => {
      if (current) { setSelected(result.items[0]); setError(result.error); }
    }).catch(() => { if (current) setError("Não foi possível consultar o cliente."); });
    return () => { current = false; };
  }, [selectedId, selected?.id, items]);

  useEffect(() => {
    if (!query.trim()) { setOptions(items); setLoading(false); setError(undefined); return; }
    let current = true;
    setLoading(true);
    const timer = setTimeout(() => {
      searchClientOptions(query).then(result => {
        if (current) { setOptions(result.items); setError(result.error); setLoading(false); }
      }).catch(() => { if (current) { setError("Não foi possível buscar os clientes."); setLoading(false); } });
    }, 300);
    return () => { current = false; clearTimeout(timer); };
  }, [query, items]);

  const visible = selected && selected.id === selectedId && !options.some(item => item.id === selectedId) ? [selected, ...options] : options;
  return <div className="space-y-2">
    <input className="field" type="search" aria-label="Buscar cliente por nome ou telefone" placeholder="Buscar cliente por nome ou telefone…" value={query} onChange={event => setQuery(event.target.value)} aria-controls={selectId} />
    <select id={selectId} className="field" aria-label="Cliente" name={name} required={required} value={selectedId} onChange={event => {
      const id = event.target.value;
      setSelected(visible.find(item => item.id === id)); setLocalValue(id); onChange?.(id);
    }}>
      <option value="">{required ? "Selecione o cliente" : "Sem vínculo"}</option>
      {selectedId && !visible.some(item => item.id === selectedId) && <option value={selectedId}>Cliente selecionado</option>}
      {visible.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    <p role="status" className="text-xs text-ink/55">{error ?? (loading ? "Buscando clientes…" : query && !options.length ? "Nenhum cliente encontrado." : "Digite para buscar outros clientes.")}</p>
  </div>;
}
