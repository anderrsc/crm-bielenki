"use client";
import { DraftQuoteAttachments } from "./quote-attachments";

import { saveGutterQuote, updateGutterQuote } from "@/app/(crm)/actions";
import {
  gutterColors, gutterCuts, gutterThicknesses,
  PRODUCTS_BY_CATEGORY, UNITS_BY_CATEGORY,
  FABRICATED_CATEGORIES, OTHER_CATEGORIES,
  type GutterPrice, type QuoteClient, type FabricatedCategory, type OtherCategory,
} from "@/lib/gutters";
import { automaticPaintItems, automaticPaintPrefix, fabricatedMeterPrice, paintMeterPrice, type GutterQuoteRates } from "@/lib/gutter-quote-pricing";
import { money, addDaysISO, todayISO, DEFAULT_QUOTE_VALIDITY_DAYS } from "@/lib/utils";
import { Copy, Database, Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { GutterPiecePreview } from "@/components/gutter-piece-preview";
import { SubmitButton } from "@/components/submit-button";
import { uniqueProductNames, normalizeProductName, isBeiralProduct, isTwoFloors, withFloors, withoutFloors } from "@/lib/gutter-catalog";
import { gutterCategoryForProduct, PRODUCT_RENAMES } from "@/lib/gutters";

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
  /** Cor (Condutores/Acessórios). Salva na descrição como "Cor: X". */
  color?: string;
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
  hide_travel_price: boolean;
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

/* Tabela de retirada na empresa: sempre 25% abaixo da tabela (com instalação), pintura inclusive. */
export const PICKUP_FACTOR = 0.75;
const PICKUP_DEADLINE = "Sem instalação (retirada)";
export const PICKUP_NOTE_MARK = "Orçamento pela tabela de retirada na empresa";
export const PICKUP_NOTE = `${PICKUP_NOTE_MARK}: os valores já consideram 25% de desconto sobre a tabela padrão e não incluem instalação, mão de obra no local nem frete. O material deve ser retirado em nossa sede, em data e horário combinados após a confirmação do pedido. Recomendamos conferir as peças e medidas no ato da retirada; o transporte e a instalação ficam sob responsabilidade do cliente.`;
const tableValue = (value: number | undefined, factor: number) => Math.round(Number(value ?? 0) * factor * 100) / 100;

const blankFabricated = (category: FabricatedCategory, prices: GutterPrice[], rates: GutterQuoteRates, factor = 1): GutterQuoteItem => {
  const product = category === "Calhas" ? "Calha de beiral" : PRODUCTS_BY_CATEGORY[category][0];
  const item = { category, product, thickness: "0.5mm", cut: "200 mm", color: "Aluminio Natural", quantity: 1, meters: 1, unit_price: 0 };
  return { ...item, unit_price: tableValue(fabricatedMeterPrice(prices, rates, item), factor) };
};

const specialPriceDefaults: Record<string, { unit: string; unit_price: number }> = {
  "suporte viga u (galpao)": { unit: "unidade", unit_price: 25 },
  "saida tipo funil de 150x100 (galpao)": { unit: "unidade", unit_price: 20 },
};

const officialName = (product: string) => PRODUCT_RENAMES[normalizeProductName(product)] ?? product;
const specialPrice = (prices: GutterPrice[], product: string) => {
  const name = normalizeProductName(officialName(product));
  return prices.find(price => price.active && normalizeProductName(officialName(price.product)) === name && !price.thickness && !price.cut_mm)
    ?? (Object.hasOwn(specialPriceDefaults, name) ? specialPriceDefaults[name] : undefined);
};
// Fora de linha: não aparecem mais na lista (orçamentos antigos continuam abrindo).
const retiredProducts = new Set([
  "rufo", "rufo externo", "rufo interno",
  "calha de meio (cocho)", "calha moldura", "calha quadrada",
  "rufo de marquise",
  "pingadeira com rufo", "pingadeira dupla", "pingadeira para muro",
]);
const productOptions = (category: FabricatedCategory | OtherCategory, prices: GutterPrice[], current = "") => uniqueProductNames([
  ...PRODUCTS_BY_CATEGORY[category],
  ...prices.filter(p => (p.category || gutterCategoryForProduct(p.product)) === category).map(p => officialName(p.product)),
  ...(current ? [current] : []),
]).filter(name => !retiredProducts.has(normalizeProductName(name)) || normalizeProductName(current) === normalizeProductName(name))
  .reduce<string[]>((names, name) => [...names, current && normalizeProductName(current) === normalizeProductName(name) ? current : name], []);

const blankOther = (item_type: OtherCategory, prices: GutterPrice[], factor = 1): SpecialItem => ({
  item_type,
  product: PRODUCTS_BY_CATEGORY[item_type][0],
  description: "",
  unit: specialPrice(prices, PRODUCTS_BY_CATEGORY[item_type][0])?.unit || UNITS_BY_CATEGORY[item_type][0],
  quantity: 1,
  unit_price: tableValue(specialPrice(prices, PRODUCTS_BY_CATEGORY[item_type][0])?.unit_price, factor),
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

const PAINTABLE: OtherCategory[] = ["Condutores", "Acessórios"];
const NATURAL_COLOR = "Aluminio Natural";
const colorTag = /\s*·?\s*Cor:\s*([^·]+)$/i;
const splitColor = (description: string) => {
  const match = description.match(colorTag);
  return match ? { description: description.replace(colorTag, "").trim(), color: match[1].trim() } : { description, color: NATURAL_COLOR };
};
const withColor = (item: SpecialItem) => {
  const { color, ...rest } = item;
  if (!PAINTABLE.includes(item.item_type as OtherCategory) || !color || color === NATURAL_COLOR) return rest;
  return { ...rest, description: [item.description.trim(), `Cor: ${color}`].filter(Boolean).join(" · ") };
};
const isMeterUnit = (unit: string) => /^(m|metro|metros)$/i.test(unit.trim());

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
  rates,
  clients,
  initial,
  error,
}: {
  prices: GutterPrice[];
  rates: GutterQuoteRates;
  clients: QuoteClient[];
  initial?: GutterQuoteInitial;
  error?: string;
}) {
  const hasSavedPaint = initial?.special_items?.some(item => item.product.startsWith(automaticPaintPrefix));
  const [items, setItems] = useState<GutterQuoteItem[]>(() =>
    initial?.items.length ? initial.items.map(item => {
      const base = fabricatedMeterPrice(prices, rates, item);
      const saved = Number(item.unit_price);
      const paint = paintMeterPrice(rates, item.color) ?? 0;
      // Older drafts may have the current paint rate embedded in the piece price.
      const embedded = !hasSavedPaint && base !== undefined && paint > 0 && Math.abs(saved - (base + paint)) < 0.005;
      return { ...item, unit_price: embedded || !saved ? base ?? 0 : saved };
    }) : initial?.special_items?.length ? [] : [blankFabricated("Calhas", prices, rates)]
  );
  const [specialItems, setSpecialItems] = useState<SpecialItem[]>(() =>
    (initial?.special_items ?? []).filter(item => !item.product.startsWith(automaticPaintPrefix)).map((item) => {
      const item_type = otherCategoryFromRecord(item);
      const { description, color } = splitColor(cleanOtherDescription(item.description));
      return {
        ...item,
        item_type,
        description,
        color: PAINTABLE.includes(item_type) ? color : undefined,
        unit: item.unit || UNITS_BY_CATEGORY[item_type][0],
      };
    })
  );
  const [discount, setDiscount] = useState(initial?.discount ?? 0);
  const [freight, setFreight] = useState(initial?.freight ?? 0);
  const [hideUnitPrices, setHideUnitPrices] = useState(initial?.hide_unit_prices ?? true);
  const [hideTravelPrice, setHideTravelPrice] = useState(initial?.hide_travel_price ?? true);
  const [clientId, setClientId] = useState(initial?.client_id ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [pickup, setPickup] = useState(() => (initial?.notes ?? "").includes(PICKUP_NOTE_MARK));
  const factor = pickup ? PICKUP_FACTOR : 1;

  // Troca a tabela: reprecifica só os itens que estão no preço de tabela
  // (valores digitados à mão ficam) e coloca/tira a observação de retirada.
  const changeTable = (nextPickup: boolean) => {
    if (nextPickup === pickup) return;
    const from = pickup ? PICKUP_FACTOR : 1, to = nextPickup ? PICKUP_FACTOR : 1;
    const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
    setItems(curr => curr.map(item => {
      const base = fabricatedMeterPrice(prices, rates, item);
      return base !== undefined && same(item.unit_price, tableValue(base, from)) ? { ...item, unit_price: tableValue(base, to) } : item;
    }));
    setSpecialItems(curr => curr.map(item => {
      const base = specialPrice(prices, item.product)?.unit_price;
      return base !== undefined && same(item.unit_price, tableValue(base, from)) ? { ...item, unit_price: tableValue(base, to) } : item;
    }));
    setNotes(curr => {
      const without = curr.split("\n").filter(line => !line.includes(PICKUP_NOTE_MARK)).join("\n").trim();
      return nextPickup ? [PICKUP_NOTE, without].filter(Boolean).join("\n") : without;
    });
    setInstallationDeadline(curr => nextPickup ? PICKUP_DEADLINE : curr === PICKUP_DEADLINE ? "Até 15 dias" : curr);
    setPickup(nextPickup);
  };

  const [validUntil, setValidUntil] = useState(initial?.valid_until ?? addDaysISO(todayISO(), DEFAULT_QUOTE_VALIDITY_DAYS));
  const [installationDeadline, setInstallationDeadline] = useState(
    initial?.installation_deadline ?? "Até 15 dias"
  );

  /* ── Cálculos ── */
  const subtotalFab = useMemo(
    () => items.reduce((t, i) => t + i.quantity * i.meters * i.unit_price, 0),
    [items]
  );
  // Pintura: peças dobradas + condutores/acessórios vendidos por metro com cor.
  const paintItems = useMemo(() => automaticPaintItems([
    ...items,
    ...specialItems
      .filter(item => PAINTABLE.includes(item.item_type as OtherCategory) && item.color && isMeterUnit(item.unit))
      .map(item => ({ color: item.color!, quantity: item.quantity, meters: 1 })),
  ], rates).map(item => ({ ...item, unit_price: tableValue(item.unit_price, factor) })), [items, specialItems, rates, factor]);
  const subtotalOther = [...specialItems, ...paintItems].reduce((total, item) => total + item.quantity * item.unit_price, 0);
  const subtotal = subtotalFab + subtotalOther;
  const total = Math.max(0, subtotal - discount + freight);
  // Mesmas regras do servidor: avisa antes de salvar em vez de perder o orçamento no redirect.
  const invalidItem = items.findIndex(item => !(item.quantity > 0) || !(item.meters > 0));
  const invalidSpecial = specialItems.findIndex(item => !(item.quantity > 0) || !(item.unit_price >= 0) || !String(item.product ?? "").trim());
  const saveProblem = invalidItem >= 0 ? `Peça ${invalidItem + 1}: quantidade e metros precisam ser maiores que zero.`
    : invalidSpecial >= 0 ? `Item complementar ${invalidSpecial + 1}: confira produto, quantidade e valor.`
    : !(discount >= 0) ? "Desconto não pode ser negativo."
    : discount > subtotal + freight ? "Desconto maior que o subtotal."
    : null;

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
          next.unit_price = tableValue(fabricatedMeterPrice(prices, rates, next), factor);
        }
        if (key === "category") {
          next.product = blankFabricated(value as FabricatedCategory, prices, rates).product;
          next.unit_price = tableValue(fabricatedMeterPrice(prices, rates, next), factor);
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
        if (key === "product" || key === "item_type") {
          const price = specialPrice(prices, next.product);
          next.unit_price = tableValue(price?.unit_price, factor);
          next.unit = price?.unit || next.unit;
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
    hide_travel_price: hideTravelPrice,
    items,
    special_items: [...specialItems.map(withColor), ...paintItems],
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

      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <nav className="quote-steps" aria-label="Etapas do orçamento"><a href="#quote-client">1. Cliente</a><a href="#quote-items">2. Itens</a><a href="#quote-attachments">3. Anexos internos</a><a href="#quote-conditions">4. Condições e revisão</a></nav>
      <form action={initial ? updateGutterQuote : saveGutterQuote} className="grid gap-5 xl:grid-cols-[1fr_340px]">
        {initial && <input type="hidden" name="quote_id" value={initial.id} />}
        <input type="hidden" name="payload" value={payload} />
        <input type="hidden" name="valid_until" value={validUntil} />
        <input type="hidden" name="installation_deadline" value={installationDeadline} />

        <div className="space-y-4">
          {/* Cliente */}
          <div id="quote-client" className="card p-5">
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
            <div className="rounded-2xl border border-dashed border-sand bg-surface p-5 text-sm text-ink/55">
              Sem itens de fabricação própria. O orçamento será montado apenas com complementares, serviços ou itens especiais.
            </div>
          )}

          <span id="quote-items" />
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
                  rates={rates}
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
                  prices={prices}
                  onChange={changeOther}
                  onRemove={() => setSpecialItems(c => c.filter((_, i) => i !== idx))}
                />
              ))}
            </div>
          ))}

          {paintItems.length > 0 && (
            <section className="card space-y-2 p-4">
              <h2 className="font-bold">Pintura adicionada automaticamente</h2>
              {paintItems.map(item => (
                <div key={item.product} className="flex flex-wrap items-center justify-between gap-x-3 border-t pt-2 text-sm">
                  <span>{item.product}</span>
                  <span className="font-semibold">{item.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m × {money(item.unit_price)}/m · {money(item.quantity * item.unit_price)}</span>
                  {item.rateMissing && <p className="w-full text-xs text-amber-700">Tarifa de pintura ainda não cadastrada para esta cor.</p>}
                </div>
              ))}
            </section>
          )}

          {/* ── Botões para adicionar ── */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FABRICATED_CATEGORIES.map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setItems(c => [...c, blankFabricated(cat, prices, rates, factor)])}
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
                onClick={() => setSpecialItems(c => [...c, blankOther(cat, prices, factor)])}
                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-bold transition hover:shadow-sm ${CAT_COLORS[cat]}`}
              >
                <Plus className="h-3.5 w-3.5" /> {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="xl:col-start-1"><DraftQuoteAttachments /></div>
        {/* ── Sidebar de resumo ── */}
        <aside id="quote-conditions" className="card h-fit p-5 xl:col-start-2 xl:row-start-1 xl:sticky xl:top-24">
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

            <div>
              <label className="label">Tabela de preços</label>
              <div className="grid grid-cols-2 gap-1 rounded-xl border p-1" role="group" aria-label="Tabela de preços">
                {[{ value: false, label: "Com instalação" }, { value: true, label: "Retirada (−25%)" }].map(option => (
                  <button key={option.label} type="button" onClick={() => changeTable(option.value)} aria-pressed={pickup === option.value}
                    className={`rounded-lg px-2 py-2 text-xs font-bold transition ${pickup === option.value ? "bg-brand-strong text-white" : "text-ink/60 hover:bg-cream"}`}>
                    {option.label}
                  </button>
                ))}
              </div>
              {pickup && <p className="mt-1 text-xs text-ink/55">Valores de tabela e pintura com 25% de desconto e observação de retirada incluída.</p>}
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
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hideTravelPrice}
                onChange={e => setHideTravelPrice(e.target.checked)}
                className="h-4 w-4 accent-forest"
              />
              <span className="font-medium text-ink/70">Ocultar valor do deslocamento no impresso</span>
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
            {saveProblem && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{saveProblem}</p>}
            <SubmitButton disabled={!clientId || total <= 0 || !!saveProblem || (items.length === 0 && specialItems.length === 0)} className="button w-full">
              <Save className="h-4 w-4" />Salvar orçamento
            </SubmitButton>
          </div>
        </aside>
      </form>
    </div>
  );
}

/* ─── Card de item fabricado (Calhas / Rufos / Pingadeiras) ─────────────── */
function FabricatedItemCard({
  item, index, prices, rates, onChange, onDuplicate, onRemove, canRemove,
}: {
  item: GutterQuoteItem;
  index: number;
  prices: GutterPrice[];
  rates: GutterQuoteRates;
  onChange: (i: number, k: keyof GutterQuoteItem, v: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const tablePrice = fabricatedMeterPrice(prices, rates, item);
  const subtotal = item.quantity * item.meters * item.unit_price;

  return (
    <div className="rounded-xl border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Select
            label=""
            value={item.category}
            options={[...FABRICATED_CATEGORIES]}
            onChange={v => onChange(index, "category", v)}
            className="h-7 rounded-lg border-0 bg-transparent text-xs font-black"
          />
          {tablePrice !== undefined
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
          <Select label="Produto" value={withoutFloors(item.product)}
            options={productOptions(item.category, prices, withoutFloors(item.product))}
            onChange={v => onChange(index, "product", v)} />
        </div>
        {isBeiralProduct(item.product) && (
          <Select label="Pisos" value={isTwoFloors(item.product) ? "2 pisos" : "1 piso"} options={["1 piso", "2 pisos"]}
            onChange={v => onChange(index, "product", withFloors(item.product, v === "2 pisos" ? 2 : 1))} />
        )}
        <Select label="Espessura" value={item.thickness} options={gutterThicknesses} onChange={v => onChange(index, "thickness", v)} />
        <Select label="C/" value={item.cut} options={gutterCuts.map(x => `${x} mm`)} onChange={v => onChange(index, "cut", v)} />
        <Select label="Cor" value={item.color} options={gutterColors} onChange={v => onChange(index, "color", v)} />
        <NumberField label="Qtd." value={item.quantity} onChange={v => onChange(index, "quantity", v)} />
        <NumberField label="Metros" value={item.meters} onChange={v => onChange(index, "meters", v)} />
        <NumberField label="R$/metro" value={item.unit_price} onChange={v => onChange(index, "unit_price", v)} />
      </div>

      <GutterPiecePreview product={withoutFloors(item.product)} />
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-xs text-ink/40">{item.quantity} un × {item.meters}m × {money(item.unit_price)}/m</span>
        <b className="text-forest">{money(subtotal)}</b>
      </div>
    </div>
  );
}

/* ─── Card de outros itens (Condutores / Acessórios / Serviços / Especiais) ── */
function OtherItemCard({
  item, index, prices, onChange, onRemove,
}: {
  item: SpecialItem;
  prices: GutterPrice[];
  index: number;
  onChange: (i: number, k: keyof SpecialItem, v: string) => void;
  onRemove: () => void;
}) {
  const isOtherCat = OTHER_CATEGORIES.includes(item.item_type as OtherCategory);
  const productList = isOtherCat
    ? productOptions(item.item_type as OtherCategory, prices, item.product)
    : [];
  const unitList = isOtherCat
    ? UNITS_BY_CATEGORY[item.item_type as OtherCategory]
    : SPECIAL_UNITS;

  return (
    <div className="rounded-xl border bg-surface p-4 shadow-sm">
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
        {PAINTABLE.includes(item.item_type as OtherCategory) && (
          <Select label="Cor" value={item.color || NATURAL_COLOR} options={gutterColors} onChange={v => onChange(index, "color", v)} />
        )}
        <NumberField label="Quantidade" value={item.quantity} onChange={v => onChange(index, "quantity", v)} />
        <NumberField label="Valor unitário (R$)" value={item.unit_price} onChange={v => onChange(index, "unit_price", v)} />
        <div className="flex items-end pb-3">
          <p className="text-sm text-ink/50">Subtotal: <b className="text-ink">{money(item.quantity * item.unit_price)}</b></p>
        </div>
      </div>
      <GutterPiecePreview product={withoutFloors(item.product)} />
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
        {(value && !options.includes(value) ? [value, ...options] : options).map(x => <option key={x}>{x}</option>)}
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
