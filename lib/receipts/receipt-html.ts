// Folha A4 do recibo de pagamento (HTML puro, renderizado no Chromium do servidor).
// Visual aprovado em 25/11/2026: cabeçalho igual ao orçamento, valor recebido em destaque,
// itens do pedido (sem valor unitário: só o valor do item) e resumo financeiro.
// Muitos itens: a tabela continua na página seguinte com o cabeçalho repetido; o resumo,
// a data e a assinatura nunca se dividem entre páginas.

export type ReceiptItem = { description: string; detail?: string | null; unit: string; quantity: number; total: number };

export type ReceiptData = {
  receiptNumber: string;
  issuedAt: string; // ISO
  paidAt: string; // AAAA-MM-DD
  paymentCreatedAt: string; // ISO (hora da baixa)
  method: string;
  account: string | null;
  operator: string | null;
  quoteNumber: string | null;
  orderNumber: string | null;
  saleNumber: string | null;
  reference: string; // descrição da conta (quando não há pedido)
  company: { name: string; taxId: string; address: string; cityUf: string; phone: string; whatsapp: string; email: string; website: string; qrLabel: string };
  client: { name: string; document: string; documentLabel: string; phone: string; city: string };
  items: ReceiptItem[];
  gross: number; // total do pedido (antes do desconto)
  discount: number;
  interest: number;
  net: number; // valor líquido
  paidBefore: number;
  amount: number; // baixa deste recibo
  balance: number; // saldo restante
  amountInWords: string;
  notes: string | null;
};

export type ReceiptAssets = { logoDataUri: string; qrDataUri: string | null; fontFaces: string };

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const brl = (value: number) => (Math.round(value * 100) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const date = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const tz = { timeZone: "America/Sao_Paulo" } as const;
const localDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", tz);
const localTime = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { ...tz, hour12: false });
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const longDate = (iso: string) => { const [d, m, y] = localDate(iso).split("/"); return `${Number(d)} de ${MONTHS[Number(m) - 1]} de ${y}`; };

export function paymentMethodLabel(method: string | null | undefined) {
  const m = String(method ?? "").trim().toLowerCase();
  const map: Record<string, string> = { pix: "Pix", dinheiro: "Dinheiro", boleto: "Boleto", cartao: "Cartão", "cartao_credito": "Cartão de crédito", "cartao_debito": "Cartão de débito", transferencia: "Transferência", cheque: "Cheque", ted: "TED", doc: "DOC" };
  if (map[m]) return map[m];
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : "Não informado";
}

export function receiptStatus(balance: number) {
  return balance <= 0.009 ? { label: "Pedido quitado", cls: "quitado" } : { label: "Parcialmente pago", cls: "parcial" };
}

export function renderReceiptHtml(d: ReceiptData, a: ReceiptAssets): string {
  const status = receiptStatus(d.balance);
  const paidPct = d.net > 0 ? Math.min(100, ((d.paidBefore + d.amount) / d.net) * 100) : 100;
  const prevPct = d.net > 0 ? Math.min(100, (d.paidBefore / d.net) * 100) : 0;
  const nowPct = Math.max(0, paidPct - prevPct);
  const ref = d.orderNumber ? `pedido nº ${esc(d.orderNumber)}` : d.saleNumber ? `venda nº ${esc(d.saleNumber)}` : esc(d.reference);
  const refTail = d.quoteNumber ? `, vinculado ao orçamento ${esc(d.quoteNumber)}` : "";
  const itemsTotal = d.items.reduce((s, i) => s + i.total, 0);
  const rows = d.items.map((item, i) => `<tr><td class="n">${String(i + 1).padStart(2, "0")}</td><td class="d"><b>${esc(item.description)}</b>${item.detail ? `<small>${esc(item.detail)}</small>` : ""}</td><td class="c">${esc(item.unit)}</td><td class="c">${qty(item.quantity)}</td><td class="r sub">R$ ${brl(item.total)}</td></tr>`).join("");
  const meta: Array<[string, string]> = [
    ["Emissão", localDate(d.issuedAt)],
    ["Pagamento", date(d.paidAt)],
    ["Baixa", `${localDate(d.paymentCreatedAt)} ${localTime(d.paymentCreatedAt)}`],
    ...(d.quoteNumber ? [["Orçamento", d.quoteNumber] as [string, string]] : []),
    [d.orderNumber ? "Pedido nº" : "Venda nº", d.orderNumber || d.saleNumber || "—"],
    ["Forma", d.method],
  ];
  const company = d.company;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Recibo ${esc(d.receiptNumber)}</title><style>
${a.fontFaces}
@page { size:A4; margin:10mm 11mm 14mm; }
*{box-sizing:border-box;margin:0;padding:0}
:root{--red:#d71920;--red-soft:#fdecec;--ink:#16181d;--mid:#4a4f57;--muted:#8a9099;--line:#e3e5e8;--soft:#f5f6f7;--green:#15803d;--amber:#b45309}
body{font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;color:var(--ink);font-size:9pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head{display:flex;align-items:center;gap:6mm;padding-bottom:3.5mm;border-bottom:2.5px solid var(--red)}
.head .logo{width:46mm;display:block}
.head .company{flex:1;font-size:8pt;line-height:1.5;color:var(--mid)}
.head .company b.name{display:block;color:var(--ink);font-size:10.5pt;font-weight:700;letter-spacing:.2px;margin-bottom:.4mm}
.head .company b{color:var(--ink);font-weight:600}
.head .qr{text-align:center;font-size:6.4pt;color:var(--muted);line-height:1.2;max-width:24mm}
.head .qr img{width:17mm;height:17mm;display:block;margin:0 auto .8mm}
.hero{display:flex;justify-content:space-between;align-items:stretch;margin-top:5mm;border-radius:6px;overflow:hidden;border:1px solid var(--line)}
.hero .t{padding:4mm 5mm}
.hero small{display:block;font-size:7.4pt;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted)}
.hero h1{font-size:19pt;font-weight:700;color:var(--red);letter-spacing:-.2px;line-height:1.15}
.hero .t span{font-size:8.4pt;color:var(--mid)} .hero .t span b{color:var(--ink)}
.hero .v{background:var(--red);color:#fff;padding:4mm 6mm;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;min-width:62mm}
.hero .v small{color:#fff;opacity:.85} .hero .v strong{font-size:21pt;font-weight:700;letter-spacing:-.3px;line-height:1.15} .hero .v span{font-size:7.8pt;opacity:.9}
.meta{display:grid;grid-template-columns:repeat(${meta.length},1fr);margin-top:3mm;background:var(--soft);border-radius:6px}
.meta div{padding:2.4mm 2.5mm;border-right:1px solid var(--line)} .meta div:last-child{border-right:none}
.meta span{display:block;font-size:6.6pt;font-weight:600;letter-spacing:.7px;text-transform:uppercase;color:var(--muted)}
.meta strong{display:block;font-size:8.8pt;font-weight:600;margin-top:.6mm;white-space:nowrap}
.parties{display:grid;grid-template-columns:1.25fr 1fr;gap:4mm;margin-top:4mm}
.party{border:1px solid var(--line);border-radius:6px;padding:3mm 4mm}
.lbl{font-size:6.8pt;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--red)}
.party .nm{font-size:10.5pt;font-weight:700;margin:.6mm 0 1.2mm}
.party .grid{display:grid;grid-template-columns:auto 1fr;column-gap:3mm;row-gap:.6mm;font-size:8.2pt}
.party .grid span{color:var(--muted)} .party .grid b{font-weight:600}
.sec{display:flex;align-items:center;gap:3mm;margin:5mm 0 2.2mm}
.sec h3{font-size:8.6pt;font-weight:700;letter-spacing:1px;text-transform:uppercase}
.sec::after{content:'';flex:1;height:1px;background:var(--line)}
.sec em{font-style:normal;font-size:7.6pt;color:var(--muted);font-weight:500;order:2}
table.items{width:100%;border-collapse:collapse;font-size:8.4pt}
table.items thead{display:table-header-group} table.items tfoot{display:table-row-group}
table.items th{background:var(--ink);color:#fff;font-size:6.9pt;font-weight:600;letter-spacing:.6px;text-transform:uppercase;padding:2mm 2.5mm;text-align:left}
table.items td{padding:1.7mm 2.5mm;border-bottom:1px solid var(--line);vertical-align:top}
table.items tbody tr{break-inside:avoid;page-break-inside:avoid}
table.items tbody tr:nth-child(even) td{background:#fafafa}
td.n{color:var(--muted);font-weight:600;width:9mm} td.d b{font-weight:500} td.d small{display:block;color:var(--muted);font-size:7.2pt;margin-top:.3mm}
td.sub{font-weight:600}
table.items tfoot td{padding:2.2mm 2.5mm;font-weight:700;font-size:8.8pt;border-bottom:none;border-top:1.5px solid var(--ink)}
.c{text-align:center!important;width:16mm}.r{text-align:right!important;white-space:nowrap}
.finance{break-inside:avoid;page-break-inside:avoid}
.fin-grid{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.summary{border:1px solid var(--line);border-radius:6px;padding:3mm 4mm}
.line{display:flex;justify-content:space-between;padding:1mm 0;font-size:8.6pt;color:var(--mid)}
.line b{color:var(--ink);font-weight:500}
.line.minus b{color:var(--red)}
.line.this{background:var(--red-soft);margin:.8mm -2mm;padding:1.4mm 2mm;border-radius:4px;color:var(--ink);font-weight:600}
.line.this b{color:var(--red);font-weight:700}
.line.saldo{border-top:1.5px solid var(--ink);margin-top:1.5mm;padding-top:2mm;font-size:10pt;font-weight:700;color:var(--ink)} .line.saldo b{font-weight:700}
.progress{margin-top:2.5mm}.bar{height:2mm;background:var(--soft);border-radius:2mm;overflow:hidden;display:flex}
.bar i{display:block;height:100%}.bar i.prev{background:#9ca3af}.bar i.now{background:var(--red)}
.cap{display:flex;justify-content:space-between;margin-top:1.2mm;font-size:7.2pt;color:var(--muted)}
.badge{display:inline-block;padding:.8mm 2.6mm;border-radius:20px;font-size:7.6pt;font-weight:700;letter-spacing:.3px;text-transform:uppercase}
.badge.quitado{background:#dcfce7;color:var(--green)}.badge.parcial{background:#fef3c7;color:var(--amber)}
.decl{border-radius:6px;background:var(--soft);padding:3.5mm 4mm;font-size:8.6pt;line-height:1.6;color:var(--mid);display:flex;flex-direction:column}
.decl b{color:var(--ink);font-weight:600} .decl .lbl{margin-bottom:1.5mm}
.decl .status{margin-top:auto;padding-top:3mm;display:flex;justify-content:space-between;align-items:center;font-size:8pt}
.note{margin-top:3mm;font-size:7.4pt;color:var(--muted)} .note b{color:var(--mid)}
.closing{display:flex;justify-content:space-between;align-items:flex-end;margin-top:9mm;gap:10mm}
.closing .place{font-size:8.8pt;font-weight:600;padding-bottom:5mm}
.closing .sign{width:78mm;text-align:center;border-top:1px solid var(--ink);padding-top:1.6mm}
.closing .sign b{display:block;font-size:8.4pt;font-weight:700} .closing .sign span{font-size:7.6pt;color:var(--muted)}
</style></head><body>
<header class="head">
  <img class="logo" src="${a.logoDataUri}" alt="${esc(company.name)}">
  <div class="company">
    <b class="name">${esc(company.name)}</b>
    ${[company.taxId && `CNPJ ${esc(company.taxId)}`, esc(company.address)].filter(Boolean).join(" &nbsp;·&nbsp; ")}<br>
    ${[company.phone && company.phone !== company.whatsapp && `<b>Tel.</b> ${esc(company.phone)}`, company.whatsapp && `<b>WhatsApp</b> ${esc(company.whatsapp)}`].filter(Boolean).join(" &nbsp;·&nbsp; ")}<br>
    ${[company.email, company.website].filter(Boolean).map(esc).join(" &nbsp;·&nbsp; ")}
  </div>
  ${a.qrDataUri ? `<div class="qr"><img src="${a.qrDataUri}" alt="QR">${esc(company.qrLabel)}</div>` : ""}
</header>
<section class="hero">
  <div class="t">
    <small>Comprovante de baixa financeira</small>
    <h1>Recibo de Pagamento</h1>
    <span>Nº <b>${esc(d.receiptNumber)}</b>${d.orderNumber ? ` &nbsp;·&nbsp; Pedido <b>${esc(d.orderNumber)}</b>` : ""}${d.quoteNumber ? ` &nbsp;·&nbsp; ${esc(d.quoteNumber)}` : ""}</span>
  </div>
  <div class="v"><small>Valor recebido</small><strong>R$ ${brl(d.amount)}</strong><span>via ${esc(d.method)} em ${date(d.paidAt)}</span></div>
</section>
<section class="meta">${meta.map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("")}</section>
<section class="parties">
  <div class="party"><div class="lbl">Pagador</div><div class="nm">${esc(d.client.name)}</div><div class="grid">
    ${d.client.document ? `<span>${esc(d.client.documentLabel)}</span><b>${esc(d.client.document)}</b>` : ""}
    ${d.client.phone ? `<span>Telefone</span><b>${esc(d.client.phone)}</b>` : ""}
    ${d.client.city ? `<span>Cidade/UF</span><b>${esc(d.client.city)}</b>` : ""}
  </div></div>
  <div class="party"><div class="lbl">Recebedor</div><div class="nm">${esc(company.name)}</div><div class="grid">
    ${company.taxId ? `<span>CNPJ</span><b>${esc(company.taxId)}</b>` : ""}
    ${d.account ? `<span>Conta</span><b>${esc(d.account)}</b>` : ""}
    ${d.operator ? `<span>Operador</span><b>${esc(d.operator)}</b>` : ""}
  </div></div>
</section>
<div class="sec"><h3>Itens do pedido</h3><em>${d.items.length} ${d.items.length === 1 ? "item" : "itens"}</em></div>
<table class="items">
  <thead><tr><th>#</th><th>Descrição</th><th class="c">Un.</th><th class="c">Qtd.</th><th class="r">Valor</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="4">Total dos itens</td><td class="r">R$ ${brl(itemsTotal)}</td></tr></tfoot>
</table>
<section class="finance">
  <div class="sec"><h3>Resumo financeiro</h3></div>
  <div class="fin-grid">
    <div class="decl">
      <div class="lbl">Declaração</div>
      <div>Recebemos de <b>${esc(d.client.name)}</b> a quantia de <b>R$ ${brl(d.amount)}</b> (${esc(d.amountInWords)}), referente à baixa do ${ref}${refTail}, pago via ${esc(d.method)}. Damos quitação exclusivamente sobre o valor deste recibo.</div>
      <div class="status"><span>Situação do pedido</span><span class="badge ${status.cls}">${status.label}</span></div>
    </div>
    <div class="summary">
      <div class="line"><span>Total do pedido</span><b>R$ ${brl(d.gross)}</b></div>
      <div class="line ${d.discount > 0 ? "minus" : ""}"><span>Desconto</span><b>${d.discount > 0 ? "- " : ""}R$ ${brl(d.discount)}</b></div>
      ${d.interest > 0 ? `<div class="line"><span>Juros / acréscimo</span><b>+ R$ ${brl(d.interest)}</b></div>` : ""}
      <div class="line"><span>Valor líquido</span><b>R$ ${brl(d.net)}</b></div>
      <div class="line"><span>Pagamentos anteriores</span><b>R$ ${brl(d.paidBefore)}</b></div>
      <div class="line this"><span>Baixa neste recibo</span><b>R$ ${brl(d.amount)}</b></div>
      <div class="line saldo"><span>Saldo restante</span><b>R$ ${brl(Math.max(0, d.balance))}</b></div>
      <div class="progress"><div class="bar"><i class="prev" style="width:${prevPct.toFixed(1)}%"></i><i class="now" style="width:${nowPct.toFixed(1)}%"></i></div>
        <div class="cap"><span>${Math.round(paidPct)}% pago</span><span>${100 - Math.round(paidPct)}% a pagar</span></div></div>
    </div>
  </div>
  <p class="note">${d.notes ? `<b>Observação:</b> ${esc(d.notes)} · ` : ""}Documento financeiro${d.orderNumber ? ` vinculado ao pedido nº ${esc(d.orderNumber)}` : ""}; não é ficha de produção. Recibo gerado automaticamente pelo CRM Bielenki.</p>
  <div class="closing">
    <div class="place">${company.cityUf ? `${esc(company.cityUf)}, ` : ""}${longDate(d.issuedAt)}.</div>
    <div class="sign"><b>${esc(company.name)}</b><span>Assinatura do responsável</span></div>
  </div>
</section>
</body></html>`;
}

export function receiptFooterTemplate(company: string, receiptNumber: string) {
  return `<div style="width:100%;margin:0 11mm;padding-top:1.5mm;border-top:1px solid #e3e5e8;display:flex;justify-content:space-between;font-family:Inter,Arial,sans-serif;font-size:6.8pt;color:#8a9099;-webkit-print-color-adjust:exact"><span>${esc(company)} · Recibo nº ${esc(receiptNumber)}</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span> · by Anderson Bielenki</span></div>`;
}
