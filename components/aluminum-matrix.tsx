"use client";

import { useState, useTransition } from "react";
import { Save, Plus, Trash2, Check, AlertTriangle } from "lucide-react";
import { saveMatrixRow, deleteMatrixRow } from "@/app/(crm)/matrix-actions";

export type MatrixRow = {
  id: string;
  thickness: string;
  cut_mm: number;
  price_per_meter: number;
};

const THICKNESSES = ["0.5mm", "0.6mm", "0.7mm", "1.0mm"];

const money = (v: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(v);

function newTempId() {
  return `new-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AluminumMatrix({
  initialRows,
  canManage,
}: {
  initialRows: MatrixRow[];
  canManage: boolean;
}) {
  const [rows, setRows] = useState<MatrixRow[]>(initialRows);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const byThickness = (th: string) =>
    rows
      .filter((r) => r.thickness === th)
      .sort((a, b) => a.cut_mm - b.cut_mm);

  const handleChange = (id: string, field: keyof MatrixRow, val: unknown) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: val } : r))
    );
  };

  const handleSave = (row: MatrixRow) => {
    if (!row.cut_mm || row.cut_mm <= 0) {
      setErrors((e) => ({ ...e, [row.id]: "Corte inválido" }));
      return;
    }
    setErrors((e) => { const n = { ...e }; delete n[row.id]; return n; });
    setSaving((s) => ({ ...s, [row.id]: true }));
    startTransition(async () => {
      const result = await saveMatrixRow({
        id: row.id.startsWith("new-") ? undefined : row.id,
        thickness: row.thickness,
        cut_mm: row.cut_mm,
        price_per_meter: row.price_per_meter,
      });
      setSaving((s) => { const n = { ...s }; delete n[row.id]; return n; });
      if (result?.error) {
        setErrors((e) => ({ ...e, [row.id]: result.error! }));
      } else {
        if (result?.id && row.id.startsWith("new-")) {
          setRows((prev) =>
            prev.map((r) => (r.id === row.id ? { ...r, id: result.id! } : r))
          );
        }
        setSaved((s) => ({ ...s, [row.id.startsWith("new-") ? result?.id ?? row.id : row.id]: true }));
        setTimeout(() => setSaved((s) => { const n = { ...s }; delete n[row.id]; return n; }), 2000);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (id.startsWith("new-")) {
      setRows((prev) => prev.filter((r) => r.id !== id));
      return;
    }
    startTransition(async () => {
      await deleteMatrixRow(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    });
  };

  const addRow = (thickness: string) => {
    const id = newTempId();
    setRows((prev) => [...prev, { id, thickness, cut_mm: 0, price_per_meter: 0 }]);
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.2em] text-forest">Matéria-Prima</p>
        <h2 className="text-xl font-black">Tabela de preços por corte e espessura</h2>
        <p className="mt-0.5 text-sm text-ink/50">
          Preço/metro padrão para cada corte. Aplica-se a qualquer produto com o mesmo corte e espessura.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {THICKNESSES.map((th) => {
          const thRows = byThickness(th);
          return (
            <div key={th} className="card overflow-hidden">
              {/* Cabeçalho */}
              <div className="flex items-center justify-between border-b bg-cream/60 px-4 py-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Alumínio</p>
                  <p className="text-lg font-black text-forest">{th}</p>
                </div>
                {canManage && (
                  <button
                    onClick={() => addRow(th)}
                    className="flex items-center gap-1 rounded-lg border border-sand px-2 py-1 text-xs font-semibold hover:bg-white"
                  >
                    <Plus className="h-3 w-3" /> Corte
                  </button>
                )}
              </div>

              {/* Linhas */}
              <div className="divide-y">
                {thRows.length === 0 && (
                  <p className="p-4 text-center text-xs text-ink/35">Nenhum corte cadastrado.</p>
                )}
                {thRows.map((row) => (
                  <div key={row.id} className="group flex items-center gap-2 px-3 py-2">
                    {/* Corte */}
                    {canManage ? (
                      <input
                        type="number"
                        className="w-16 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-sm font-bold text-ink focus:border-forest focus:bg-white focus:outline-none"
                        value={row.cut_mm || ""}
                        placeholder="mm"
                        onChange={(e) => handleChange(row.id, "cut_mm", Number(e.target.value))}
                      />
                    ) : (
                      <span className="w-16 text-sm font-bold">{row.cut_mm}</span>
                    )}
                    <span className="text-xs text-ink/40">mm</span>

                    <span className="mx-1 text-ink/20">→</span>

                    {/* Preço */}
                    {canManage ? (
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink/40">R$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-full rounded-lg border border-transparent bg-transparent py-1 pl-7 pr-1 text-sm font-black text-forest focus:border-forest focus:bg-white focus:outline-none"
                          value={row.price_per_meter || ""}
                          placeholder="0,00"
                          onChange={(e) => handleChange(row.id, "price_per_meter", Number(e.target.value))}
                          onBlur={() => handleSave(row)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleSave(row); }}
                        />
                      </div>
                    ) : (
                      <span className="flex-1 text-right text-sm font-black text-forest">
                        {money(row.price_per_meter)}/m
                      </span>
                    )}

                    {/* Ações */}
                    {canManage && (
                      <div className="flex items-center gap-1">
                        {saving[row.id] && (
                          <span className="text-[10px] text-ink/40">...</span>
                        )}
                        {saved[row.id] && (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        )}
                        {errors[row.id] && (
                          <AlertTriangle className="h-3.5 w-3.5 text-red-500" title={errors[row.id]} />
                        )}
                        <button
                          onClick={() => handleSave(row)}
                          disabled={!!saving[row.id]}
                          className="rounded p-1 text-forest opacity-0 transition group-hover:opacity-100 hover:bg-lime/20"
                          title="Salvar"
                        >
                          <Save className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => handleDelete(row.id)}
                          className="rounded p-1 text-red-400 opacity-0 transition group-hover:opacity-100 hover:bg-red-50"
                          title="Excluir"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Rodapé */}
              {thRows.length > 0 && (
                <div className="border-t bg-cream/40 px-4 py-2 text-[10px] text-ink/40">
                  {thRows.length} corte{thRows.length !== 1 ? "s" : ""} · Tab ou Enter salva automaticamente
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
