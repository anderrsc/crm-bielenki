import type { ServiceOrderSheet as Data } from "@/lib/service-order";

const br = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR", { maximumFractionDigits: 3 }));
const MAX_ITEMS = 7;

/** Uma ordem de serviço em 1/4 de A4 (105 × 148,5 mm). */
export function OsCard({ data, via }: { data: Data; via?: number }) {
  const c = data.client;
  const place = [c.neighborhood, [c.city, c.state].filter(Boolean).join("/")].filter(Boolean).join(" · ");
  const shown = data.items.slice(0, MAX_ITEMS);
  const extra = data.items.length - shown.length;
  return <article className="os-card">
    <header className="os-head">
      <img src="/brand/marquinhos-logo.svg" alt={data.companyName} className="os-logo" />
      <div className="os-title"><b>ORDEM DE SERVIÇO</b><span className="os-num">{data.number}</span><small>Venda {data.saleNumber}{via ? ` · via ${via}` : ""}</small></div>
    </header>
    <section className="os-block">
      <p className="os-label">Cliente</p>
      <p className="os-strong">{c.name}</p>
      {c.phone && <p>Fone: {c.phone}</p>}
    </section>
    <section className="os-block">
      <p className="os-label">Endereço da obra</p>
      <p>{c.address || "______________________________________"}</p>
      <p>{place}{c.postal_code ? ` · CEP ${c.postal_code}` : ""}</p>
    </section>
    <section className="os-block os-grow">
      <p className="os-label">Serviço · {data.serviceType}</p>
      <ul className="os-items">
        {shown.map((i, k) => <li key={k}><span className="os-q">{qty(i.quantity)} {i.unit}</span><span className="os-p">{i.product}{i.description ? ` — ${i.description}` : ""}</span></li>)}
        {extra > 0 && <li className="os-more">+ {extra} {extra === 1 ? "item" : "itens"} — ver pedido</li>}
        {!shown.length && <li className="os-more">Itens conforme pedido</li>}
      </ul>
    </section>
    <section className="os-grid">
      <div><p className="os-label">Medido por</p><p className="os-strong">{data.measurer || "________________"}</p></div>
      <div><p className="os-label">Instalador</p><p className="os-strong">{data.installer || "________________"}</p></div>
      <div><p className="os-label">Fechado em</p><p className="os-strong">{br(data.closedAt)}</p></div>
      <div className="os-deadline"><p className="os-label">Prazo máx. instalação</p><p className="os-strong">{data.deadlineDate ? br(data.deadlineDate) : (data.deadlineText || "A combinar")}</p>{data.deadlineDate && data.deadlineText && <small>({data.deadlineText})</small>}</div>
    </section>
    <section className="os-block os-obs"><p className="os-label">Observações</p><div className="os-line" /><div className="os-line" /></section>
    <footer className="os-sign">
      <div><div className="os-line" /><small>Instalado em ___/___/______</small></div>
      <div><div className="os-line" /><small>Assinatura do cliente</small></div>
    </footer>
  </article>;
}

/** Folhas A4 com até 4 ordens cada (2 × 2), com linha de corte. */
export function OsSheets({ cards }: { cards: React.ReactNode[] }) {
  const pages: React.ReactNode[][] = [];
  for (let i = 0; i < cards.length; i += 4) pages.push(cards.slice(i, i + 4));
  return <>{pages.map((p, i) => <div className="os-a4" key={i}>{p}</div>)}</>;
}

export const OS_CSS = `
@page{size:A4 portrait;margin:0}
.os-page{min-height:100vh;background:#e9ece8;padding:16px;color:#111}
.os-toolbar{max-width:210mm;margin:0 auto 14px;display:flex;flex-direction:column;gap:10px}
.os-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
.os-controls label{display:flex;flex-direction:column;gap:4px}
.os-fresh{background:#ecfdf5;color:#065f46;border-radius:12px;padding:10px 12px;font-size:14px;font-weight:600}
.os-warn{background:#fffbeb;color:#92400e;border-radius:12px;padding:10px 12px;font-size:13px}
.os-msg{font-size:13px;color:#555}
.os-a4{width:210mm;height:297mm;margin:0 auto 12px;background:#fff;display:grid;grid-template-columns:105mm 105mm;grid-template-rows:148.5mm 148.5mm;box-shadow:0 2px 12px rgba(0,0,0,.12);break-after:page;page-break-after:always}
.os-a4:last-child{break-after:auto;page-break-after:auto}
.os-card{box-sizing:border-box;width:105mm;height:148.5mm;padding:5mm 5.5mm;display:flex;flex-direction:column;gap:1.8mm;font:8.4pt/1.25 Arial,Helvetica,sans-serif;border-right:.3mm dashed #999;border-bottom:.3mm dashed #999;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.os-card p{margin:0}
.os-head{display:flex;align-items:center;justify-content:space-between;gap:3mm;border-bottom:.5mm solid #111;padding-bottom:1.8mm}
.os-logo{height:11mm;width:auto;max-width:42mm;object-fit:contain}
.os-title{display:flex;flex-direction:column;align-items:flex-end;text-align:right;line-height:1.15}
.os-title b{font-size:10.5pt;letter-spacing:.02em}
.os-num{font-size:12pt;font-weight:800}
.os-title small{font-size:7pt;color:#444}
.os-label{font-size:6.6pt;text-transform:uppercase;letter-spacing:.05em;color:#555;font-weight:700}
.os-strong{font-weight:700;font-size:9pt}
.os-block{border-bottom:.2mm solid #ccc;padding-bottom:1.4mm}
.os-grow{flex:1;min-height:0;overflow:hidden}
.os-items{list-style:none;margin:.8mm 0 0;padding:0}
.os-items li{display:flex;gap:2mm;padding:.35mm 0;border-bottom:.1mm dotted #ddd}
.os-q{flex:0 0 13mm;font-weight:700;white-space:nowrap}
.os-p{flex:1;min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.os-more{color:#555;font-style:italic}
.os-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.4mm 3mm;border-bottom:.2mm solid #ccc;padding-bottom:1.4mm}
.os-deadline{background:#f1f1f1;border-radius:1mm;padding:.8mm 1.4mm;margin:-.8mm -1.4mm}
.os-deadline small{font-size:6.6pt;color:#444}
.os-line{border-bottom:.2mm solid #777;height:4.6mm}
.os-sign{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.os-sign small{font-size:6.6pt;color:#444}
@media print{
  html,body{background:#fff!important;margin:0!important;padding:0!important;width:auto!important;min-height:0!important}
  .no-print{display:none!important}
  .os-page{padding:0;background:#fff;min-height:0}
  .os-a4{box-shadow:none;margin:0}
}
@media screen and (max-width:820px){
  .os-a4{width:105mm;height:auto;grid-template-columns:105mm;grid-template-rows:none}
  .os-card{border:.3mm dashed #999}
}
`;
