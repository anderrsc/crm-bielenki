"use client";
import { Search, X } from "lucide-react";
import { TYPE_CONFIG } from "@/components/agenda-event-style";
import { EMPTY_FILTERS, NOBODY, hasFilters, type AgendaFilters, type StatusFilter } from "@/lib/service-board";

const STATUS_OPTIONS: Array<[StatusFilter, string]> = [
  ["ativos", "Pendentes"], ["concluido", "Concluídos"], ["cancelado", "Cancelados"], ["todos", "Todos"],
];

export function AgendaFilterBar({ filters, options, types, onChange }: {
  filters: AgendaFilters;
  options: { people: string[]; teams: string[] };
  /** Tipos presentes na agenda, com a quantidade de cada um. */
  types: Array<[string, number]>;
  onChange: (next: AgendaFilters) => void;
}) {
  const set = (patch: Partial<AgendaFilters>) => onChange({ ...filters, ...patch });
  const toggleType = (type: string) =>
    set({ types: filters.types.includes(type) ? filters.types.filter((t) => t !== type) : [...filters.types, type] });

  return (
    <section aria-label="Filtros da agenda" className="card mb-4 space-y-3 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="label">Buscar</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
            <input className="field" style={{ paddingLeft: 36 }} value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Cliente ou serviço" />
          </span>
        </label>
        <label className="block">
          <span className="label">Funcionário</span>
          <select className="field" value={filters.person} onChange={(e) => set({ person: e.target.value })}>
            <option value="">Todos os funcionários</option>
            {options.people.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value={NOBODY}>Sem funcionário definido</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Equipe</span>
          <select className="field" value={filters.team} onChange={(e) => set({ team: e.target.value })}>
            <option value="">Todas as equipes</option>
            {options.teams.map((t) => <option key={t} value={t}>{t}</option>)}
            <option value={NOBODY}>Sem equipe escalada</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Situação</span>
          <select className="field" value={filters.status} onChange={(e) => set({ status: e.target.value as StatusFilter })}>
            {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tipo de serviço">
        {types.map(([type, count]) => {
          const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.tarefa;
          const on = filters.types.includes(type);
          return (
            <button key={type} type="button" aria-pressed={on} onClick={() => toggleType(type)}
              className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${on ? `${cfg.bg} ${cfg.color}` : "border-sand text-ink/70 hover:bg-cream"}`}>
              <i aria-hidden="true" className={`h-2 w-2 rounded-full ${cfg.bar}`} />
              {TYPE_CONFIG[type]?.label ?? "Outros"} <span className="opacity-60">{count}</span>
            </button>
          );
        })}
        {hasFilters(filters) && (
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="inline-flex min-h-9 items-center gap-1 px-2 text-xs font-semibold text-forest underline">
            <X className="h-3.5 w-3.5" /> Limpar filtros
          </button>
        )}
      </div>
    </section>
  );
}
