"use client";

import { saveGutterQuote, updateGutterQuote } from "@/app/(crm)/actions";
import { gutterColors, gutterCuts, gutterProducts, gutterThicknesses, type GutterPrice, type QuoteClient } from "@/lib/gutters";
import { localISODate, money } from "@/lib/utils";
import { Copy, Database, Package, Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

export type GutterQuoteItem = { product: string; thickness: string; cut: string; color: string; quantity: number; meters: number; unit_price: number };
type Item = GutterQuoteItem;
export type SpecialItem = { product: string; description: string; unit: string; quantity: number; unit_price: number };
export type GutterQuoteInitial={id:string;client_id:string;discount:number;freight:number;notes:string;valid_until:string;installation_deadline:string;items:GutterQuoteItem[];special_items?:SpecialItem[]};

const SPECIAL_UNITS = ["unidade","peça","serviço","diária","pacote","metro","kg","hora","personalizada"];

const blankSpecial = (): SpecialItem => ({ product: "", description: "", unit: "unidade", quantity: 1, unit_price: 0 });

const findPrice = (prices: GutterPrice[], item: Pick<Item, "product" | "thickness" | "cut" | "color">) =>
  prices.find(x => x.active && x.product === item.product && x.thickness === item.thickness && x.cut_mm === Number(item.cut.replace(/\D/g, "")) && (x.color ?? "Natural") === item.color);

const blank = (prices: GutterPrice[]): Item => {
  const item = { product: "Calha de Beiral", thickness: "0.50 mm", cut: "300 mm", color: "Natural", quantity: 1, meters: 1, unit_price: 0 };
  return { ...item, unit_price: Number(findPrice(prices, item)?.unit_price ?? 0) };
};

export function GutterQuote({ prices, clients, initial }: { prices: GutterPrice[]; clients: QuoteClient[];initial?:GutterQuoteInitial }) {
  const [items, setItems] = useState<Item[]>(() => initial?.items.length?initial.items:[blank(prices)]);
  const [specialItems, setSpecialItems] = useState<SpecialItem[]>(() => initial?.special_items ?? []);
  const [discount, setDiscount] = useState(initial?.discount??0);
  const [freight, setFreight] = useState(initial?.freight??0);
  const [clientId, setClientId] = useState(initial?.client_id??"");
  const [notes, setNotes] = useState(initial?.notes??"");
  const today = new Date(); today.setDate(today.getDate() + 30);
  const defaultValid = localISODate(today);
  const [validUntil, setValidUntil] = useState(initial?.valid_until??defaultValid);
  const [installationDeadline, setInstallationDeadline] = useState(initial?.installation_deadline??"Até 15 dias após aprovação e conferência final das medidas");
  const subtotalCalhas = useMemo(() => items.reduce((t, item) => t + item.quantity * item.meters * item.unit_price, 0), [items]);
  const subtotalEspeciais = useMemo(() => specialItems.reduce((t, item) => t + item.quantity * item.unit_price, 0), [specialItems]);
  const subtotal = subtotalCalhas + subtotalEspeciais;
  const total = Math.max(0, subtotal - discount + freight);
  const change = (index: number, key: keyof Item, value: string) =>
    setItems(current => current.map((item, i) => {
      if (i !== index) return item;
      const next = { ...item, [key]: ["quantity", "meters", "unit_price"].includes(key) ? Number(value) : value } as Item;
      if (["product", "thickness", "cut", "color"].includes(key)) {
        const price = findPrice(prices, next);
        next.unit_price = Number(price?.unit_price ?? 0);
      }
      return next;
    }));
  const changeSpecial = (index: number, key: keyof SpecialItem, value: string) =>
    setSpecialItems(current => current.map((item, i) => {
      if (i !== index) return item;
      return { ...item, [key]: ["quantity","unit_price"].includes(key) ? Number(value) : value };
    }));
  const payload = JSON.stringify({ client_id: clientId, discount, freight, notes, items, special_items: specialItems });
  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Calculadora tecnica</p>
          <h1 className="mt-2 text-3xl font-black">{initial?"Editar orçamento de calhas":"Orçamento de calhas"}</h1>
          <p className="mt-1 text-sm text-ink/50">Quantidade x metragem x preco por metro.</p>
        </div>
        <span className="flex items-center gap-2 text-xs font-bold text-ink/45"><Database className="h-4 w-4" />{prices.length} precos cadastrados</span>
      </div>
      <form action={initial?updateGutterQuote:saveGutterQuote} className="grid gap-5 xl:grid-cols-[1fr_340px]">
        {initial&&<input type="hidden" name="quote_id" value={initial.id}/>}
        <input type="hidden" name="payload" value={payload} />
        <input type="hidden" name="valid_until" value={validUntil} />
        <input type="hidden" name="installation_deadline" value={installationDeadline} />
        <div className="space-y-4">
          <div className="card p-5">
            <label className="label">Cliente</label>
            <select className="field" value={clientId} onChange={e => setClientId(e.target.value)} required>
              <option value="">Selecione o cliente</option>
              {clients.map(client => (
                <option value={client.id} key={client.id}>
                  {client.name}{client.city ? ` . ${client.city}` : ""}{client.phone ? ` . ${client.phone}` : ""}
                </option>
              ))}
            </select>
            {!clients.length && <p className="mt-2 text-xs text-amber-700">Cadastre um cliente antes de criar o orcamento.</p>}
          </div>
          {items.map((item, index) => {
            const tablePrice = findPrice(prices, item);
            return (
              <div className="card p-5" key={index}>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <b>Item {index + 1}</b>
                    {tablePrice
                      ? <p className="mt-1 flex items-center gap-1 text-xs font-bold text-emerald-700"><Database className="h-3.5 w-3.5" />Preco preenchido pela tabela</p>
                      : <p className="mt-1 text-xs text-amber-700">Sem combinacao cadastrada: informe o preco manualmente.</p>}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" title="Duplicar" className="button-ghost p-2" onClick={() => setItems(current => [...current.slice(0, index + 1), { ...item }, ...current.slice(index + 1)])}><Copy className="h-4 w-4" /></button>
                    <button type="button" title="Excluir" disabled={items.length === 1} className="button-ghost p-2 text-red-600" onClick={() => setItems(current => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-4">
                  <Select label="Produto" value={item.product} options={gutterProducts} onChange={v => change(index, "product", v)} />
                  <Select label="Espessura" value={item.thickness} options={gutterThicknesses} onChange={v => change(index, "thickness", v)} />
                  <Select label="Corte" value={item.cut} options={gutterCuts.map(x => `${x} mm`)} onChange={v => change(index, "cut", v)} />
                  <Select label="Cor" value={item.color} options={gutterColors} onChange={v => change(index, "color", v)} />
                  <NumberField label="Quantidade" value={item.quantity} onChange={v => change(index, "quantity", v)} />
                  <NumberField label="Metragem" value={item.meters} onChange={v => change(index, "meters", v)} />
                  <NumberField label="Preco / metro" value={item.unit_price} onChange={v => change(index, "unit_price", v)} />
                </div>
                <div className="mt-4 text-right text-sm text-ink/50">Subtotal do item: <b className="text-ink">{money(item.quantity * item.meters * item.unit_price)}</b></div>
              </div>
            );
          })}
          <button type="button" className="button-ghost w-full border-dashed" onClick={() => setItems(current => [...current, blank(prices)])}><Plus className="h-4 w-4" />Adicionar item de calha</button>

          {/* Itens Especiais / Serviços / Acessórios */}
          <div className="mt-2">
            <div className="mb-3 flex items-center gap-2">
              <Package className="h-4 w-4 text-forest" />
              <h2 className="font-bold text-ink">Itens Especiais / Serviços / Acessórios</h2>
              <span className="text-xs text-ink/40">(PU MS40, silicone, mão de obra, frete…)</span>
            </div>
            {specialItems.map((item, index) => (
              <div className="card mb-3 p-4" key={index}>
                <div className="mb-3 flex items-center justify-between">
                  <b className="text-sm text-ink/70">Item especial {index + 1}</b>
                  <button type="button" className="button-ghost p-1.5 text-red-600" onClick={() => setSpecialItems(c => c.filter((_,i)=>i!==index))}><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                  <div className="sm:col-span-2">
                    <label className="label">Produto / Serviço</label>
                    <input className="field" type="text" placeholder="Ex: PU MS40, Mão de obra, Frete…" value={item.product} onChange={e => changeSpecial(index,"product",e.target.value)} required />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Descrição (opcional)</label>
                    <input className="field" type="text" placeholder="Detalhes adicionais…" value={item.description} onChange={e => changeSpecial(index,"description",e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Unidade</label>
                    <select className="field" value={item.unit} onChange={e => changeSpecial(index,"unit",e.target.value)}>
                      {SPECIAL_UNITS.map(u => <option key={u} value={u}>{u.charAt(0).toUpperCase()+u.slice(1)}</option>)}
                    </select>
                  </div>
                  <NumberField label="Quantidade" value={item.quantity} onChange={v => changeSpecial(index,"quantity",v)} />
                  <NumberField label="Valor unitário (R$)" value={item.unit_price} onChange={v => changeSpecial(index,"unit_price",v)} />
                  <div className="flex items-end"><p className="text-sm text-ink/50">Subtotal: <b className="text-ink">{money(item.quantity * item.unit_price)}</b></p></div>
                </div>
              </div>
            ))}
            <button type="button" className="button-ghost w-full border-dashed border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => setSpecialItems(c => [...c, blankSpecial()])}><Plus className="h-4 w-4" />Adicionar item especial / serviço</button>
          </div>
        </div>
        <aside className="card h-fit p-5 xl:sticky xl:top-24">
          <h2 className="text-lg font-black">Resumo</h2>
          <div className="mt-5 space-y-4">
            <div className="flex justify-between text-sm"><span className="text-ink/50">Subtotal</span><b>{money(subtotal)}</b></div>
            <NumberField label="Desconto (R$)" value={discount} onChange={v => setDiscount(Number(v))} />
            <NumberField label="Frete (R$)" value={freight} onChange={v => setFreight(Number(v))} />
            <div><label className="label">Observações</label><textarea className="field min-h-24" value={notes} onChange={e => setNotes(e.target.value)} /></div>
            <div><label className="label">Validade do orçamento</label><input type="date" className="field" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></div>
            <div><label className="label">Prazo de instalação</label><input type="text" className="field" value={installationDeadline} onChange={e => setInstallationDeadline(e.target.value)} placeholder="Ex: Até 15 dias após aprovação e conferência das medidas" /></div>
            <div className="border-t pt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-ink/45">Total</p>
              <p className="mt-1 text-3xl font-black text-forest">{money(total)}</p>
            </div>
            <button disabled={!clientId || total <= 0} className="button w-full"><Save className="h-4 w-4" />Salvar orçamento</button>
          </div>
        </aside>
      </form>
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return <div><label className="label">{label}</label><select className="field" value={value} onChange={e => onChange(e.target.value)}>{options.map(x => <option key={x}>{x}</option>)}</select></div>;
}
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return <div><label className="label">{label}</label><input className="field" type="number" min="0" step="0.01" value={value} onChange={e => onChange(e.target.value)} /></div>;
}
