import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { approveQuote, deleteQuote, duplicateQuote } from "@/app/(crm)/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { PrintButton } from "@/components/print-button";
import { QuoteSellerField } from "@/components/quote-seller-field";
import { QuotePaymentMethods } from "@/components/quote-payment-methods";
import { createClient } from "@/lib/supabase/server";
import { money, proxyLogoUrl, shortDate } from "@/lib/utils";

const TOTAL_LINHAS = 20;

type Row = Record<string, unknown>;

type CompanyData = {
  name?: string | null;
  trade_name?: string | null;
  tax_id?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  quote_footer?: string | null;
  qr_code_url?: string | null;
  qr_code_label?: string | null;
  payment_methods_available?: string[] | null;
};

type QuoteData = {
  id: string;
  quote_number: string;
  status: string;
  subtotal: number;
  discount: number;
  freight: number;
  total: number;
  valid_until: string | null;
  installation_deadline: string | null;
  notes: string | null;
  client_notes: string | null;
  seller_name: string | null;
  payment_methods: string[] | null;
  hide_unit_prices: boolean;
  created_at: string;
  client: Row;
  company: CompanyData;
};

type QuoteItem = {
  product: string;
  description?: string | null;
  thickness?: string | null;
  cut?: string | null;
  color?: string | null;
  category?: string | null;
  unit?: string | null;
  quantity: number;
  meters?: number | null;
  unit_price: number;
  total: number;
  item_type?: string | null;
};

const PAYMENT_LABELS: Record<string, string> = {
  pix: "PIX",
  cartao: "Cartão",
  cheque: "Cheque",
  dinheiro: "Dinheiro",
};

const COMPLEMENTARY_PREFIXES = new Set(["condutores", "acessorios", "servicos", "itens especiais"]);

function normalizeLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isComplementaryQuoteItem(item: QuoteItem) {
  const itemType = String(item.item_type || "");
  return Boolean(itemType) && !["calha", "esquadria", "fabricacao"].includes(itemType);
}

function isSpecialItem(item: QuoteItem) {
  return isComplementaryQuoteItem(item) || (!item.thickness && !item.cut && !item.meters);
}

function cleanSpecialDescription(description?: string | null) {
  const parts = String(description || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts[0] && COMPLEMENTARY_PREFIXES.has(normalizeLabel(parts[0]))) {
    return parts.slice(1).join(" | ");
  }
  return parts.join(" | ");
}

function quoteItemTotal(item: QuoteItem, isGutter: boolean) {
  if (isGutter && !isSpecialItem(item)) {
    return Number(item.quantity || 0) * Number(item.meters || 0) * Number(item.unit_price || 0);
  }
  return Number(item.total ?? Number(item.quantity || 0) * Number(item.unit_price || 0));
}

function buildDescription(item: QuoteItem, isGutter: boolean) {
  if (!isGutter || isSpecialItem(item)) {
    return [item.product, cleanSpecialDescription(item.description)].filter(Boolean).join(" | ");
  }
  const parts = [item.product];
  if (item.thickness) parts.push(item.thickness);
  if (item.cut) parts.push(`c/${item.cut}`);
  if (item.color && item.color !== "Aluminio Natural") parts.push(item.color);
  return parts.join(" ");
}

function buildTipoQuantidade(item: QuoteItem, isGutter: boolean): { tipo: string; quantidade: string } {
  if (!isGutter || isSpecialItem(item)) {
    const unit = (item.unit || "un").toLowerCase();
    if (unit.startsWith("h")) return { tipo: "HORA", quantidade: String(item.quantity) };
    if (unit === "metro" || unit === "m" || unit === "metro linear (m)") return { tipo: "METRO", quantidade: Number(item.quantity).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) };
    if (unit === "kg") return { tipo: "KG", quantidade: String(item.quantity) };
    if (unit === "diária" || unit === "diaria") return { tipo: "DIÁRIA", quantidade: String(item.quantity) };
    if (unit === "serviço" || unit === "servico") return { tipo: "SERVIÇO", quantidade: String(item.quantity) };
    return { tipo: "UNIDADE", quantidade: String(item.quantity) };
  }
  return { tipo: "METRO", quantidade: Number(item.meters ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) };
}

export async function QuoteDocument({ id, error }: { id: string; error?: string }) {
  const db = await createClient();

  const quoteResult = await db
    .from("quotes")
    .select(
      "id,quote_number,status,subtotal,discount,freight,total,valid_until,installation_deadline,notes,client_notes,seller_name,payment_methods,hide_unit_prices,created_at," +
        "client:clients(name,phone,whatsapp,email,tax_id,address,neighborhood,city,state)," +
        "sale_type:sale_types(name)," +
        "company:companies(*)"
    )
    .eq("id", id)
    .single();

  if (quoteResult.error || !quoteResult.data) {
    return <p className="card p-8">Orçamento não encontrado: {quoteResult.error?.message}</p>;
  }

  const quote = quoteResult.data as unknown as QuoteData;

  const gutter = await db
    .from("gutter_quotes")
    .select("id,items:gutter_quote_items(product,thickness,cut,color,category,quantity,meters,unit_price,total)")
    .eq("quote_id", id)
    .maybeSingle();

  const gutterItems = (gutter.data as unknown as { items?: QuoteItem[] } | null)?.items ?? [];
  const isGutter = Boolean(gutter.data);

  // quote_items: all non-fabrication items (especial = condutores, acessórios, serviços, itens especiais)
  const { data: quoteItemsRaw } = await db
    .from("quote_items")
    .select("product,description,unit,quantity,unit_price,total,item_type")
    .eq("quote_id", id);
  const quoteItems = (quoteItemsRaw as unknown as QuoteItem[]) ?? [];

  // For gutter quotes: fabrication items come from gutter_quote_items (with full detail);
  // all other items (especial) come from quote_items.
  // For non-gutter quotes: use quote_items directly.
  const items: QuoteItem[] = isGutter
    ? [...gutterItems, ...quoteItems.filter(isComplementaryQuoteItem)]
    : quoteItems;

  const company = quote.company;
  const client = quote.client;
  const primary = company.primary_color || "#D71920";
  const secondary = company.secondary_color || "#111111";
  const availablePayments = company.payment_methods_available?.length
    ? company.payment_methods_available
    : ["pix", "cartao", "cheque", "dinheiro"];
  const selectedPayments = quote.payment_methods?.length ? quote.payment_methods : availablePayments;
  const hideUnitPrices = quote.hide_unit_prices ?? false;

  const observacoes = (quote.notes || company.quote_footer || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print mb-5 flex items-center justify-between">
        <Link href="/orcamentos" className="inline-flex items-center gap-2 text-sm font-bold text-ink/55">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <div className="flex gap-3">
          {quote.status !== "aprovado" && (
            <Link href={`/orcamentos/${id}/editar`} className="button-ghost">Editar</Link>
          )}
          <form>
            <input type="hidden" name="quote_id" value={id} />
            <button formAction={duplicateQuote} className="button-ghost">Duplicar</button>
          </form>
          {quote.status !== "aprovado" && (
            <form>
              <input type="hidden" name="quote_id" value={id} />
              <ConfirmButton formAction={deleteQuote} className="button-ghost text-red-700">Excluir</ConfirmButton>
            </form>
          )}
          <PrintButton />
          {quote.status !== "aprovado" && (
            <form action={approveQuote}>
              <input type="hidden" name="quote_id" value={id} />
              <button className="button-ghost">
                <CheckCircle2 className="h-4 w-4" /> Aprovar orçamento
              </button>
            </form>
          )}
        </div>
      </div>

      {error && <p className="no-print mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <article
        className="quote-sheet print-sheet relative overflow-hidden bg-white"
        style={{ "--quote-primary": primary, "--quote-secondary": secondary } as React.CSSProperties}
      >
        {proxyLogoUrl(company.logo_url) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxyLogoUrl(company.logo_url)!}
            alt=""
            aria-hidden
            className="quote-watermark pointer-events-none absolute select-none"
          />
        )}

        <div className="relative">
          {/* ── Cabeçalho 3 colunas ── */}
          <header className="quote-header">
            <div className="quote-logo-col">
              {company.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={company.trade_name || company.name || "Logo"}
                  src={proxyLogoUrl(company.logo_url)!}
                  className="quote-logo-img"
                  crossOrigin="anonymous"
                />
              ) : (
                <div className="quote-logo-fallback" style={{ background: secondary }}>
                  {(company.trade_name || company.name || "MC").slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>

            <div className="quote-company-col">
              <p className="quote-company-name">{(company.trade_name || company.name || "").toUpperCase()}</p>
              <div className="quote-company-lines">
                {company.tax_id && <p>CNPJ: {company.tax_id}</p>}
                {(company.address || company.neighborhood || company.city) && (
                  <p>
                    {[company.address, company.neighborhood, [company.city, company.state].filter(Boolean).join(" - ")]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
                {company.phone && <p>{company.phone}</p>}
                {company.whatsapp && company.whatsapp !== company.phone && <p>{company.whatsapp}</p>}
                {company.email && <p>{company.email}</p>}
              </div>
            </div>

            <div className="quote-qr-col">
              {company.qr_code_url ? (
                <>
                  <div className="quote-qr-box">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt="QR Code"
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=0&data=${encodeURIComponent(company.qr_code_url)}`}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <p className="quote-qr-caption">{company.qr_code_label || "Acesse nosso portfólio completo"}</p>
                </>
              ) : (
                <div className="quote-qr-box quote-qr-box--empty" />
              )}
            </div>
          </header>

          {/* ── Faixa vermelha ── */}
          <div className="quote-bar">
            <div className="quote-bar-numero">ORÇAMENTO Nº {String(quote.quote_number)}</div>
            <div className="quote-bar-meta">
              <span className="quote-bar-label">DATA</span>
              <span className="quote-bar-value">{shortDate(String(quote.created_at).slice(0, 10))}</span>
            </div>
            <div className="quote-bar-meta">
              <span className="quote-bar-label">VALIDADE</span>
              <span className="quote-bar-value">{quote.valid_until ? shortDate(quote.valid_until) : "—"}</span>
            </div>
            <div className="quote-bar-meta">
              <span className="quote-bar-label">PRAZO INSTALAÇÃO</span>
              <span className="quote-bar-value" style={{ fontSize: "9px" }}>
                {quote.installation_deadline || "A definir"}
              </span>
            </div>
            <div className="quote-bar-meta">
              <span className="quote-bar-label">VENDEDOR</span>
              <QuoteSellerField quoteId={quote.id} sellerName={quote.seller_name || ""} />
            </div>
          </div>

          {/* ── Dados do cliente ── */}
          <section className="quote-client-box">
            <p className="quote-client-title">DADOS DO CLIENTE</p>
            <div className="quote-client-grid">
              <span className="quote-client-lbl">NOME:</span>
              <span className="quote-client-val">{String(client.name)}</span>
              <span className="quote-client-lbl">TELEFONE:</span>
              <span className="quote-client-val">{String(client.whatsapp || client.phone || "—")}</span>
              <span className="quote-client-lbl">ENDEREÇO:</span>
              <span className="quote-client-val">{String(client.address || "—")}</span>
              <span className="quote-client-lbl">CIDADE/UF:</span>
              <span className="quote-client-val">
                {[client.city, client.state].filter(Boolean).join(" - ") || "—"}
              </span>
            </div>
            {quote.client_notes && (
              <div className="quote-client-obs">
                <span className="quote-client-lbl">OBSERVAÇÕES DO CLIENTE:</span>
                <span>{quote.client_notes}</span>
              </div>
            )}
          </section>

          {/* ── Tabela de itens ── */}
          <table className="quote-table">
            <thead>
              <tr>
                <th style={{ width: "7%" }}>ITEM</th>
                <th className="quote-th-desc" style={{ width: hideUnitPrices ? "45%" : "37%" }}>
                  DESCRIÇÃO
                </th>
                <th style={{ width: "13%" }}>TIPO</th>
                <th style={{ width: "15%" }}>QUANTIDADE</th>
                {!hideUnitPrices && <th style={{ width: "13%" }}>VLR. UNIT.</th>}
                <th style={{ width: hideUnitPrices ? "20%" : "15%" }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: TOTAL_LINHAS }).map((_, i) => {
                const item = items[i];
                if (!item) {
                  return (
                    <tr key={i} className="quote-empty-row">
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      {!hideUnitPrices && <td>&nbsp;</td>}
                      <td>&nbsp;</td>
                    </tr>
                  );
                }
                const { tipo, quantidade } = buildTipoQuantidade(item, isGutter);
                const unitPriceDisplay = isGutter && !isSpecialItem(item)
                  ? money(item.unit_price) + "/m"
                  : money(item.unit_price);
                return (
                  <tr key={i}>
                    <td className="quote-td-item">{String(i + 1).padStart(2, "0")}</td>
                    <td className="quote-td-desc">{buildDescription(item, isGutter)}</td>
                    <td>{tipo}</td>
                    <td>{quantidade}</td>
                    {!hideUnitPrices && <td>{unitPriceDisplay}</td>}
                    <td className="quote-td-total">{money(quoteItemTotal(item, isGutter))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* ── Observações + Resumo financeiro ── */}
          <div className="quote-bottom-grid">
            <div className="quote-obs-box">
              <p className="quote-obs-title">OBSERVAÇÕES</p>
              {observacoes.length > 0 ? (
                <ul>
                  {observacoes.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink/40">Nenhuma observação cadastrada para este orçamento.</p>
              )}
            </div>

            <div className="quote-fin-box">
              <div className="quote-fin-row">
                <span>SUBTOTAL</span>
                <span>{money(quote.subtotal)}</span>
              </div>
              <div className="quote-fin-row">
                <span>DESCONTO</span>
                <span>{money(quote.discount)}</span>
              </div>
              <div className="quote-fin-row">
                <span>FRETE</span>
                <span>{money(quote.freight)}</span>
              </div>
              <div className="quote-fin-total">
                <span>TOTAL GERAL</span>
                <span>{money(quote.total)}</span>
              </div>
            </div>
          </div>

          {/* ── Forma de pagamento + Assinatura ── */}
          <div className="quote-footer-grid">
            <div className="quote-pay-block">
              <p className="quote-pay-title">FORMA DE PAGAMENTO</p>
              <QuotePaymentMethods
                quoteId={quote.id}
                available={availablePayments}
                selected={selectedPayments}
                labels={PAYMENT_LABELS}
              />
            </div>
            <div className="quote-sign-block">
              <div className="quote-sign-line" />
              <p>ASSINATURA DO RESPONSÁVEL</p>
              <p>{company.trade_name || company.name || ""}</p>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
