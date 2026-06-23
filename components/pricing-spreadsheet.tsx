"use client";

import { useState, useCallback, useRef, useTransition, useMemo } from "react";
import {
  Save, Plus, Trash2, Download, Upload, Search, Filter,
  ChevronDown, ChevronUp, Check, X, AlertTriangle, RefreshCw,
  TrendingUp, ToggleLeft, ToggleRight
} from "lucide-react";
import { bulkSavePrices, deletePriceRow, addPriceRow } from "@/app/(crm)/pricing-actions";

/* ─── Tipos ──────────────────────────────────────────────────────────────── */
export type PriceRow = {
  id: string;
  product: string;
  category: string;
  thickness: string;
  cut_mm: number;
  unit: string;
  color: string | null;
  unit_price: number;
  labor_price: number;
  paint_price: number;
  install_price: number;
  freight_price: number;
  min_price: number;
  margin_pct: number;
  max_discount_pct: number;
  notes: string | null;
  active: boolean;
};

/* ─── Listas de referência ───────────────────────────────────────────────── */
export const CATEGORIES = [
  "Calhas Padrão",
  "Rufos e Pingadeiras",
  "Condutores e Acessórios",
  "Itens Especiais",
  "Mão de Obra",
  "Pintura",
  "Frete e Deslocamento",
  "Manutenção",
];

const THICKNESSES = ["0.5mm","0.6mm","0.7mm","1.0mm"];
const UNITS = ["metro","peça","unidade","hora","serviço","diária","kg","m²"];
const COLORS = ["Natural","Branco","Preto","Grafite","Marrom","Bronze","Cinza","Areia","Outra"];

const COLS: { key: keyof PriceRow; label: string; width: string; type: "text"|"number"|"select"|"bool"; options?: string[] }[] = [
  { key:"product",          label:"Produto",        width:"180px", type:"text" },
  { key:"category",         label:"Categoria",      width:"150px", type:"select", options: CATEGORIES },
  { key:"thickness",        label:"Esp.",            width:"80px",  type:"select", options: THICKNESSES },
  { key:"cut_mm",           label:"Corte (mm)",      width:"90px",  type:"number" },
  { key:"unit",             label:"Un.",             width:"90px",  type:"select", options: UNITS },
  { key:"unit_price",       label:"R$/metro",        width:"100px", type:"number" },
  { key:"labor_price",      label:"Mão de Obra",     width:"100px", type:"number" },
  { key:"paint_price",      label:"Pintura",         width:"100px", type:"number" },
  { key:"install_price",    label:"Instalação",      width:"100px", type:"number" },
  { key:"freight_price",    label:"Frete",           width:"100px", type:"number" },
  { key:"min_price",        label:"Mín.",            width:"90px",  type:"number" },
  { key:"margin_pct",       label:"Margem%",         width:"90px",  type:"number" },
  { key:"max_discount_pct", label:"Desc. máx.%",     width:"90px",  type:"number" },
  { key:"notes",            label:"Obs.",            width:"160px", type:"text" },
  { key:"active",           label:"Ativo",           width:"60px",  type:"bool" },
];

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const money = (v: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(v);
const pct = (v: number) => `${v}%`;
const newId = () => `new-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/* ─── Componente principal ───────────────────────────────────────────────── */
export function PricingSpreadsheet({
  initialRows,
  canManage,
}: {
  initialRows: PriceRow[];
  canManage: boolean;
}) {
  const [rows, setRows] = useState<PriceRow[]>(initialRows);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [editCell, setEditCell] = useState<{ id: string; col: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [catFilter, setCatFilter] = useState<string>("Todos");
  const [sortCol, setSortCol] = useState<keyof PriceRow>("category");
  const [sortAsc, setSortAsc] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [saveResult, setSaveResult] = useState<{ ok?: boolean; error?: string } | null>(null);
  const [massModal, setMassModal] = useState(false);
  const [massPct, setMassPct] = useState(0);
  const [massField, setMassField] = useState<"unit_price"|"labor_price">("unit_price");
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── Filtros e sort ── */
  const visible = useMemo(() => {
    let r = rows.filter(r => !deleted.has(r.id));
    if (catFilter !== "Todos") r = r.filter(x => x.category === catFilter);
    if (filter) {
      const q = filter.toLowerCase();
      r = r.filter(x => x.product.toLowerCase().includes(q) || (x.notes ?? "").toLowerCase().includes(q));
    }
    r = [...r].sort((a, b) => {
      const av = a[sortCol] ?? 0;
      const bv = b[sortCol] ?? 0;
      const cmp = String(av).localeCompare(String(bv), "pt-BR", { numeric: true });
      return sortAsc ? cmp : -cmp;
    });
    return r;
  }, [rows, deleted, catFilter, filter, sortCol, sortAsc]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { Todos: rows.filter(r => !deleted.has(r.id)).length };
    for (const cat of CATEGORIES) c[cat] = rows.filter(r => !deleted.has(r.id) && r.category === cat).length;
    return c;
  }, [rows, deleted]);

  /* ── Edição de célula ── */
  const updateCell = useCallback((id: string, col: keyof PriceRow, val: unknown) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [col]: val } : r));
    setDirty(prev => new Set([...prev, id]));
  }, []);

  /* ── Adicionar linha ── */
  const addRow = useCallback(() => {
    const blank: PriceRow = {
      id: newId(), product: "Novo produto", category: CATEGORIES[0],
      thickness: "0.50", cut_mm: 200, unit: "metro", color: null,
      unit_price: 0, labor_price: 0, paint_price: 0,
      install_price: 0, freight_price: 0, min_price: 0,
      margin_pct: 0, max_discount_pct: 0, notes: null, active: true,
    };
    setRows(prev => [blank, ...prev]);
    setDirty(prev => new Set([...prev, blank.id]));
    setEditCell({ id: blank.id, col: "product" });
  }, []);

  /* ── Deletar linha ── */
  const deleteRow = useCallback((id: string) => {
    if (id.startsWith("new-")) {
      setRows(prev => prev.filter(r => r.id !== id));
    } else {
      setDeleted(prev => new Set([...prev, id]));
    }
    setDirty(prev => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  /* ── Ajuste em massa ── */
  const applyMass = useCallback(() => {
    if (!massPct) return;
    const factor = 1 + massPct / 100;
    setRows(prev => prev.map(r => {
      if (catFilter !== "Todos" && r.category !== catFilter) return r;
      const updated = { ...r, [massField]: Math.round((r[massField] as number) * factor * 100) / 100 };
      setDirty(d => new Set([...d, r.id]));
      return updated;
    }));
    setMassModal(false);
  }, [massPct, massField, catFilter]);

  /* ── Salvar ── */
  const handleSave = () => {
    const toSave = rows.filter(r => dirty.has(r.id));
    const toDelete = [...deleted].filter(id => !id.startsWith("new-"));
    if (!toSave.length && !toDelete.length) return;
    setSaveResult(null);
    startTransition(async () => {
      const result = await bulkSavePrices(toSave, toDelete);
      if (result?.error) { setSaveResult({ error: result.error }); return; }
      setSaveResult({ ok: true });
      setDirty(new Set());
      setDeleted(new Set());
      setTimeout(() => setSaveResult(null), 3000);
    });
  };

  /* ── Export CSV ── */
  const exportCSV = () => {
    const header = COLS.map(c => c.label).join(";");
    const bodyRows = visible.map(r =>
      COLS.map(c => {
        const v = r[c.key];
        if (v === null || v === undefined) return "";
        if (typeof v === "number" && ["unit_price","labor_price","paint_price","install_price","freight_price","min_price"].includes(c.key))
          return money(v).replace(".", "").replace(",", ".");
        return String(v).replace(/;/g, ",");
      }).join(";")
    ).join("\n");
    const blob = new Blob(["﻿" + header + "\n" + bodyRows], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "tabela-precos.csv"; a.click();
  };

  /* ── Sort header ── */
  const handleSort = (col: keyof PriceRow) => {
    if (sortCol === col) setSortAsc(v => !v);
    else { setSortCol(col); setSortAsc(true); }
  };

  /* ── Render ── */
  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Busca */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/35" />
          <input className="field pl-9 h-9 text-sm" placeholder="Buscar produto..." value={filter}
            onChange={e => setFilter(e.target.value)} />
        </div>

        {/* Filtro de categoria */}
        <select className="field h-9 text-sm min-w-[220px]" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="Todos">Todos ({counts.Todos})</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c} ({counts[c] ?? 0})</option>)}
        </select>

        <div className="flex-1" />

        {canManage && (
          <>
            {/* Ajuste em massa */}
            <button onClick={() => setMassModal(true)}
              className="flex items-center gap-1.5 rounded-xl border border-sand bg-white px-3 h-9 text-sm font-semibold hover:bg-cream">
              <TrendingUp className="h-4 w-4" /> Reajuste
            </button>
            {/* CSV export */}
            <button onClick={exportCSV}
              className="flex items-center gap-1.5 rounded-xl border border-sand bg-white px-3 h-9 text-sm font-semibold hover:bg-cream">
              <Download className="h-4 w-4" /> Exportar
            </button>
            {/* Novo */}
            <button onClick={addRow}
              className="flex items-center gap-1.5 rounded-xl border border-sand bg-white px-3 h-9 text-sm font-semibold hover:bg-cream">
              <Plus className="h-4 w-4" /> Novo
            </button>
            {/* Salvar */}
            <button onClick={handleSave} disabled={isPending || (!dirty.size && !deleted.size)}
              className={`flex items-center gap-1.5 rounded-xl px-4 h-9 text-sm font-bold text-white transition-all disabled:opacity-40
                ${dirty.size || deleted.size ? "bg-forest hover:bg-[#18221e] shadow-md" : "bg-ink/25"}`}>
              <Save className="h-4 w-4" />
              {isPending ? "Salvando..." : `Salvar${dirty.size ? ` (${dirty.size})` : ""}`}
            </button>
          </>
        )}
      </div>

      {/* Feedback */}
      {saveResult?.ok && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
          <Check className="h-4 w-4" /> Alterações salvas com sucesso.
        </div>
      )}
      {saveResult?.error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {saveResult.error}
        </div>
      )}
      {(dirty.size > 0 || deleted.size > 0) && !saveResult && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          {dirty.size > 0 && `${dirty.size} linha${dirty.size > 1 ? "s" : ""} com alterações não salvas`}
          {dirty.size > 0 && deleted.size > 0 && " · "}
          {deleted.size > 0 && `${deleted.size} linha${deleted.size > 1 ? "s" : ""} marcadas para exclusão`}
        </div>
      )}

      {/* ── Tabela estilo planilha ── */}
      <div className="overflow-auto rounded-2xl border shadow-sm" style={{ maxHeight: "70vh" }}>
        <table className="text-left text-xs" style={{ minWidth: COLS.reduce((s, c) => s + parseInt(c.width), 0) + 80 }}>
          <thead className="sticky top-0 z-10 bg-cream/95 backdrop-blur">
            <tr>
              {COLS.map(col => (
                <th key={col.key}
                  onClick={() => handleSort(col.key as keyof PriceRow)}
                  style={{ width: col.width, minWidth: col.width }}
                  className="cursor-pointer select-none border-b px-3 py-2.5 font-bold uppercase tracking-wider text-ink/50 hover:text-ink transition-colors whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortCol === col.key && (sortAsc
                      ? <ChevronUp className="h-3 w-3 text-forest" />
                      : <ChevronDown className="h-3 w-3 text-forest" />)}
                  </div>
                </th>
              ))}
              {canManage && <th className="border-b px-2 py-2.5 w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y bg-white">
            {visible.map((row, ri) => (
              <tr key={row.id}
                className={`group transition-colors hover:bg-lime/5 ${dirty.has(row.id) ? "bg-amber-50/60" : ""} ${!row.active ? "opacity-50" : ""}`}>
                {COLS.map(col => (
                  <CellEditor key={col.key} row={row} col={col} canManage={canManage}
                    isEditing={editCell?.id === row.id && editCell.col === col.key}
                    onStartEdit={() => canManage && setEditCell({ id: row.id, col: col.key })}
                    onEndEdit={() => setEditCell(null)}
                    onChange={val => updateCell(row.id, col.key as keyof PriceRow, val)}
                  />
                ))}
                {canManage && (
                  <td className="border-l px-2">
                    <button onClick={() => deleteRow(row.id)}
                      className="rounded-lg p-1.5 text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 transition-all">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={COLS.length + 1} className="py-12 text-center text-ink/40">
                Nenhum produto encontrado.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-ink/40">
        <span>{visible.length} de {rows.length - deleted.size} itens</span>
        <span>Clique em qualquer célula para editar · Alt+Enter confirma</span>
      </div>

      {/* ── Modal de reajuste em massa ── */}
      {massModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMassModal(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-black">Reajuste em massa</h2>
            {catFilter !== "Todos" && (
              <p className="mb-3 rounded-lg bg-blue-50 p-2 text-xs text-blue-700">
                Aplicar apenas em: <strong>{catFilter}</strong>
              </p>
            )}
            <div className="space-y-4">
              <div>
                <label className="label">Campo a reajustar</label>
                <select className="field" value={massField} onChange={e => setMassField(e.target.value as typeof massField)}>
                  <option value="unit_price">Preço por metro</option>
                  <option value="labor_price">Mão de Obra</option>
                  <option value="paint_price">Pintura</option>
                  <option value="install_price">Instalação</option>
                  <option value="freight_price">Frete</option>
                </select>
              </div>
              <div>
                <label className="label">Percentual de reajuste</label>
                <div className="flex items-center gap-2">
                  <input type="number" className="field flex-1" placeholder="Ex: 10 (aumento) ou -5 (redução)"
                    value={massPct} onChange={e => setMassPct(Number(e.target.value))} />
                  <span className="font-bold text-ink/60">%</span>
                </div>
                {massPct !== 0 && (
                  <p className="mt-1 text-xs text-ink/50">
                    {massPct > 0 ? `+${massPct}% de aumento` : `${massPct}% de redução`}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setMassModal(false)} className="button-ghost flex-1">Cancelar</button>
              <button onClick={applyMass} disabled={!massPct} className="button flex-1">
                Aplicar reajuste
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── CellEditor ─────────────────────────────────────────────────────────── */
function CellEditor({
  row, col, canManage, isEditing, onStartEdit, onEndEdit, onChange,
}: {
  row: PriceRow;
  col: typeof COLS[0];
  canManage: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onChange: (val: unknown) => void;
}) {
  const val = row[col.key as keyof PriceRow];
  const numericCols = ["unit_price","labor_price","paint_price","install_price","freight_price","min_price","margin_pct","max_discount_pct","cut_mm"];
  const pctCols = ["margin_pct","max_discount_pct"];

  const display = () => {
    if (col.type === "bool") return null;
    if (val === null || val === undefined || val === "") return <span className="text-ink/25">—</span>;
    if (typeof val === "number") {
      if (pctCols.includes(col.key)) return <span className="font-mono">{pct(val)}</span>;
      if (numericCols.includes(col.key) && col.key !== "cut_mm") return <span className="font-mono font-bold text-forest">{money(val)}</span>;
      return <span className="font-mono">{String(val)}</span>;
    }
    return <span className="truncate">{String(val)}</span>;
  };

  if (col.type === "bool") {
    return (
      <td style={{ width: col.width }} className="px-3 py-1.5 text-center">
        <button disabled={!canManage} onClick={() => { onChange(!val); }}
          className={`transition-colors ${val ? "text-forest" : "text-ink/25"}`}>
          {val ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
        </button>
      </td>
    );
  }

  if (isEditing && canManage) {
    const commit = (v: unknown) => { onChange(v); onEndEdit(); };
    return (
      <td style={{ width: col.width }} className="p-0">
        {col.type === "select" ? (
          <select autoFocus className="w-full border-2 border-forest bg-white px-2 py-1 text-xs outline-none rounded"
            defaultValue={String(val ?? "")}
            onChange={e => commit(e.target.value)}
            onBlur={e => commit(e.target.value)}>
            {col.options!.map(o => <option key={o}>{o}</option>)}
          </select>
        ) : (
          <input autoFocus type={col.type === "number" ? "number" : "text"}
            step={col.type === "number" ? "0.01" : undefined}
            defaultValue={String(val ?? "")}
            className="w-full border-2 border-forest bg-white px-2 py-1 text-xs font-mono outline-none rounded"
            onBlur={e => commit(col.type === "number" ? Number(e.target.value) : e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === "Tab") commit(col.type === "number" ? Number((e.target as HTMLInputElement).value) : (e.target as HTMLInputElement).value);
              if (e.key === "Escape") onEndEdit();
            }}
          />
        )}
      </td>
    );
  }

  return (
    <td style={{ width: col.width }} className="px-3 py-1.5 max-w-[180px]"
      onClick={canManage ? onStartEdit : undefined}
      title={canManage ? "Clique para editar" : undefined}>
      <div className={`overflow-hidden text-ellipsis whitespace-nowrap text-xs ${canManage ? "cursor-pointer" : ""}`}>
        {display()}
      </div>
    </td>
  );
}
