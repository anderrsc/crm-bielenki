"use client";

import { saveGutterQuote, updateGutterQuote } from "@/app/(crm)/actions";
import {
  gutterAccessoryUnits,
  gutterColors,
  gutterCondutorUnits,
  gutterCutOptions,
  gutterFabricationCategories,
  gutterProductsByCategory,
  gutterServiceUnits,
  gutterSpecialCategories,
  gutterSpecialItemUnits,
  gutterThicknesses,
  gutterCategoryForProduct,
  isFabricationCategory,
  normalizeGutterColor,
  normalizeGutterThickness,
  type GutterPrice,
  type QuoteClient,
} from "@/lib/gutters";
import { localISODate, money } from "@/lib/utils";
import { Copy, Database, Package, Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

type Category = keyof typeof gutterProductsByCategory;

export type GutterQuoteItem = {
  category: string;
  product: string;
  thickness: string;
  cut: string;
  color: string;
  quantity: number;
  meters: number;
  unit_price: number;
  install_price: number;
};

export type SpecialItem = {
  category?: string;
  product: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  diameter?: string;
  height?: string;
  length?: string;
};

export type GutterQuoteInitial = {
  id: string;
  client_id: string;
  discount: number;
  freight: number;
  notes: string;
  valid_until: string;
  installation_deadline: string;
  items: GutterQuoteItem[];
  special_items?: SpecialItem[];
};

const asCategory = (value?: string | null): Category =>
  Object.prototype.hasOwnProperty.call(gutterProductsByCategory, value || "")
    ? (value as Category)
    : "Calhas";

const cutNumber = (cut?: string | null) => Number(String(cut ?? "").replace(/\D/g, ""));

const normalizeCut = (cut?: string | null) => {
  const value = cutNumber(cut);
  return value ? `C/ ${value}` : "C/ 300";
};

const lineTotal = (item: GutterQuoteItem) =>
  item.quantity * item.meters * (Number(item.unit_price) + Number(item.install_price || 0));

const specialUnits = (category?: string | null) => {
  if (category === "Condutores") return gutterCondutorUnits;
  if (category === "Acessórios") return gutterAccessoryUnits;
  if (category === "Serviços") return gutterServiceUnits;
  return gutterSpecialItemUnits;
};

const defaultProduct = (category: string) => gutterProductsByCategory[asCategory(category)][0];

const findPrice = (
  prices: GutterPrice[],
  item: Pick<GutterQuoteItem, "category" | "product" | "thickness" | "cut" | "color">
) =>
  prices.find((price) => {
    const category = price.category || gutterCategoryForProduct(price.product);
    return (
      price.active &&
      price.product === item.product &&
      (category === item.category || gutterCategoryForProduct(price.product) === item.category) &&
      normalizeGutterThickness(price.thickness) === normalizeGutterThickness(item.thickness) &&
      Number(price.cut_mm) === cutNumber(item.cut) &&
      normalizeGutterColor(price.color) === normalizeGutterColor(item.color)
    );
  });

const findSpecialPrice = (prices: GutterPrice[], item: SpecialItem) =>
  prices.find((price) => {
    const category = price.category || gutterCategoryForProduct(price.product);
    return price.active && price.product === item.product && category === item.category;
  });

const blank = (prices: GutterPrice[]): GutterQuoteItem => {
  const item = {
    category: "Calhas",
    product: "Calha de Beiral",
    thickness: "0.50 mm",
    cut: "C/ 300",
    color: "Aluminio Natural",
    quantity: 1,
    meters: 1,
    unit_price: 0,
    install_price: 0,
  };
  const price = findPrice(prices, item);
  return { ...item, unit_price: Number(price?.unit_price ?? 0), install_price: Number(price?.install_price ?? 0) };
};

const blankSpecial = (prices: GutterPrice[]): SpecialItem => {
  const item = {
    category: "Condutores",
    product: "Condutor de PVC Redondo 75 mm",
    description: "",
    unit: "Metro",
    quantity: 1,
    unit_price: 0,
    diameter: "",
    height: "",
    length: "",
  };
  const price = findSpecialPrice(prices, item);
  return { ...item, unit_price: Number(price?.unit_price ?? 0) };
};

const normalizeItem = (prices: GutterPrice[], item: Partial<GutterQuoteItem>): GutterQuoteItem => {
  const category = isFabricationCategory(item.category) ? item.category! : gutterCategoryForProduct(item.product);
  const next = {
    category,
    product: item.product || defaultProduct(category),
    thickness: normalizeGutterThickness(item.thickness) || "0.50 mm",
    cut: normalizeCut(item.cut),
    color: normalizeGutterColor(item.color) || "Aluminio Natural",
    quantity: Number(item.quantity) || 1,
    meters: Number(item.meters) || 1,
    unit_price: Number(item.unit_price) || 0,
    install_price: Number(item.install_price) || 0,
  };
  const price = findPrice(prices, next);
  return price && !item.unit_price
    ? { ...next, unit_price: Number(price.unit_price || 0), install_price: Number(price.install_price || 0) }
    : next;
};

const normalizeSpecial = (prices: GutterPrice[], item: Partial<SpecialItem>): SpecialItem => {
  const category = isFabricationCategory(item.category)
    ? "Condutores"
    : item.category || gutterCategoryForProduct(item.product);
  const product = item.product || defaultProduct(category);
  const unit = item.unit || specialUnits(category)[0];
  const next = {
    category,
    product,
    description: item.description || "",
    unit,
    quantity: Number(item.quantity) || 1,
    unit_price: Number(item.unit_price) || 0,
    diameter: item.diameter || "",
    height: item.height || "",
    length: item.length || "",
  };
  const price = findSpecialPrice(prices, next);
  return price && !item.unit_price ? { ...next, unit_price: Number(price.unit_price || 0) } : next;
};

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
    initial?.items.length ? initial.items.map((item) => normalizeItem(prices, item)) : [blank(prices)]
  );
  const [specialItems, setSpecialItems] = useState<SpecialItem[]>(() =>
    (initial?.special_items ?? []).map((item) => normalizeSpecial(prices, item))
  );
  const [discount, setDiscount] = useState(initial?.discount ?? 0);
  const [freight, setFreight] = useState(initial?.freight ?? 0);
  const [clientId, setClientId] = useState(initial?.client_id ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const today = new Date();
  today.setDate(today.getDate() + 30);
  const defaultValid = localISODate(today);
  const [validUntil, setValidUntil] = useState(initial?.valid_until ?? defaultValid);
  const [installationDeadline, setInstallationDeadline] = useState(
    initial?.installation_deadline ?? "Até 15 dias após aprovação e conferência final das medidas"
  );
  const subtotalCalhas = useMemo(() => items.reduce((total, item) => total + lineTotal(item), 0), [items]);
  const subtotalEspeciais = useMemo(
    () => specialItems.reduce((total, item) => total + item.quantity * item.unit_price, 0),
    [specialItems]
  );
  const subtotal = subtotalCalhas + subtotalEspeciais;
  const total = Math.max(0, subtotal - discount + freight);

  const change = (index: number, key: keyof GutterQuoteItem, value: string) =>
    setItems((current) =>
      current.map((item, i) => {
        if (i !== index) return item;
        let next = {
          ...item,
          [key]: ["quantity", "meters", "unit_price", "install_price"].includes(key) ? Number(value) : value,
        } as GutterQuoteItem;
        if (key === "category") next = { ...next, product: defaultProduct(value) };
        if (["category", "product", "thickness", "cut", "color"].includes(key)) {
          const price = findPrice(prices, next);
          next.unit_price = Number(price?.unit_price ?? 0);
          next.install_price = Number(price?.install_price ?? 0);
        }
        return next;
      })
    );

  const changeSpecial = (index: number, key: keyof SpecialItem, value: string) =>
    setSpecialItems((current) =>
      current.map((item, i) => {
        if (i !== index) return item;
        let next = {
          ...item,
          [key]: ["quantity", "unit_price"].includes(key) ? Number(value) : value,
        } as SpecialItem;
        if (key === "category") {
          next = { ...next, product: defaultProduct(value), unit: specialUnits(value)[0] };
        }
        if (["category", "product", "unit"].includes(key)) {
          const price = findSpecialPrice(prices, next);
          next.unit_price = Number(price?.unit_price ?? 0);
        }
        return next;
      })
    );

  const payload = JSON.stringify({ client_id: clientId, discount, freight, notes, items, special_items: specialItems });

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Calculadora técnica</p>
          <h1 className="mt-2 text-3xl font-black">{initial ? "Editar orçamento de calhas" : "Orçamento de calhas"}</h1>
          <p className="mt-1 text-sm text-ink/50">Cadastro padronizado por categoria, corte, espessura, cor e unidade.</p>
        </div>
        <span className="flex items-center gap-2 text-xs font-bold text-ink/45">
          <Database className="h-4 w-4" />
          {prices.length} preços cadastrados
        </span>
      </div>

      <form action={initial ? updateGutterQuote : saveGutterQuote} className="grid gap-5 xl:grid-cols-[1fr_340px]">
        {initial && <input type="hidden" name="quote_id" value={initial.id} />}
        <input type="hidden" name="payload" value={payload} />
        <input type="hidden" name="valid_until" value={validUntil} />
        <input type="hidden" name="installation_deadline" value={installationDeadline} />

        <div className="space-y-4">
          <div className="card p-5">
            <label className="label">Cliente</label>
            <select className="field" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
              <option value="">Selecione o cliente</option>
              {clients.map((client) => (
                <option value={client.id} key={client.id}>
                  {client.name}
                  {client.city ? ` · ${client.city}` : ""}
                  {client.phone ? ` · ${client.phone}` : ""}
                </option>
              ))}
            </select>
            {!clients.length && <p className="mt-2 text-xs text-amber-700">Cadastre um cliente antes de criar o orçamento.</p>}
          </div>

          {items.map((item, index) => {
            const category = asCategory(item.category);
            const tablePrice = findPrice(prices, item);
            return (
              <div className="card p-5" key={index}>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <b>Item {index + 1} · Fabricação própria</b>
                    {tablePrice ? (
                      <p className="mt-1 flex items-center gap-1 text-xs font-bold text-emerald-700">
                        <Database className="h-3.5 w-3.5" />
                        Preço preenchido pela tabela
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-amber-700">Sem combinação cadastrada: informe o preço manualmente.</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      title="Duplicar"
                      className="button-ghost p-2"
                      onClick={() => setItems((current) => [...current.slice(0, index + 1), { ...item }, ...current.slice(index + 1)])}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Excluir"
                      disabled={items.length === 1}
                      className="button-ghost p-2 text-red-600"
                      onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
                  <Select label="Categoria" value={item.category} options={gutterFabricationCategories} onChange={(v) => change(index, "category", v)} />
                  <Select label="Produto" value={item.product} options={gutterProductsByCategory[category]} onChange={(v) => change(index, "product", v)} />
                  <Select label="Espessura" value={item.thickness} options={gutterThicknesses} onChange={(v) => change(index, "thickness", v)} />
                  <Select label="C/" value={item.cut} options={gutterCutOptions} onChange={(v) => change(index, "cut", v)} />
                  <Select label="Cor" value={item.color} options={gutterColors} onChange={(v) => change(index, "color", v)} />
                  <NumberField label="Quantidade" value={item.quantity} onChange={(v) => change(index, "quantity", v)} />
                  <NumberField label="Metragem" value={item.meters} onChange={(v) => change(index, "meters", v)} />
                  <NumberField label="Valor por metro" value={item.unit_price} onChange={(v) => change(index, "unit_price", v)} />
                  <NumberField label="Instalação por metro" value={item.install_price} onChange={(v) => change(index, "install_price", v)} />
                </div>
                <div className="mt-4 text-right text-sm text-ink/50">
                  Subtotal do item: <b className="text-ink">{money(lineTotal(item))}</b>
                </div>
              </div>
            );
          })}

          <button type="button" className="button-ghost w-full border-dashed" onClick={() => setItems((current) => [...current, blank(prices)])}>
            <Plus className="h-4 w-4" />
            Adicionar Calha / Rufo / Pingadeira
          </button>

          <div className="mt-2">
            <div className="mb-3 flex items-center gap-2">
              <Package className="h-4 w-4 text-forest" />
              <h2 className="font-bold text-ink">Condutores, Acessórios, Serviços e Itens Especiais</h2>
            </div>
            {specialItems.map((item, index) => {
              const category = asCategory(item.category || "Condutores");
              return (
                <div className="card mb-3 p-4" key={index}>
                  <div className="mb-3 flex items-center justify-between">
                    <b className="text-sm text-ink/70">Item complementar {index + 1}</b>
                    <button type="button" className="button-ghost p-1.5 text-red-600" onClick={() => setSpecialItems((c) => c.filter((_, i) => i !== index))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Select label="Categoria" value={item.category || "Condutores"} options={gutterSpecialCategories} onChange={(v) => changeSpecial(index, "category", v)} />
                    <Select label="Nome" value={item.product} options={gutterProductsByCategory[category]} onChange={(v) => changeSpecial(index, "product", v)} />
                    <Select label="Unidade" value={item.unit} options={specialUnits(item.category)} onChange={(v) => changeSpecial(index, "unit", v)} />
                    <NumberField label="Quantidade" value={item.quantity} onChange={(v) => changeSpecial(index, "quantity", v)} />
                    <NumberField label="Valor" value={item.unit_price} onChange={(v) => changeSpecial(index, "unit_price", v)} />
                    {item.category === "Itens Especiais" && (
                      <>
                        <TextField label="Diâmetro" value={item.diameter || ""} onChange={(v) => changeSpecial(index, "diameter", v)} />
                        <TextField label="Altura" value={item.height || ""} onChange={(v) => changeSpecial(index, "height", v)} />
                        <TextField label="Comprimento" value={item.length || ""} onChange={(v) => changeSpecial(index, "length", v)} />
                      </>
                    )}
                    <div className="sm:col-span-2 xl:col-span-4">
                      <label className="label">Observações</label>
                      <input className="field" type="text" value={item.description} onChange={(e) => changeSpecial(index, "description", e.target.value)} />
                    </div>
                    <div className="flex items-end">
                      <p className="text-sm text-ink/50">
                        Subtotal: <b className="text-ink">{money(item.quantity * item.unit_price)}</b>
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="button-ghost w-full border-dashed border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => setSpecialItems((c) => [...c, blankSpecial(prices)])}
            >
              <Plus className="h-4 w-4" />
              Adicionar item complementar
            </button>
          </div>
        </div>

        <aside className="card h-fit p-5 xl:sticky xl:top-24">
          <h2 className="text-lg font-black">Resumo</h2>
          <div className="mt-5 space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-ink/50">Calhas / Rufos / Pingadeiras</span>
              <b>{money(subtotalCalhas)}</b>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink/50">Complementares</span>
              <b>{money(subtotalEspeciais)}</b>
            </div>
            <NumberField label="Desconto (R$)" value={discount} onChange={(v) => setDiscount(Number(v))} />
            <NumberField label="Frete (R$)" value={freight} onChange={(v) => setFreight(Number(v))} />
            <div>
              <label className="label">Observações</label>
              <textarea className="field min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <label className="label">Validade do orçamento</label>
              <input type="date" className="field" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
            <div>
              <label className="label">Prazo de instalação</label>
              <input
                type="text"
                className="field"
                value={installationDeadline}
                onChange={(e) => setInstallationDeadline(e.target.value)}
              />
            </div>
            <div className="border-t pt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-ink/45">Total</p>
              <p className="mt-1 text-3xl font-black text-forest">{money(total)}</p>
            </div>
            <button disabled={!clientId || total <= 0} className="button w-full">
              <Save className="h-4 w-4" />
              Salvar orçamento
            </button>
          </div>
        </aside>
      </form>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="field" type="number" min="0" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="field" type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
