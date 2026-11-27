// Monta os dados do recibo a partir do pagamento (somente servidor, service role).
import type { SupabaseClient } from "@supabase/supabase-js";
import { valorPorExtenso } from "./extenso";
import { paymentMethodLabel, type ReceiptData, type ReceiptItem } from "./receipt-html";
import { brCity, formatBrPhone } from "@/lib/whatsapp/phone";
import { firstName } from "@/lib/seller-name";

type Row = Record<string, any>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const round = (v: number) => Math.round(v * 100) / 100;
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export function formatCompanyTaxId(value?: string | null) {
  const d = digits(value);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : String(value ?? "").trim();
}

/** CPF mascarado (LGPD); CNPJ completo. */
export function clientDocument(value?: string | null): { label: string; value: string } {
  const d = digits(value);
  if (d.length === 11) return { label: "CPF", value: `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` };
  if (d.length === 14) return { label: "CNPJ", value: formatCompanyTaxId(d) };
  return { label: "CPF/CNPJ", value: "" };
}

export function formatPhone(value?: string | null) {
  const d = digits(value);
  const local = /^55\d{10,11}$/.test(d) ? d.slice(2) : d;
  return /^\d{10,11}$/.test(local) ? formatBrPhone(local) : String(value ?? "").trim();
}

/** Celular para envio no WhatsApp (55 + DDD + 9 + número) ou null. Telefone fixo não tem WhatsApp. */
export function whatsappNumber(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    let d = digits(v);
    if (/^55\d{10,11}$/.test(d)) d = d.slice(2);
    // Celular antigo sem o 9 (ex.: 47 9969-0082): acrescenta o 9.
    if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
    if (/^[1-9]{2}9\d{8}$/.test(d)) return `55${d}`;
  }
  return null;
}

/** Por que o recibo não pôde ir pelo WhatsApp (texto para a tela). */
export function noWhatsappReason(...values: Array<string | null | undefined>): string {
  const filled = values.map(digits).filter((d) => d.length >= 8);
  return filled.length ? "Telefone fixo no cadastro: sem WhatsApp. Cadastre o celular do cliente e toque em Enviar ao cliente."
    : "Cliente sem celular (WhatsApp) no cadastro. Cadastre e toque em Enviar ao cliente.";
}

const UNIT_LABEL: Record<string, string> = { m: "m", metro: "m", "metro linear (m)": "m", un: "un", unidade: "un", kg: "kg", m2: "m²", "m²": "m²", h: "h", hora: "h", diaria: "diária", "diária": "diária", servico: "serv.", "serviço": "serv.", vb: "vb" };
const PREFIXES = new Set(["condutores", "acessorios", "servicos", "itens especiais"]);
const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** "Itens especiais | Tubo PU" -> "Tubo PU" (mesma limpeza do orçamento). */
export function cleanDetail(value: unknown): string | null {
  const parts = String(value ?? "").split("|").map((x) => x.trim()).filter(Boolean);
  if (parts[0] && PREFIXES.has(norm(parts[0]))) parts.shift();
  return parts.join(" | ") || null;
}
const unitLabel = (u?: string | null) => UNIT_LABEL[String(u ?? "un").trim().toLowerCase()] ?? String(u ?? "un").trim().toLowerCase();

export type ReceiptBundle = {
  data: ReceiptData; companyId: string; clientName: string; companyQrUrl: string | null;
  /** Celular do cadastro, ou null. */ phone: string | null;
  /** Conversa da cobrança Pix (contato sem cadastro): envia por ela. */ conversationId: string | null;
  noPhoneReason: string; reversed: boolean; whatsappPhoneNumberId: string | null;
};

export async function loadReceiptData(db: SupabaseClient, receipt: { payment_id: string; receipt_number: number; created_at: string }): Promise<ReceiptBundle> {
  const { data: payment, error } = await db.from("payments")
    .select("id,company_id,financial_entry_id,amount,paid_at,payment_method,receiving_account_name,notes,created_by,created_at,reversed_at")
    .eq("id", receipt.payment_id).single();
  if (error || !payment) throw new Error(`Pagamento não encontrado: ${error?.message ?? receipt.payment_id}`);
  const p = payment as Row;
  const { data: entryRow } = await db.from("financial_entries")
    .select("id,client_id,sale_id,description,total_amount,interest_amount,discount_amount,status").eq("id", p.financial_entry_id).single();
  if (!entryRow) throw new Error("Conta a receber não encontrada.");
  const entry = entryRow as Row;

  const saleId: string | null = entry.sale_id ?? null;
  const [company, client, operator, sale, order, quote, scope, pixCharge] = await Promise.all([
    db.from("companies").select("*").eq("id", p.company_id).single().then((r) => r.data as Row | null),
    entry.client_id ? db.from("clients").select("name,phone,whatsapp,tax_id,city,state").eq("id", entry.client_id).maybeSingle().then((r) => r.data as Row | null) : null,
    p.created_by ? db.from("profiles").select("full_name").eq("id", p.created_by).maybeSingle().then((r) => r.data as Row | null) : null,
    saleId ? db.from("sales").select("sale_number").eq("id", saleId).maybeSingle().then((r) => r.data as Row | null) : null,
    saleId ? db.from("orders").select("order_number").eq("sale_id", saleId).order("created_at").limit(1).maybeSingle().then((r) => r.data as Row | null) : null,
    saleId ? db.from("quotes").select("id,quote_number,discount,freight").eq("sale_id", saleId).order("created_at", { ascending: false }).limit(1).maybeSingle().then((r) => r.data as Row | null) : null,
    saleId
      ? db.from("financial_entries").select("id,total_amount,interest_amount,discount_amount,status").eq("sale_id", saleId).eq("entry_type", "receber").then((r) => (r.data ?? []) as Row[])
      : Promise.resolve([entry]),
    db.from("pix_charges").select("conversation_id").eq("payment_id", p.id).maybeSingle().then((r) => r.data as Row | null),
  ]);
  if (!company) throw new Error("Empresa não encontrada.");

  const entries = scope.filter((e) => e.status !== "cancelado" || e.id === entry.id);
  const entryIds = entries.map((e) => e.id as string);
  const { data: paysRaw } = await db.from("payments").select("id,amount,created_at,reversed_at").in("financial_entry_id", entryIds);
  const createdAt = new Date(p.created_at).getTime();
  const paidBefore = round(((paysRaw ?? []) as Row[])
    .filter((x) => !x.reversed_at && x.id !== p.id && (new Date(x.created_at).getTime() < createdAt || (new Date(x.created_at).getTime() === createdAt && String(x.id) < String(p.id))))
    .reduce((s, x) => s + num(x.amount), 0));
  const net = round(entries.reduce((s, e) => s + num(e.total_amount), 0));
  // Desconto dado no orçamento já vem abatido no total da venda: entra no resumo para fechar com os itens.
  const quoteDiscount = num(quote?.discount), freight = num(quote?.freight);
  const discount = round(entries.reduce((s, e) => s + num(e.discount_amount), 0) + quoteDiscount);
  const interest = round(entries.reduce((s, e) => s + num(e.interest_amount), 0));
  const gross = round(net - interest + discount);
  const amount = round(num(p.amount));

  let items: ReceiptItem[] = [];
  if (saleId) {
    const { data } = await db.from("sale_items").select("product,description,unit,quantity,unit_price,total").eq("sale_id", saleId);
    items = ((data ?? []) as Row[]).map((i) => ({ description: String(i.product ?? "Item"), detail: cleanDetail(i.description), unit: unitLabel(i.unit), quantity: num(i.quantity), total: round(num(i.total ?? num(i.quantity) * num(i.unit_price))) }));
    if (!items.length && quote?.id) {
      const { data: qi } = await db.from("quote_items").select("product,description,unit,quantity,unit_price,total").eq("quote_id", quote.id);
      items = ((qi ?? []) as Row[]).map((i) => ({ description: String(i.product ?? "Item"), detail: cleanDetail(i.description), unit: unitLabel(i.unit), quantity: num(i.quantity), total: round(num(i.total ?? num(i.quantity) * num(i.unit_price))) }));
    }
  }
  if (items.length && freight > 0 && !items.some((i) => /frete/i.test(i.description))) items.push({ description: "Frete", detail: null, unit: "vb", quantity: 1, total: round(freight) });
  if (!items.length) items = [{ description: String(entry.description || "Pagamento"), detail: null, unit: "un", quantity: 1, total: gross }];

  // Contato sem cadastro (Pix cobrado no Atendimento): nome e telefone da conversa.
  const conv = !client && pixCharge?.conversation_id
    ? (await db.from("conversations").select("contact_name,phone,external_id").eq("id", pixCharge.conversation_id).eq("company_id", p.company_id).maybeSingle()).data as Row | null
    : null;
  const c = company;
  const city = brCity(c.city);
  const cityUf = [city, c.state].filter(Boolean).join("/");
  const doc = clientDocument(client?.tax_id);
  const clientCity = brCity(client?.city);
  const data: ReceiptData = {
    receiptNumber: String(receipt.receipt_number).padStart(6, "0"),
    issuedAt: new Date().toISOString(),
    paidAt: String(p.paid_at),
    paymentCreatedAt: String(p.created_at),
    method: paymentMethodLabel(p.payment_method),
    account: p.receiving_account_name ?? null,
    operator: firstName(operator?.full_name) || null,
    quoteNumber: quote?.quote_number ?? null,
    orderNumber: order?.order_number ?? null,
    saleNumber: sale?.sale_number ?? null,
    reference: String(entry.description || "lançamento"),
    hasOrder: Boolean(saleId),
    company: {
      name: String(c.trade_name || c.name || ""),
      taxId: formatCompanyTaxId(c.tax_id),
      address: [c.address, c.neighborhood, cityUf].filter(Boolean).join(", "),
      cityUf,
      phone: formatPhone(c.phone),
      whatsapp: formatPhone(c.whatsapp),
      email: String(c.email ?? ""),
      website: String(c.website ?? ""),
      qrLabel: String(c.qr_code_label || "Nosso portfólio"),
    },
    client: {
      name: String(client?.name || conv?.contact_name || "Cliente"),
      document: doc.value,
      documentLabel: doc.label,
      phone: formatPhone(client?.whatsapp || client?.phone || conv?.phone),
      city: [clientCity, client?.state || (clientCity === "Jaraguá do Sul" ? "SC" : "")].filter(Boolean).join(" - "),
    },
    items,
    gross, discount, interest, net, paidBefore, amount,
    balance: round(net - paidBefore - amount),
    amountInWords: valorPorExtenso(amount),
    notes: null,
  };
  const qr = /^https?:\/\//i.test(String(c.qr_code_url || "")) ? String(c.qr_code_url) : "https://3d.bielenki.com.br/";
  const phone = whatsappNumber(client?.whatsapp, client?.phone);
  return {
    data, companyId: String(p.company_id), clientName: data.client.name, companyQrUrl: qr,
    phone, conversationId: phone ? null : (pixCharge?.conversation_id ?? null),
    noPhoneReason: noWhatsappReason(client?.whatsapp, client?.phone),
    reversed: Boolean(p.reversed_at), whatsappPhoneNumberId: c.whatsapp_phone_number_id ?? null,
  };
}
