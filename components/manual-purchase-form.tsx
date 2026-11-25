"use client";

import { todayISO } from "@/lib/utils";
import { useErrorDraft } from "@/lib/form-draft";
import Link from "next/link";
import { ArrowLeft, Building2, Plus, Save, StickyNote, Trash2, Truck } from "lucide-react";
import { FormBlock, ItemBadge, Note, Segmented } from "@/components/form-blocks";
import { createManualPurchase } from "@/app/(crm)/actions";
import { money } from "@/lib/utils";
import { ReceivingAccountSelect } from "@/components/receiving-account-select";
import { InvoiceUpload } from "@/components/invoice-upload";
import { useMemo, useState } from "react";

type Supplier = { id: string; name: string; credit?: number };
type Material = { id: string; name: string; unit: string };
type Order = { id: string; label: string };
type Item = { category: string; description: string; quantity: number; unit_price: number; code?: string };
type PaidMode = "total" | "parte" | "nao";

// Tipos do que se compra na Marquinhos; "Outro" pede para digitar.
export const PURCHASE_TYPES = ["Perfil", "Acessório", "Componentes para calhas", "Componentes para esquadrias", "Alumínio bobina", "Cano", "Material elétrico/eletrônico", "Outro"];
const METHODS = ["Pix", "Dinheiro", "Cartão de crédito", "Cartão de débito", "Boleto", "Transferência", "Cheque", "Outro"];
const blank = (): Item => ({ category: "Perfil", description: "", quantity: 1, unit_price: 0 });
const round = (n: number) => Math.round(n * 100) / 100;

export function ManualPurchaseForm({ suppliers, orders = [], error }: { suppliers: Supplier[]; orders?: Order[]; materials?: Material[]; error?: string }) {
  const [items, setItems] = useState<Item[]>([blank()]);
  const [supplierId, setSupplierId] = useState("");
  const [mode, setMode] = useState<PaidMode>("total");
  const [paid, setPaid] = useState(0);
  const [paidAt, setPaidAt] = useState(todayISO());
  const [method, setMethod] = useState("Pix");
  const [account, setAccount] = useState("");
  const [due, setDue] = useState("");
  const [useCredit, setUseCredit] = useState(false);
  const [notes, setNotes] = useState("");
  const [expected, setExpected] = useState("");
  const [destino, setDestino] = useState<"estoque" | "pedido">("estoque");
  const [orderId, setOrderId] = useState("");
  const [invoiceNote, setInvoiceNote] = useState("");
  const rememberDraft = useErrorDraft("draft:compra-manual-v3", { items, supplierId, mode, paid, paidAt, method, due, notes, expected, destino, orderId }, (d) => {
    setItems(d.items); setSupplierId(d.supplierId); setMode(d.mode); setPaid(d.paid); setPaidAt(d.paidAt); setMethod(d.method); setDue(d.due); setNotes(d.notes); setExpected(d.expected); setDestino(d.destino); setOrderId(d.orderId);
  });
  const total = useMemo(() => round(items.reduce((sum, x) => sum + x.quantity * x.unit_price, 0)), [items]);
  const credit = suppliers.find((s) => s.id === supplierId)?.credit ?? 0;
  const creditUsed = useCredit ? round(Math.min(credit, total)) : 0;
  const payNow = mode === "nao" ? 0 : mode === "total" ? round(total - creditUsed) : paid;
  const balance = round(total - creditUsed - payNow); // >0 devendo, <0 credito
  const invalidItem = items.some((x) => (x.category === "Outro" && !x.description.trim()) || x.quantity <= 0 || x.unit_price < 0 || !Number.isFinite(x.quantity * x.unit_price));
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  // Arquivo da nota/orçamento lido pela IA: fica anexado na compra ao salvar.
  const [attachment, setAttachment] = useState<{ path: string; name: string; type: string } | null>(null);
  const payload = JSON.stringify({
    supplier_id: supplierId, paid_amount: payNow, paid_at: paidAt, payment_method: method, receiving_account_id: payNow > 0 ? account : "",
    allow_duplicate: allowDuplicate, use_credit: creditUsed, due_date: balance > 0 ? due : "", notes, expected_at: expected, order_id: destino === "pedido" ? orderId : "",
    items: items.map((x) => ({ category: x.category, description: x.description.trim() || x.category, unit: "un", quantity: x.quantity, unit_price: x.unit_price, notes: "", code: x.code?.trim() || undefined })),
    attachment,
  });
  const update = (index: number, patch: Partial<Item>) => setItems((current) => current.map((x, i) => (i === index ? { ...x, ...patch } : x)));

  return <div className="mx-auto max-w-5xl">
    <Link href="/compras" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-ink/55"><ArrowLeft className="h-4 w-4" />Voltar</Link>
    <div className="mb-7"><p className="text-xs font-semibold text-forest">Lançamento manual</p><h1 className="mt-2 text-3xl font-semibold">Nova compra</h1><p className="mt-1 text-sm text-ink/50">O que comprou, de quem, quanto custou e como pagou.</p></div>
    {error && <Note tone="error" role="alert" className="mb-5">{error}</Note>}
    {error?.startsWith("Compra parecida") && <label className="fx-note fx-note-warn mb-5"><input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} />É outra compra, não é duplicada (marque e salve de novo)</label>}
    <InvoiceUpload onRead={(r) => {
      setItems(r.items);
      setAttachment(r.attachment ?? null);
      if (r.supplierId) { setSupplierId(r.supplierId); setUseCredit(false); }
      if (r.dueDate && r.dueDate > todayISO()) { setMode("nao"); setDue(r.dueDate); }
      const parcelas = r.installments.filter((x) => x.data).map((x) => `${x.data!.split("-").reverse().join("/")}${x.valor ? ` ${money(x.valor)}` : ""}`).join(", ");
      setNotes((n) => [n, r.number ? `NF ${r.number}` : "", parcelas ? `Parcelas: ${parcelas}` : ""].filter(Boolean).join(" · "));
      const sum = Math.round(r.items.reduce((t, x) => t + x.quantity * x.unit_price, 0) * 100) / 100;
      const msgs = [`Nota lida: ${r.items.length} item(ns). Confira antes de cadastrar.`];
      if (!r.supplierId) msgs.push(`Fornecedor ${r.supplierName ?? ""} ${r.supplierCnpj ?? ""} não encontrado no cadastro: escolha ou cadastre em Fornecedores.`);
      if (r.total && Math.abs(r.total - sum) > 0.05) msgs.push(`Atenção: total da nota ${money(r.total)} e soma dos itens ${money(sum)} não batem (frete/impostos/desconto?).`);
      setInvoiceNote(msgs.join(" "));
    }} />
    {invoiceNote && <Note tone="warn" className="mb-5">{invoiceNote}</Note>}
    <form data-warn-unsaved onSubmit={rememberDraft} action={createManualPurchase} className="fx-layout">
      <input type="hidden" name="payload" value={payload} />
      <div className="fx-stack">
        <FormBlock icon={Building2} title="Fornecedor" hint="De quem você comprou.">
          <label className="label" htmlFor="compra-fornecedor">Fornecedor</label>
          <select id="compra-fornecedor" aria-label="Fornecedor" className="field" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setUseCredit(false); }} required>
            <option value="">Selecione</option>{suppliers.map((x) => <option value={x.id} key={x.id}>{x.name}</option>)}
          </select>
          {credit > 0 && <label className="fx-note fx-note-ok mt-3"><input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} />Usar crédito que o fornecedor tem ({money(credit)})</label>}
        </FormBlock>
        {items.map((item, index) => <div className="fx-item" key={index}>
          <div className="fx-item-head"><ItemBadge n={index + 1} /><b className="fx-item-title">{items.length > 1 ? `Item ${index + 1}` : "O que está comprando"}</b>
            {items.length > 1 && <button type="button" aria-label="Remover item" className="fx-remove" onClick={() => setItems((x) => x.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></button>}</div>
          <div className="fx-chips" role="group" aria-label="Tipo do que comprou">{PURCHASE_TYPES.map((t) => <button type="button" key={t} aria-pressed={item.category === t} onClick={() => update(index, { category: t })} className="fx-chip">{t}</button>)}</div>
          <div className="fx-grid fx-grid-pair fx-grid-item">
            <div><label className="label" htmlFor={`cod-${index}`}>Código</label><input id={`cod-${index}`} aria-label="Código do produto" className="field" value={item.code ?? ""} onChange={(e) => update(index, { code: e.target.value })} placeholder="Ex.: PSU001-PT" /></div>
            <div className="fx-wide"><label className="label" htmlFor={`desc-${index}`}>Descrição do material</label><input id={`desc-${index}`} aria-label="Descrição do material" className="field" value={item.description} onChange={(e) => update(index, { description: e.target.value })} required={item.category === "Outro"} placeholder={item.category === "Outro" ? "Digite o que está comprando" : `${item.category} (opcional: detalhe)`} /></div>
            <div><label className="label" htmlFor={`qtd-${index}`}>Quantidade</label><input id={`qtd-${index}`} aria-label="Quantidade" className="field" type="number" min="0.001" step="0.001" value={item.quantity} onChange={(e) => update(index, { quantity: Number(e.target.value) })} required /></div>
            <div><label className="label" htmlFor={`val-${index}`}>Valor unitário</label><input id={`val-${index}`} aria-label="Valor unitário" className="field" type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => update(index, { unit_price: Number(e.target.value) })} required /></div>
          </div>
          {items.length > 1 && <p className="fx-item-total"><span>Total do item</span><b>{money(item.quantity * item.unit_price)}</b></p>}
        </div>)}
        <button type="button" className="fx-add" onClick={() => setItems((x) => [...x, blank()])}><Plus className="h-4 w-4" />Adicionar outro item</button>
        <FormBlock icon={Truck} title="Entrega e destino" hint="Quando chega e para onde vai.">
          <div className="fx-grid fx-grid-2">
            <div><label className="label" htmlFor="compra-previsao">Previsão de entrega</label><input id="compra-previsao" className="field" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /><p className="mt-1 text-xs text-ink/50">Deixe vazio se já chegou.</p></div>
            <div><Segmented label="É para" value={destino} onChange={setDestino} options={[["estoque", "Estoque"], ["pedido", "Um pedido"]] as const} />
              {destino === "pedido" && <select aria-label="Pedido" className="field mt-2" value={orderId} onChange={(e) => setOrderId(e.target.value)} required><option value="">Escolha o pedido</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
            </div>
          </div>
        </FormBlock>
        <FormBlock icon={StickyNote} title="Observações"><label className="sr-only" htmlFor="compra-obs">Observações</label><textarea id="compra-obs" className="field min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} /></FormBlock>
      </div>

      <aside className="fx-summary" aria-label="Resumo e pagamento">
        <div><h2 className="fx-total-label">Total da compra</h2><p className="fx-total">{money(total)}</p>{creditUsed > 0 && <p className="fx-total-sub">− {money(creditUsed)} de crédito</p>}</div>
        <Segmented label="Pagou?" value={mode} onChange={(v) => { setMode(v); if (v === "parte") setPaid(round(total - creditUsed)); }} options={[["total", "Pagou tudo"], ["parte", "Outro valor"], ["nao", "Não pagou"]] as const} />
        {mode === "parte" && <div><label className="label" htmlFor="compra-pago">Valor pago</label><input id="compra-pago" aria-label="Valor já pago" className="field" type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(Number(e.target.value))} required /></div>}
        {mode !== "nao" && <>
          <div className="fx-grid fx-grid-pair">
            <div><label className="label" htmlFor="compra-metodo">Como pagou</label><select id="compra-metodo" className="field" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((x) => <option key={x}>{x}</option>)}</select></div>
            <div><label className="label" htmlFor="compra-data">Quando</label><input id="compra-data" className="field" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required /></div>
          </div>
          <div><label className="label">Conta que pagou</label><ReceivingAccountSelect name="_conta" value={account} onChange={setAccount} className="field" /></div>
        </>}
        {total > 0 && <Note tone={balance > 0 ? "warn" : balance < 0 ? "ok" : "info"}>
          {balance > 0 ? `Fica devendo ${money(balance)} ao fornecedor` : balance < 0 ? `Fica ${money(-balance)} de crédito com o fornecedor` : "Compra quitada"}
        </Note>}
        {balance > 0 && <div><label className="label" htmlFor="compra-venc">Vencimento do que ficou devendo</label><input id="compra-venc" className="field" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>}
        <button disabled={!supplierId || total <= 0 || payNow < 0 || invalidItem || (destino === "pedido" && !orderId)} className="button fx-submit"><Save className="h-4 w-4" />Cadastrar compra</button>
      </aside>
    </form>
  </div>;
}
