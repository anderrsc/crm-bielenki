"use client";

import { saveGutterQuote, updateGutterQuote } from "@/app/(crm)/actions";
import {
  gutterColors, gutterCuts, gutterThicknesses,
  PRODUCTS_BY_CATEGORY, UNITS_BY_CATEGORY,
  FABRICATED_CATEGORIES, OTHER_CATEGORIES,
  type GutterPrice, type QuoteClient, type FabricatedCategory, type OtherCategory,
} from "@/lib/gutters";
import { localISODate, money } from "@/lib/utils";
import { Copy, Database, Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

/* ─── Tipos ──────────────────────────────────────────────────────────────── */
export type GutterQuoteItem = {
  category: FabricatedCategory;
  product: string;
  thickness: string;
  cut: string;
  color: string;
  quantity: number;
  meters: number;
  unit_price: number;
};

export type SpecialItem = {
  item_type: OtherCategory | "especial";
  product: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
};

export type GutterQuoteInitial = {
  id: string;
  client_id: string;
  discount: number;
  freight: number;
  notes: string;
  valid_until: string;
  installation_deadline: string;
  hide_unit_prices: boolean;
  items: GutterQuoteItem[];
  special_items?: SpecialItem[];
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const SPECIAL_UNITS = ["metro", "unidade", "peça", "hora", "serviço", "diária", "tubo", "caixa"];

const CAT_COLORS: Record<string, string> = {
  "Calhas":          "border-blue-200 bg-blue-50/40",
  "Rufos":           "border-violet-200 bg-violet-50/40",
  "Pingadeiras":     "border-teal-200 bg-teal-50/40",
  "Condutores":      "border-amber-200 bg-amber-50/40",
  "Acessórios":      "border-orange-200 bg-orange-50/40",
  "Serviços":        "border-rose-200 bg-rose-50/40",
  "Itens Especiais": "border-gray-200 bg-gray-50/40",
};

const CAT_BADGE: Record<string, string> = {
  "Calhas":          "bg-blue-100 text-blue-700",
  "Rufos":           "bg-violet-100 text-violet-700",
  "Pingadeiras":     "bg-teal-100 text-teal-700",
  "Condutores":      "bg-amber-100 text-amber-700",
  "Acessórios":      "bg-orange-100 text-orange-700",
  "Serviços":        "bg-rose-100 text-rose-700",
  "Itens Especiais": "bg-gray-100 text-gray-700",
};

const findPrice = (prices: GutterPrice[], item: Pick<GutterQuoteItem, "product" | "thickness" | "cut" | "color">) =>
  prices.find(x =>
    x.active &&
    x.product === item.product &&
    x.thickness === item.thickness &&
    x.cut_mm === Number(item.cut.replace(/\D/g, "")) &&
    (x.color ?? "Aluminio Natural") === item.color
  );

const blankFabricated = (category: FabricatedCategory, prices: GutterPrice[]): GutterQuoteItem => {
  const product = PRODUCTS_BY_CATEGORY[category][0];
  const item = { category, product, thickness: "0.5mm", cut: "200 mm", color: "Aluminio Natural", quantity: 1, meters: 1, unit_price: 0 };
  return { ...item, unit_price: Number(findPrice(prices, item)?.unit_price ?? 0) };
};

const blankOther = (item_type: OtherCategory): SpecialItem => ({
  item_type,
  product: PRODUCTS_BY_CATEGORY[item_type][0],
  description: "",
  unit: UNITS_BY_CATEGORY[item_type][0],
  quantity: 1,
  unit_price: 0,
});

const otherCategoryFromRecord = (item: Partial<SpecialItem>): OtherCategory => {
  const firstDescriptionPart = String(item.description || "").split("|")[0]?.trim();
  const rawType = String(item.item_type || "");
  if (OTHER_CATEGORIES.includes(firstDescriptionPart as OtherCategory)) return firstDescriptionPart as OtherCategory;
  if (rawType === "condutor") return "Condutores";
  if (rawType === "servico") return "Serviços";
  if (rawType === "item_especial") {
    const product = String(item.product || "");
    const found = OTHER_CATEGORIES.find((category) => PRODUCTS_BY_CATEGORY[category].includes(product));
    return found || "Itens Especiais";
  }
  if (OTHER_CATEGORIES.includes(rawType as OtherCategory)) return rawType as OtherCategory;
  return "Itens Especiais";
};

const cleanOtherDescription = (description?: string | null) => {
  const first = String(description || "").split("|")[0]?.trim();
  return String(description || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== first || !OTHER_CATEGORIES.includes(first as OtherCategory))
    .join(" | ");
};

/* ─── Componente principal ───────────────────────────────────────────────── */
export function GutterQuote({
  prices,
  clients,
  initial,
}: {
  prices: GutterPrice[];
  clients: QuoteClient[];
  initial?: GutterQuoteInitial;
}) {
  const [items, setItems] = useState<GutterQuoteItem[]>(() =>
    initial?.items.length ? initial.items : initial?.special_items?.length ? [] : [blankFabricated("Calhas", prices)]
  );
  const [specialItems, setSpecialItems] = useState<SpecialItem[]>(() =>
    (initial?.special_items ?? []).map((item) => {
      const item_type = otherCategoryFromRecord(item);
      return {
        ...item,
        item_type,
        description: cleanOtherDescription(item.description),
        unit: item.unit || UNITS_BY_CATEGORY[item_type][0],
      };
    })
  );
  const [discount, setDiscount] = useState(initial?.discount ?? 0);
  const [freight, setFreight] = useState(initial?.freight ?? 0);
  const [hideUnitPrices, setHideUnitPrices] = useState(initial?.hide_unit_prices ?? false);
  const [clientId, setClientId] = useState(initial?.client_id ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const today = new Date(); today.setDate(today.getDate() + 30);
  const [validUntil, setValidUntil] = useState(initial?.valid_until ?? localISODate(today));
  const [installationDeadline, setInstallationDeadline] = useState(
    initial?.installation_deadline ?? "Até 15 dias após aprovação e conferência final das medidas"
  );

  /* ── Cálculos ── */
  const subtotalFab = useMemo(
    () => items.reduce((t, i) => t + i.quantity * i.meters * i.unit_price, 0),
    [items]
  );
  const subtotalOther = useMemo(
    () => specialItems.reduce((t, i) => t + i.quantity * i.unit_price, 0),
    [specialItems]
  );
  const subtotal = subtotalFab + subtotalOther;
  const total = Math.max(0, subtotal - discount + freight);

  /* ── Edição de itens fabricados ── */
  const changeFab = (index: number, key: keyof GutterQuoteItem, value: string) =>
    setItems(curr =>
      curr.map((item, i) => {
        if (i !== index) return item;
        const next = {
          ...item,
          [key]: ["quantity", "meters", "unit_price"].includes(key) ? Number(value) : value,
        } as GutterQuoteItem;
        if (["product", "thickness", "cut", "color"].includes(key)) {
          next.unit_price = Number(findPrice(prices, next)?.unit_price ?? 0);
        }
        if (key === "category") {
          next.product = PRODUCTS_BY_CATEGORY[value as FabricatedCategory][0];
          next.unit_price = Number(findPrice(prices, next)?.unit_price ?? 0);
        }
        return next;
      })
    );

  const changeOther = (index: number, key: keyof SpecialItem, value: string) =>
    setSpecialItems(curr =>
      curr.map((item, i) => {
        if (i !== index) return item;
        const next = {
          ...item,
          [key]: ["quantity", "unit_price"].includes(key) ? Number(value) : value,
        } as SpecialItem;
        if (key === "item_type") {
          next.product = PRODUCTS_BY_CATEGORY[value as OtherCategory][0];
          next.unit = UNITS_BY_CATEGORY[value as OtherCategory][0];
        }
        return next;
      })
    );

  const payload = JSON.stringify({
    client_id: clientId,
    discount,
    freight,
    notes,
    hide_unit_prices: hideUnitPrices,
    items,
    special_items: specialItems,
  });

  /* ── Agrupamento para exibição ── */
  const fabricatedByCat = FABRICATED_CATEGORIES.map(cat => ({
    cat,
    rows: items.map((item, idx) => ({ item, idx })).filter(({ item }) => item.category === cat),
  })).filter(g => g.rows.length > 0);

  const otherByCat = OTHER_CATEGORIES.map(cat => ({
    cat,
    rows: specialItems.map((item, idx) => ({ item, idx })).filter(({ item }) => item.item_type === cat),
  })).filter(g => g.rows.length > 0);

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Calculadora técnica</p>
          <h1 className="mt-2 text-3xl font-black">
            {initial ? "Editar orçamento de calhas" : "Orçamento de calhas"}
          </h1>
          <p className="mt-1 text-sm text-ink/50">
            Calhas · Rufos · Pingadeiras · Condutores · Acessórios · Serviços
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs font-bold text-ink/45">
          <Database className="h-4 w-4" />{prices.length} preços cadastrados
        </span>
      </div>

      <form action={initial ? updateGutterQuote : saveGutterQuote} className="grid gap-5 xl:grid-cols-[1fr_340px]">
        {initial && <input type="hidden" name="quote_id" value={initial.id} />}
        <input type="hidden" name="payload" value={payload} />
        <input type="hidden" name="valid_until" value={validUntil} />
        <input type="hidden" name="installation_deadline" value={installationDeadline} />

        <div className="space-y-4">
          {/* Cliente */}
          <div className="card p-5">
            <label className="label">Cliente</label>
            <select className="field" value={clientId} onChange={e => setClientId(e.target.value)} required>
              <option value="">Selecione o cliente</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.city ? ` · ${c.city}` : ""}{c.phone ? ` · ${c.phone}` : ""}
                </option>
              ))}
            </select>
            {!clients.length && (
              <p className="mt-2 text-xs text-amber-700">Cadastre um cliente antes de criar o orçamento.</p>
            )}
          </div>

          {/* ── Itens Fabricados agrupados ── */}
          {!items.length && (
            <div className="rounded-2xl border border-dashed border-sand bg-white p-5 text-sm text-ink/55">
              Sem itens de fabricação própria. O orçamento será montado apenas com complementares, serviços ou itens especiais.
            </div>
          )}

          {fabricatedByCat.map(({ cat, rows }) => (
            <div key={cat} className={`rounded-2xl border p-4 space-y-3 ${CAT_COLORS[cat]}`}>
              <div className="flex items-center justify-between">
                <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${CAT_BADGE[cat]}`}>
                  {cat}
                </span>
                <span className="text-xs text-ink/40">
                  Subtotal: <b>{money(rows.reduce((t, { item: i }) => t + i.quantity * i.meters * i.unit_price, 0))}</b>
                </span>
              </div>
              {rows.map(({ item, idx }) => (
                <FabricatedItemCard
                  key={idx}
                  item={item}
                  index={idx}
                  prices={prices}
                  onChange={changeFab}
                  onDuplicate={() => setItems(c => [...c.slice(0, idx + 1), { ...item }, ...c.slice(idx + 1)])}
                  onRemove={() => setItems(c => c.filter((_, i) => i !== idx))}
                  canRemove={items.length > 1 || specialItems.length > 0}
                />
              ))}
            </div>
          ))}

          {/* ── Itens de outras categorias ── */}
          {otherByCat.map(({ cat, rows }) => (
            <div key={cat} className={`rounded-2xl border p-4 space-y-3 ${CAT_COLORS[cat]}`}>
              <div className="flex items-center justify-between">
                <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${CAT_BADGE[cat]}`}>
                  {cat}
                </span>
                <span className="text-xs text-ink/40">
                  Subtotal: <b>{money(rows.reduce((t, { item: i }) => t + i.quantity * i.unit_price, 0))}</b>
                </span>
              </div>
              {rows.map(({ item, idx }) => (
                <OtherItemCard
                  key={idx}
                  item={item}
                  index={idx}
                  onChange={changeOther}
                  onRemove={() => setSpecialItems(c => c.filter((_, i) => i !== idx))}
                />
              ))}
            </div>
          ))}

          {/* ── Botões para adicionar ── */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FABRICATED_CATEGORIES.map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setItems(c => [...c, blankFabricated(cat, prices)])}
                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-bold transition hover:shadow-sm ${CAT_COLORS[cat]}`}
              >
                <Plus className="h-3.5 w-3.5" /> {cat}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {OTHER_CATEGORIES.map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setSpecialItems(c => [...c, blankOther(cat)])}
                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-bold transition hover:shadow-sm ${CAT_COLORS[cat]}`}
              >
                <Plus className="h-3.5 w-3.5" /> {cat}
              </button>
            ))}
          </div>
        </div>

        {/* ── Sidebar de resumo ── */}
        <aside className="card h-fit p-5 xl:sticky xl:top-24">
          <h2 className="text-lg font-black">Resumo</h2>
          <div className="mt-5 space-y-4">
            {/* Subtotais por bloco */}
            <div className="space-y-1.5 rounded-xl bg-cream p-3 text-sm">
              {subtotalFab > 0 && (
                <div className="flex justify-between text-ink/60">
                  <span>Calhas / Rufos / Pingadeiras</span>
                  <b>{money(subtotalFab)}</b>
                </div>
              )}
              {subtotalOther > 0 && (
                <div className="flex justify-between text-ink/60">
                  <span>Outros itens</span>
                  <b>{money(subtotalOther)}</b>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 font-bold">
                <span>Subtotal</span><b>{money(subtotal)}</b>
              </div>
            </div>

            <NumberField label="Desconto (R$)" value={discount} onChange={v => setDiscount(Number(v))} />
            <NumberField label="Frete (R$)" value={freight} onChange={v => setFreight(Number(v))} />
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hideUnitPrices}
                onChange={e => setHideUnitPrices(e.target.checked)}
                className="h-4 w-4 accent-forest"
              />
              <span className="font-medium text-ink/70">Ocultar valores unitários no impresso</span>
            </label>
            <div>
              <label className="label">Observações</label>
              <textarea className="field min-h-24" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <div>
              <label className="label">Validade do orçamento</label>
              <input type="date" className="field" value={validUntil} onChange={e => setValidUntil(e.target.value)} />
            </div>
            <div>
              <label className="label">Prazo de instalação</label>
              <input type="text" className="field" value={installationDeadline}
                onChange={e => setInstallationDeadline(e.target.value)}
                placeholder="Ex: Até 15 dias após aprovação" />
            </div>
            <div className="border-t pt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-ink/45">Total</p>
              <p className="mt-1 text-3xl font-black text-forest">{money(total)}</p>
            </div>
            <button disabled={!clientId || total <= 0 || (items.length === 0 && specialItems.length === 0)} className="button w-full">
              <Save className="h-4 w-4" />Salvar orçamento
            </button>
          </div>
        </aside>
      </form>
    </div>
  );
}

/* ─── Card de item fabricado (Calhas / Rufos / Pingadeiras) ─────────────── */
function FabricatedItemCard({
  item, index, prices, onChange, onDuplicate, onRemove, canRemove,
}: {
  item: GutterQuoteItem;
  index: number;
  prices: GutterPrice[];
  onChange: (i: number, k: keyof GutterQuoteItem, v: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const tablePrice = findPrice(prices, item);
  const subtotal = item.quantity * item.meters * item.unit_price;

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Select
            label=""
            value={item.category}
            options={[...FABRICATED_CATEGORIES]}
            onChange={v => onChange(index, "category", v)}
            className="h-7 rounded-lg border-0 bg-transparent text-xs font-black"
          />
          {tablePrice
            ? <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700"><Database className="h-3 w-3" />Da tabela</span>
            : <span className="text-[10px] text-amber-700">Sem preço cadastrado — informe manualmente</span>}
        </div>
        <div className="flex gap-1">
          <button type="button" title="Duplicar" className="button-ghost p-1.5" onClick={onDuplicate}><Copy className="h-3.5 w-3.5" /></button>
          <button type="button" title="Excluir" disabled={!canRemove} className="button-ghost p-1.5 text-red-600 disabled:opacity-30" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <Select label="Produto" value={item.product}
            options={PRODUCTS_BY_CATEGORY[item.category]}
            onChange={v => onChange(index, "product", v)} />
        </div>
        <Select label="Espessura" value={item.thickness} options={gutterThicknesses} onChange={v => onChange(index, "thickness", v)} />
        <Select label="C/" value={item.cut} options={gutterCuts.map(x => `${x} mm`)} onChange={v => onChange(index, "cut", v)} />
        <Select label="Cor" value={item.color} options={gutterColors} onChange={v => onChange(index, "color", v)} />
        <NumberField label="Qtd." value={item.quantity} onChange={v => onChange(index, "quantity", v)} />
        <NumberField label="Metros" value={item.meters} onChange={v => onChange(index, "meters", v)} />
        <NumberField label="R$/metro" value={item.unit_price} onChange={v => onChange(index, "unit_price", v)} />
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-xs text-ink/40">{item.quantity} un × {item.meters}m × {money(item.unit_price)}/m</span>
        <b className="text-forest">{money(subtotal)}</b>
      </div>
    </div>
  );
}

/* ─── Card de outros itens (Condutores / Acessórios / Serviços / Especiais) ── */
function OtherItemCard({
  item, index, onChange, onRemove,
}: {
  item: SpecialItem;
  index: number;
  onChange: (i: number, k: keyof SpecialItem, v: string) => void;
  onRemove: () => void;
}) {
  const isOtherCat = OTHER_CATEGORIES.includes(item.item_type as OtherCategory);
  const productList = isOtherCat
    ? PRODUCTS_BY_CATEGORY[item.item_type as OtherCategory]
    : [];
  const unitList = isOtherCat
    ? UNITS_BY_CATEGORY[item.item_type as OtherCategory]
    : SPECIAL_UNITS;

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <Select
          label=""
          value={item.item_type}
          options={[...OTHER_CATEGORIES]}
          onChange={v => onChange(index, "item_type", v)}
          className="h-7 rounded-lg border-0 bg-transparent text-xs font-black"
        />
        <button type="button" className="button-ghost p-1.5 text-red-600" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label">Produto / Serviço</label>
          {productList.length > 0 ? (
            <select className="field" value={item.product} onChange={e => onChange(index, "product", e.target.value)}>
              {productList.map(p => <option key={p}>{p}</option>)}
            </select>
          ) : (
            <input className="field" type="text" placeholder="Nome do produto ou serviço…"
              value={item.product} onChange={e => onChange(index, "product", e.target.value)} />
          )}
        </div>
        <div className="sm:col-span-2">
          <label className="label">Descrição (opcional)</label>
          <input className="field" type="text" placeholder="Detalhes adicionais…"
            value={item.description} onChange={e => onChange(index, "description", e.target.value)} />
        </div>
        <Select label="Unidade" value={item.unit} options={unitList} onChange={v => onChange(index, "unit", v)} />
        <NumberField label="Quantidade" value={item.quantity} onChange={v => onChange(index, "quantity", v)} />
        <NumberField label="Valor unitário (R$)" value={item.unit_price} onChange={v => onChange(index, "unit_price", v)} />
        <div className="flex items-end pb-3">
          <p className="text-sm text-ink/50">Subtotal: <b className="text-ink">{money(item.quantity * item.unit_price)}</b></p>
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers UI ─────────────────────────────────────────────────────────── */
function Select({ label, value, options, onChange, className }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; className?: string;
}) {
  return (
    <div>
      {label && <label className="label">{label}</label>}
      <select
        className={className ?? "field"}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(x => <option key={x}>{x}</option>)}
      </select>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="field" type="number" min="0" step="0.01" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
