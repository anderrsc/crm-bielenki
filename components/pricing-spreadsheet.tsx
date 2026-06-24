"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Check, Plus, Save, Search, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { bulkSavePrices } from "@/app/(crm)/pricing-actions";
import {
  gutterCategories,
  gutterColors,
  gutterPricingUnits,
  gutterThicknesses,
  gutterCategoryForProduct,
  gutterItemTypeForCategory,
  isAluminumCondutor,
  isFabricationCategory,
  isPvcCondutor,
} from "@/lib/gutters";

export type PriceRow = {
  id: string;
  product: string;
  category: string;
  item_type?: string | null;
  thickness: string | null;
  cut_mm: number | null;
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

export const CATEGORIES = [...gutterCategories];

const COLS: { key: keyof PriceRow; label: string; width: string; type: "text" | "number" | "select" | "bool"; options?: readonly string[] }[] = [
  { key: "product", label: "Produto", width: "220px", type: "text" },
  { key: "category", label: "Categoria", width: "150px", type: "select", options: CATEGORIES },
  { key: "thickness", label: "Esp.", width: "90px", type: "select", options: gutterThicknesses },
  { key: "cut_mm", label: "C/ mm", width: "90px", type: "number" },
  { key: "unit", label: "Un.", width: "120px", type: "select", options: gutterPricingUnits },
  { key: "color", label: "Cor", width: "160px", type: "select", options: gutterColors },
  { key: "unit_price", label: "Valor", width: "100px", type: "number" },
  { key: "install_price", label: "Instalação", width: "100px", type: "number" },
  { key: "labor_price", label: "Mão de Obra", width: "100px", type: "number" },
  { key: "paint_price", label: "Pintura", width: "100px", type: "number" },
  { key: "freight_price", label: "Frete", width: "100px", type: "number" },
  { key: "min_price", label: "Mín.", width: "90px", type: "number" },
  { key: "margin_pct", label: "Margem%", width: "90px", type: "number" },
  { key: "max_discount_pct", label: "Desc. máx.%", width: "90px", type: "number" },
  { key: "notes", label: "Obs.", width: "180px", type: "text" },
  { key: "active", label: "Ativo", width: "70px", type: "bool" },
];

const money = (v: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(v);
const newId = () => `new-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function validCategory(category?: string | null) {
  return CATEGORIES.includes(category as (typeof CATEGORIES)[number]);
}

function fieldHidden(row: PriceRow, key: keyof PriceRow) {
  if (!["thickness", "cut_mm", "color"].includes(String(key))) return false;
  if (row.category === "Acessórios" || row.category === "Serviços" || row.category === "Itens Especiais") return true;
  if (row.category === "Condutores") {
    if (key === "cut_mm") return true;
    if (key === "thickness") return !isAluminumCondutor(row.product) || isPvcCondutor(row.product);
    if (key === "color") return isPvcCondutor(row.product);
  }
  return false;
}

function normalizeRow(row: PriceRow): PriceRow {
  const category = validCategory(row.category) ? row.category : gutterCategoryForProduct(row.product);
  const next: PriceRow = {
    ...row,
    category,
    item_type: gutterItemTypeForCategory(category),
    unit: row.unit || (isFabricationCategory(category) ? "Metro Linear (m)" : "Unidade"),
  };
  if (isFabricationCategory(category)) {
    next.thickness = next.thickness || "0.50 mm";
    next.cut_mm = Number(next.cut_mm) || 300;
    next.color = next.color || "Aluminio Natural";
  } else {
    next.cut_mm = null;
    if (category !== "Condutores" || !isAluminumCondutor(next.product)) next.thickness = null;
    if (category !== "Condutores" || isPvcCondutor(next.product)) next.color = null;
  }
  if (fieldHidden(next, "thickness")) next.thickness = null;
  if (fieldHidden(next, "cut_mm")) next.cut_mm = null;
  if (fieldHidden(next, "color")) next.color = null;
  return next;
}

function emptyRow(): PriceRow {
  return {
    id: newId(),
    product: "Calha de Beiral",
    category: "Calhas",
    item_type: "fabricacao",
    thickness: "0.50 mm",
    cut_mm: 300,
    unit: "Metro Linear (m)",
    color: "Aluminio Natural",
    unit_price: 0,
    labor_price: 0,
    paint_price: 0,
    install_price: 0,
    freight_price: 0,
    min_price: 0,
    margin_pct: 0,
    max_discount_pct: 0,
    notes: null,
    active: true,
  };
}

export function PricingSpreadsheet({ initialRows, canManage }: { initialRows: PriceRow[]; canManage: boolean }) {
  const [rows, setRows] = useState<PriceRow[]>(() => initialRows.map(normalizeRow));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [editCell, setEditCell] = useState<{ id: string; col: keyof PriceRow } | null>(null);
  const [filter, setFilter] = useState("");
  const [catFilter, setCatFilter] = useState("Todos");
  const [saveResult, setSaveResult] = useState<{ ok?: boolean; error?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return rows
      .filter((row) => !deleted.has(row.id))
      .filter((row) => catFilter === "Todos" || row.category === catFilter)
      .filter((row) => !query || row.product.toLowerCase().includes(query) || (row.notes ?? "").toLowerCase().includes(query))
      .sort((a, b) => `${a.category}-${a.product}`.localeCompare(`${b.category}-${b.product}`, "pt-BR", { numeric: true }));
  }, [rows, deleted, catFilter, filter]);

  const counts = useMemo(() => {
    const activeRows = rows.filter((row) => !deleted.has(row.id));
    const result: Record<string, number> = { Todos: activeRows.length };
    for (const category of CATEGORIES) result[category] = activeRows.filter((row) => row.category === category).length;
    return result;
  }, [rows, deleted]);

  const updateCell = (id: string, col: keyof PriceRow, value: unknown) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? normalizeRow({ ...row, [col]: value } as PriceRow) : row))
    );
    setDirty((current) => new Set([...current, id]));
  };

  const addRow = () => {
    const row = emptyRow();
    setRows((current) => [row, ...current]);
    setDirty((current) => new Set([...current, row.id]));
    setEditCell({ id: row.id, col: "product" });
  };

  const deleteRow = (id: string) => {
    if (id.startsWith("new-")) setRows((current) => current.filter((row) => row.id !== id));
    else setDeleted((current) => new Set([...current, id]));
    setDirty((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const handleSave = () => {
    const toSave = rows.filter((row) => dirty.has(row.id)).map(normalizeRow);
    const toDelete = [...deleted].filter((id) => !id.startsWith("new-"));
    if (!toSave.length && !toDelete.length) return;
    setSaveResult(null);
    startTransition(async () => {
      const result = await bulkSavePrices(toSave, toDelete);
      if (result?.error) {
        setSaveResult({ error: result.error });
        return;
      }
      setSaveResult({ ok: true });
      setDirty(new Set());
      setDeleted(new Set());
      setTimeout(() => setSaveResult(null), 3000);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/35" />
          <input className="field h-9 pl-9 text-sm" placeholder="Buscar produto..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <select className="field h-9 min-w-[220px] text-sm" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="Todos">Todos ({counts.Todos})</option>
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category} ({counts[category] ?? 0})
            </option>
          ))}
        </select>
        <div className="flex-1" />
        {canManage && (
          <>
            <button onClick={addRow} className="flex h-9 items-center gap-1.5 rounded-xl border border-sand bg-white px-3 text-sm font-semibold hover:bg-cream">
              <Plus className="h-4 w-4" /> Novo
            </button>
            <button
              onClick={handleSave}
              disabled={isPending || (!dirty.size && !deleted.size)}
              className={`flex h-9 items-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white transition-all disabled:opacity-40 ${
                dirty.size || deleted.size ? "bg-forest hover:bg-[#18221e] shadow-md" : "bg-ink/25"
              }`}
            >
              <Save className="h-4 w-4" />
              {isPending ? "Salvando..." : `Salvar${dirty.size ? ` (${dirty.size})` : ""}`}
            </button>
          </>
        )}
      </div>

      {saveResult?.ok && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <Check className="h-4 w-4" /> Alterações salvas com sucesso.
        </div>
      )}
      {saveResult?.error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {saveResult.error}
        </div>
      )}
      {(dirty.size > 0 || deleted.size > 0) && !saveResult && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          {dirty.size} alteração(ões) e {deleted.size} exclusão(ões) pendentes
        </div>
      )}

      <div className="overflow-auto rounded-2xl border shadow-sm" style={{ maxHeight: "70vh" }}>
        <table className="text-left text-xs" style={{ minWidth: COLS.reduce((sum, col) => sum + parseInt(col.width), 0) + 80 }}>
          <thead className="sticky top-0 z-10 bg-cream/95 backdrop-blur">
            <tr>
              {COLS.map((col) => (
                <th key={col.key} style={{ width: col.width, minWidth: col.width }} className="border-b px-3 py-2.5 font-bold uppercase tracking-wider text-ink/50">
                  {col.label}
                </th>
              ))}
              {canManage && <th className="w-10 border-b px-2 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y bg-white">
            {visible.map((row) => (
              <tr key={row.id} className={`group transition-colors hover:bg-lime/5 ${dirty.has(row.id) ? "bg-amber-50/60" : ""} ${!row.active ? "opacity-50" : ""}`}>
                {COLS.map((col) => (
                  <CellEditor
                    key={col.key}
                    row={row}
                    col={col}
                    canManage={canManage}
                    isEditing={editCell?.id === row.id && editCell.col === col.key}
                    onStartEdit={() => canManage && setEditCell({ id: row.id, col: col.key })}
                    onEndEdit={() => setEditCell(null)}
                    onChange={(value) => updateCell(row.id, col.key, value)}
                  />
                ))}
                {canManage && (
                  <td className="border-l px-2">
                    <button onClick={() => deleteRow(row.id)} className="rounded-lg p-1.5 text-red-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 1} className="py-12 text-center text-ink/40">
                  Nenhum produto encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-ink/40">
        <span>
          {visible.length} de {rows.length - deleted.size} itens
        </span>
        <span>Campos não aplicáveis ficam bloqueados automaticamente.</span>
      </div>
    </div>
  );
}

function CellEditor({
  row,
  col,
  canManage,
  isEditing,
  onStartEdit,
  onEndEdit,
  onChange,
}: {
  row: PriceRow;
  col: (typeof COLS)[number];
  canManage: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onChange: (val: unknown) => void;
}) {
  const val = row[col.key];
  const numericMoney = ["unit_price", "labor_price", "paint_price", "install_price", "freight_price", "min_price"];
  const numericPercent = ["margin_pct", "max_discount_pct"];

  if (fieldHidden(row, col.key)) {
    return (
      <td style={{ width: col.width }} className="px-3 py-1.5 text-ink/25">
        -
      </td>
    );
  }

  if (col.type === "bool") {
    return (
      <td style={{ width: col.width }} className="px-3 py-1.5 text-center">
        <button disabled={!canManage} onClick={() => onChange(!val)} className={`transition-colors ${val ? "text-forest" : "text-ink/25"}`}>
          {val ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
        </button>
      </td>
    );
  }

  if (isEditing && canManage) {
    const commit = (raw: string) => {
      if (col.type === "number") onChange(raw === "" ? null : Number(raw));
      else onChange(raw);
      onEndEdit();
    };
    return (
      <td style={{ width: col.width }} className="p-0">
        {col.type === "select" ? (
          <select
            autoFocus
            className="w-full rounded border-2 border-forest bg-white px-2 py-1 text-xs outline-none"
            defaultValue={String(val ?? "")}
            onChange={(e) => commit(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
          >
            {col.options!.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            autoFocus
            type={col.type === "number" ? "number" : "text"}
            step={col.type === "number" ? "0.01" : undefined}
            defaultValue={String(val ?? "")}
            className="w-full rounded border-2 border-forest bg-white px-2 py-1 text-xs font-mono outline-none"
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Tab") commit((e.target as HTMLInputElement).value);
              if (e.key === "Escape") onEndEdit();
            }}
          />
        )}
      </td>
    );
  }

  const displayValue = () => {
    if (val === null || val === undefined || val === "") return <span className="text-ink/25">-</span>;
    if (typeof val === "number") {
      if (numericMoney.includes(String(col.key))) return <span className="font-mono font-bold text-forest">{money(val)}</span>;
      if (numericPercent.includes(String(col.key))) return <span className="font-mono">{val}%</span>;
      return <span className="font-mono">{String(val)}</span>;
    }
    return <span className="truncate">{String(val)}</span>;
  };

  return (
    <td style={{ width: col.width }} className="max-w-[220px] px-3 py-1.5" onClick={canManage ? onStartEdit : undefined} title={canManage ? "Clique para editar" : undefined}>
      <div className={`overflow-hidden text-ellipsis whitespace-nowrap text-xs ${canManage ? "cursor-pointer" : ""}`}>{displayValue()}</div>
    </td>
  );
}
