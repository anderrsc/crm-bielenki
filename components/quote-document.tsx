import { quoteFileName } from "@/lib/quote-file-name";
import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { QuoteAttachments } from "./quote-attachments";
import { QuoteTeamFields } from "./quote-team-fields";
import type { InternalAttachment } from "@/lib/quote-attachments";
import { AuthorSignature } from "./brand-logo";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Printer, Send } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { approveQuote, deleteQuote, duplicateQuote, markQuoteSent, revertQuoteApproval } from "@/app/(crm)/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { QuotePdfButton } from "@/components/quote-pdf-button";
import { QuoteSellerField } from "@/components/quote-seller-field";
import { QuotePaymentMethods } from "@/components/quote-payment-methods";
import { getAuthUser, getRequestClient } from "@/lib/supabase/server";
import { firstName } from "@/lib/seller-name";
import { money, shortDate } from "@/lib/utils";

import { quotePieceMedia } from "@/lib/quote-piece-media";
import { quoteWatermarkUrl } from "@/lib/quote-watermark";

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
  website?: string | null;
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
  seller_id: string | null;
  seller_name: string | null;
  payment_methods: string[] | null;
  hide_unit_prices: boolean;
  hide_travel_price?: boolean | null;
  measurer_id?: string | null;
  attendant_id?: string | null;
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
  boleto: "Boleto",
  pix: "PIX",
  cartao: "Cartão",
  cheque: "Cheque",
  dinheiro: "Dinheiro",
};

const COMPLEMENTARY_PREFIXES = new Set(["condutores", "acessorios", "servicos", "itens especiais"]);

function formatCompanyPhone(value?: string | null) {
  const text = value?.trim() ?? "";
  if (!/^[\d\s()+.-]+$/.test(text)) return text;
  const digits = text.replace(/\D/g, "");
  const local = /^(?:55)(?:\d{10}|\d{11})$/.test(digits) ? digits.slice(2) : digits;
  if (!/^\d{10,11}$/.test(local)) return text;
  return `(${local.slice(0, 2)}) ${local.slice(2, -4)}-${local.slice(-4)}`;
}

function formatCompanyTaxId(value?: string | null) {
  const text = value?.trim() ?? "";
  if (!/^[\d.\s/-]+$/.test(text)) return text;
  const digits = text.replace(/\D/g, "");
  return digits.length === 14 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : text;
}

function isTravelItem(item: { product?: string | null }) {
  return normalizeLabel(String(item.product ?? "")).includes("deslocamento");
}

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
  return { tipo: "METRO", quantidade: (Number(item.quantity || 0) * Number(item.meters || 0)).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) };
}

// printOnly: renderiza so a folha do orcamento (sem botoes), usada pela rota
// /orcamentos/[id]/impressao que o Chromium headless transforma em PDF.
export async function QuoteDocument({ id, error, printOnly = false }: { id: string; error?: string; printOnly?: boolean }) {
  const db = await getRequestClient();

  // As tres consultas sao independentes: rodam em paralelo.
  const [quoteResult, gutter, { data: quoteItemsRaw }] = await Promise.all([
    db
      .from("quotes")
      .select(
        // "*" para nao quebrar a pagina enquanto a coluna hide_travel_price nao existir no banco.
        "*," +
          "client:clients(name,phone,whatsapp,email,tax_id,address,neighborhood,city,state)," +
          "sale_type:sale_types(name)," +
          "company:companies(*)"
      )
      .eq("id", id)
      .single(),
    db
      .from("gutter_quotes")
      .select("id,items:gutter_quote_items(product,thickness,cut,color,category,quantity,meters,unit_price,total)")
      .eq("quote_id", id)
      .maybeSingle(),
    // quote_items: itens que nao sao de fabricacao (condutores, acessorios, servicos, itens especiais)
    db
      .from("quote_items")
      .select("product,description,unit,quantity,unit_price,total,item_type")
      .eq("quote_id", id),
  ]);

  if (quoteResult.error || !quoteResult.data) {
    return <p className="card p-8">Orçamento não encontrado: {quoteResult.error?.message}</p>;
  }

  const quote = quoteResult.data as unknown as QuoteData;

  // Vendedor vazio: preenche com o primeiro nome de quem criou o orcamento
  // (ou de quem esta logado) e grava, para o PDF sair igual. Continua editavel.
  if (!quote.seller_name?.trim()) {
    const ownerId = quote.seller_id ?? (await getAuthUser(db))?.id;
    if (ownerId) {
      const { data: owner } = await db.from("profiles").select("full_name").eq("id", ownerId).maybeSingle();
      const name = firstName((owner as { full_name?: string | null } | null)?.full_name);
      if (name) {
        quote.seller_name = name;
        await db.from("quotes").update({ seller_name: name }).eq("id", quote.id).is("seller_name", null);
      }
    }
  }

  const gutterItems = (gutter.data as unknown as { items?: QuoteItem[] } | null)?.items ?? [];
  const isGutter = Boolean(gutter.data);

  const quoteItems = (quoteItemsRaw as unknown as QuoteItem[]) ?? [];

  // For gutter quotes: fabrication items come from gutter_quote_items (with full detail);
  // all other items (especial) come from quote_items.
  // For non-gutter quotes: use quote_items directly.
  const items: QuoteItem[] = isGutter
    ? [...gutterItems, ...quoteItems.filter(isComplementaryQuoteItem)]
    : quoteItems;

  const company = quote.company;
  const phone = formatCompanyPhone(company.phone);
  const whatsapp = formatCompanyPhone(company.whatsapp);
  const taxId = formatCompanyTaxId(company.tax_id);
  const neighborhood = /^rau$/i.test(company.neighborhood?.trim() ?? "") ? "Rau" : company.neighborhood;
  const portfolio = /^https?:\/\//i.test(company.qr_code_url||'') ? company.qr_code_url! : "https://marquinhos-calhas.vercel.app/";
  const [qrImgSrc, logoBuffer] = await Promise.all([
    QRCode.toDataURL(portfolio,{errorCorrectionLevel:"M",width:240,margin:4}),
    printOnly ? readFile(path.join(process.cwd(),"public/brand/original/marquinhos-logo.svg")) : null,
  ]);
  const logoSrc=logoBuffer ? 'data:image/svg+xml;base64,'+logoBuffer.toString('base64') : '/brand/original/marquinhos-logo.svg';
  const client = quote.client;
  // Internal files are not queried or serialized in the customer print route.
  let attachments:InternalAttachment[]=[];
  let canManageAttachments=false;
  let team:{id:string;full_name:string|null}[]=[];
  if(!printOnly){
    const [files,permission,people]=await Promise.all([
      db.from('quote_internal_attachments').select('id,original_name,size_bytes,created_at').eq('quote_id',id).order('created_at',{ascending:false}),
      db.rpc('has_table_access',{resource:'quotes',action:'update'}),
      db.from('profiles').select('id,full_name').eq('status','ativo').order('full_name'),
    ]);
    attachments=(files.data||[]) as InternalAttachment[];
    canManageAttachments=Boolean(permission.data);
    team=(people.data||[]) as typeof team;
  }
  const availablePayments = company.payment_methods_available?.length
    ? company.payment_methods_available
    : ["pix", "cartao", "cheque", "dinheiro"];
  const selectedPayments = quote.payment_methods?.length ? quote.payment_methods : availablePayments;
  const hideUnitPrices = quote.hide_unit_prices ?? false;
  // Deslocamento aparece como "Incluso", sem valor (padrao), a nao ser que o orcamento peca para mostrar.
  const hideTravelPrice = quote.hide_travel_price ?? true;

  const observacoes = (quote.notes || company.quote_footer || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const itemMedia = await Promise.all(items.map(item => quotePieceMedia(item.product, printOnly)));
  const hasPieceMedia = itemMedia.some(Boolean);


  return (
    <div className={printOnly ? undefined : "mx-auto max-w-5xl"}>
      {!printOnly && <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/orcamentos" className="inline-flex items-center gap-2 text-sm font-bold text-ink/55">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
          <StatusBadge value={String(quote.status)} />
        </div>
        <div className="flex flex-wrap gap-3">
          {/* A tela de edicao so existe para orcamentos de calhas. */}
          {isGutter && quote.status !== "aprovado" && (
            <Link href={`/orcamentos/${id}/editar`} className="button-ghost">Editar</Link>
          )}
          <form>
            <input type="hidden" name="quote_id" value={id} />
            <button formAction={duplicateQuote} className="button-ghost">Duplicar</button>
          </form>
          {quote.status === "aprovado" && (
            <form>
              <input type="hidden" name="quote_id" value={id} />
              <ConfirmButton formAction={revertQuoteApproval} className="button-ghost text-red-700"
                message="Reverter a aprovação? A venda, o pedido, a conta a receber e a produção gerados por este orçamento serão apagados e o orçamento volta para Enviado.">
                Reverter aprovação
              </ConfirmButton>
            </form>
          )}
          {quote.status !== "aprovado" && (
            <form>
              <input type="hidden" name="quote_id" value={id} />
              <ConfirmButton formAction={deleteQuote} className="button-ghost text-red-700">Excluir</ConfirmButton>
            </form>
          )}
          <a className="button no-print" href={`/api/orcamentos/${id}/pdf`} target="_blank" rel="noopener noreferrer">
            <Printer className="h-4 w-4" /> Abrir para imprimir
          </a>
          <QuotePdfButton quoteId={id} fileName={quoteFileName(String(client?.name ?? ""), String(quote.quote_number))} />
          {(quote.status === "rascunho" || quote.status === "pendente") && (
            <form action={markQuoteSent}>
              <input type="hidden" name="quote_id" value={id} />
              <button className="button-ghost">
                <Send className="h-4 w-4" /> Marcar como enviado
              </button>
            </form>
          )}
          {quote.status !== "aprovado" && (
            <form action={approveQuote}>
              <input type="hidden" name="quote_id" value={id} />
              <button className="button-ghost">
                <CheckCircle2 className="h-4 w-4" /> Aprovar orçamento
              </button>
            </form>
          )}
        </div>
      </div>}

      {!printOnly && error && <p className="no-print mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {!printOnly && <QuoteTeamFields quoteId={id} people={team} measurerId={quote.measurer_id ?? null} attendantId={quote.attendant_id ?? null} />}
      {!printOnly && <QuoteAttachments quoteId={id} attachments={attachments} canManage={canManageAttachments} />}
      <div className={printOnly?undefined:"quote-paper-scroll"}><article
        className={`quote-sheet print-sheet relative bg-white${hasPieceMedia ? " quote-with-pieces" : ""}`}
        data-quote-number={quote.quote_number}
        data-pdf-document={printOnly?"true":undefined}
      >
        <div className="quote-watermark" aria-hidden="true" style={{ backgroundImage: quoteWatermarkUrl() }} />
        <div className="relative">
          {/* ── Cabeçalho 3 colunas ── */}
          <header className="quote-header">
            <div className="quote-logo-col">
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={company.trade_name || company.name || "Logo"}
                  src={logoSrc}
                  className="quote-logo-img"
                  crossOrigin="anonymous"
                />
              ) : (
                <div className="quote-logo-fallback">
                  {(company.trade_name || company.name || "MC").slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>

            <div className="quote-company-col">
              <p className="quote-company-name">{(company.trade_name || company.name || "").toUpperCase()}</p>
              <div className="quote-company-lines">
                {taxId && <p className="quote-company-tax">CNPJ {taxId}</p>}
                {(company.address || company.neighborhood || company.city) && (
                  <p>
                    {[company.address, neighborhood, [company.city, company.state].filter(Boolean).join(" - ")]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
                {(phone || whatsapp) && (
                  <div className="quote-company-contacts">
                    {phone && phone !== whatsapp && <span><b>Telefone</b> {phone}</span>}
                    {whatsapp && <span><b>WhatsApp</b> {whatsapp}</span>}
                  </div>
                )}
                {(company.email || company.website) && (
                  <div className="quote-company-links">
                    {company.email && <span>{company.email}</span>}
                    {company.website && <span>{company.website}</span>}
                  </div>
                )}
              </div>
            </div>

            <div className="quote-qr-col">
              {qrImgSrc ? (
                <>
                  <div className="quote-qr-box">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt="QR Code"
                      src={qrImgSrc}
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
              {printOnly?<span className="quote-bar-value">{quote.seller_name||"—"}</span>:<QuoteSellerField quoteId={quote.id} sellerName={quote.seller_name || ""} />}
            </div>
          </div>

          {/* ── Dados do cliente ── */}
          <section className="quote-client-box">
            <p className="quote-client-title">DADOS DO CLIENTE</p>
            <div className="quote-client-grid">
              <span className="quote-client-lbl">NOME:</span>
              <span className="quote-client-val">{String(client.name||"—")}</span>
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
            <colgroup><col style={{width:'5%'}}/><col style={{width:hasPieceMedia?'40%':'58%'}}/>{hasPieceMedia&&<col style={{width:'18%'}}/>}<col style={{width:'8%'}}/><col style={{width:'8%'}}/>{!hideUnitPrices&&<col style={{width:'10%'}}/>}<col style={{width:hideUnitPrices?'21%':'11%'}}/></colgroup>
            <thead><tr><th>ITEM</th><th className="quote-th-desc">DESCRIÇÃO</th>{hasPieceMedia&&<th>PEÇA 3D</th>}<th>TIPO</th><th>QTD.</th>{!hideUnitPrices&&<th>UNIT.</th>}<th>TOTAL</th></tr></thead>
            <tbody>{items.map((item,i)=>{
              const {tipo,quantidade}=buildTipoQuantidade(item,isGutter), media=itemMedia[i];
              const unitPriceDisplay=money(item.unit_price)+(isGutter&&!isSpecialItem(item)?'/m':'');
              const hiddenTravel=hideTravelPrice&&isTravelItem(item);
              return <tr key={i}>
                <td className="quote-td-item">{String(i+1).padStart(2,'0')}</td>
                <td className="quote-td-desc">{buildDescription(item,isGutter)}</td>
                {hasPieceMedia&&<td className="quote-piece-cell">{media?<a href={media.url} target="_blank" rel="noopener noreferrer" className="quote-piece-link"><img src={media.image} alt={media.piece.name} className="quote-piece-image"/><img src={media.qr} alt={'QR code do modelo 3D: '+media.piece.name} className="quote-piece-qr"/><span>Peça {media.piece.code} · Ver em 3D</span></a>:<span className="quote-piece-unavailable">—</span>}</td>}
                <td>{tipo}</td><td>{quantidade}</td>{!hideUnitPrices&&<td className="quote-unit-value">{hiddenTravel?'Incluso':unitPriceDisplay}</td>}<td className="quote-td-total">{hiddenTravel?'Incluso':money(quoteItemTotal(item,isGutter))}</td>
              </tr>;
            })}</tbody>
          </table>
          {hasPieceMedia&&<p className="quote-piece-note">Ilustrações de referência. Confira medidas, corte e detalhes antes da fabricação. Aponte a câmera para o QR code ou clique na peça para ver o modelo 3D e a peça instalada na obra.</p>}

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
                <p className="text-xs text-[#8f8f8f]">Nenhuma observação cadastrada para este orçamento.</p>
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
              {printOnly?<div className="quote-pay-icons">{selectedPayments.map(method=><span className="quote-pay-item" key={method}>{PAYMENT_LABELS[method]||method}</span>)}</div>:<QuotePaymentMethods quoteId={quote.id} available={availablePayments} selected={selectedPayments} labels={PAYMENT_LABELS}/>}
            </div>
            <div className="quote-sign-block">
              <div className="quote-sign-line" />
              <p>ASSINATURA DO RESPONSÁVEL</p>
              <p>{company.trade_name || company.name || ""}</p>
            </div>
          </div>
        </div>
          <div className="quote-paper-credit no-print"><span>Marquinhos Calhas e Esquadrias</span><AuthorSignature/></div>
      </article></div>
    </div>
  );
}
