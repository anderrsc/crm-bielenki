"use client";

import Link from "next/link";
import { ArrowLeft, FileDown, Printer, Users } from "lucide-react";
import { useRef } from "react";

/* ─── Tipos ──────────────────────────────────────────────────────────────── */
export type VisitSheetData = {
  client?: {
    name: string;
    phone: string | null;
    whatsapp: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    address: string | null;
  } | null;
  company: {
    trade_name?: string | null;
    name?: string | null;
    tax_id?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    email?: string | null;
    website?: string | null;
    address?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    logo_url?: string | null;
    primary_color?: string | null;
  };
  backHref?: string;
};

/* ─── Formatação de data/hora ─────────────────────────────────────────────── */
function fmtDateTime(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ─── Gerador de HTML para impressão isolada ─────────────────────────────── */
function buildPrintHtml(data: VisitSheetData, now: string, forPdf: boolean): string {
  const { client, company } = data;
  const red = company.primary_color || "#D71920";
  const tradeName = company.trade_name || company.name || "Marquinhos Calhas e Esquadrias";
  const phone = client?.whatsapp || client?.phone || "";
  const neighborhood = client?.neighborhood || "";
  const city = [client?.city, client?.state].filter(Boolean).join(" / ");
  const address = [client?.address, client?.neighborhood, client?.city, client?.state].filter(Boolean).join(" - ");
  const compAddr = [company.address, company.neighborhood, company.city, company.state].filter(Boolean).join(" - ");

  const logoHtml = company.logo_url
    ? `<img src="${company.logo_url}" crossorigin="anonymous" style="width:22mm;max-height:18mm;object-fit:contain;" />`
    : `<div style="width:22mm;height:18mm;background:${red};display:flex;align-items:center;justify-content:center;border-radius:4px;"><span style="color:#fff;font-weight:900;font-size:14px;">MC</span></div>`;

  function fieldCard(label: string, value: string, large = false, blank = false) {
    const inner = blank || !value
      ? `<div style="border-bottom:1px solid #bbb;height:10px;margin-top:5mm;"></div>`
      : `<p style="font-size:${large ? "12px" : "9px"};font-weight:${large ? 900 : 700};color:#111;line-height:1.2;margin:0;">${value}</p>`;
    return `<div style="background:#f7f7f7;border-radius:6px;padding:3mm 3.5mm;min-height:12mm;box-shadow:0 1px 2px rgba(0,0,0,.04);">
      <p style="font-size:7px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.1em;margin:0 0 1.5mm;">${label}</p>
      ${inner}
    </div>`;
  }

  const waIcon = `<svg width="9" height="9" viewBox="0 0 24 24" fill="#555"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>`;
  const phoneIcon = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.01 1.17 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.27 6.27l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>`;
  const mailIcon = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,14 22,4"/></svg>`;
  const igIcon = `<svg width="9" height="9" viewBox="0 0 24 24" fill="#555"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>`;

  const contacts = [
    company.whatsapp ? `<p style="display:flex;align-items:center;justify-content:flex-end;gap:3px;margin:0;">${waIcon} WhatsApp: ${company.whatsapp}</p>` : "",
    company.phone ? `<p style="display:flex;align-items:center;justify-content:flex-end;gap:3px;margin:0;">${phoneIcon} Telefone: ${company.phone}</p>` : "",
    company.email ? `<p style="display:flex;align-items:center;justify-content:flex-end;gap:3px;margin:0;">${mailIcon} ${company.email}</p>` : "",
    company.website ? `<p style="display:flex;align-items:center;justify-content:flex-end;gap:3px;margin:0;">${igIcon} ${company.website}</p>` : "",
  ].join("");

  const centerLines = [
    company.name && company.name !== tradeName
      ? `${company.name}${company.tax_id ? ` - CNPJ ${company.tax_id}` : ""}`
      : company.tax_id ? `CNPJ ${company.tax_id}` : "",
    compAddr,
  ].filter(Boolean).map(l => `<p style="font-size:8px;color:#555;margin:0.8mm 0 0;">${l}</p>`).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ficha de Medidas${client ? ` – ${client.name}` : " em Branco"}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:white;font-family:'Segoe UI','Inter',system-ui,sans-serif;color:#111;}
  @page{size:A4 portrait;margin:0;}
  @media print{
    body{margin:0 !important;}
    html,body{width:210mm;height:297mm;}
  }
  .sheet{
    width:210mm;
    min-height:297mm;
    padding:10mm 12mm 10mm 12mm;
    background:white;
    position:relative;
  }
  .datetime{font-size:8px;color:#888;letter-spacing:.03em;margin-bottom:4mm;}
  .header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:6mm;}
  .logo-area{width:22mm;display:flex;align-items:center;}
  .center-area{}
  .tradename{font-size:15px;font-weight:900;color:#111;line-height:1.1;margin-bottom:1.5mm;}
  .contacts{text-align:right;font-size:8.5px;color:#444;line-height:1.85;}
  .red-line{height:1.5px;background:${red};margin:3.5mm 0;}
  .row1{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin-bottom:3mm;}
  .row2{display:grid;grid-template-columns:2fr 1fr 1fr;gap:3mm;margin-bottom:4mm;}
  .field-card{background:#f7f7f7;border-radius:6px;padding:3mm 3.5mm;min-height:12mm;box-shadow:0 1px 2px rgba(0,0,0,.04);}
  .field-label{font-size:7px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:1.5mm;}
  .field-blank{border-bottom:1px solid #bbb;height:10px;margin-top:5mm;}
  .writing-area{
    border:1px solid #e0e0e0;
    border-radius:6px;
    overflow:hidden;
    background-image:linear-gradient(to bottom,transparent 27px,#e8e8e8 28px);
    background-size:100% 28px;
    min-height:185mm;
    flex:1;
  }
</style>
</head>
<body>
<div class="sheet">
  <div class="datetime">${now}</div>
  <div class="header">
    <div class="logo-area">${logoHtml}</div>
    <div class="center-area">
      <p class="tradename">${tradeName}</p>
      ${centerLines}
    </div>
    <div class="contacts">${contacts}</div>
  </div>
  <div class="red-line"></div>
  <div class="row1">
    ${fieldCard("CLIENTE", client?.name || "", true, !client)}
    ${fieldCard("TELEFONE / WHATSAPP", phone, false, !client)}
    ${fieldCard("BAIRRO", neighborhood || (client ? "Não informado" : ""), false, !client)}
    ${fieldCard("CIDADE", city, false, !client)}
  </div>
  <div class="row2">
    ${fieldCard("ENDEREÇO", address, false, !client)}
    ${fieldCard("DISPONIBILIDADE DE HORÁRIO", "", false, true)}
    ${fieldCard("MEDIDOR", "", false, true)}
  </div>
  <div class="writing-area"></div>
</div>
${forPdf ? `<script>window.onload=function(){window.print();}<\/script>` : `<script>window.onload=function(){window.focus();window.print();window.onafterprint=function(){window.close();};}<\/script>`}
</body>
</html>`;
}

/* ─── Componente principal ───────────────────────────────────────────────── */
export function VisitSheet({ client, company, backHref = "/medicoes" }: VisitSheetData) {
  const sheetRef = useRef<HTMLElement>(null);
  const red = company.primary_color || "#D71920";
  const tradeName = company.trade_name || company.name || "Marquinhos Calhas e Esquadrias";
  const phone = client?.whatsapp || client?.phone || "";
  const neighborhood = client?.neighborhood || "";
  const city = [client?.city, client?.state].filter(Boolean).join(" / ");
  const address = [client?.address, client?.neighborhood, client?.city, client?.state].filter(Boolean).join(" - ");
  const compAddr = [company.address, company.neighborhood, company.city, company.state].filter(Boolean).join(" - ");

  function openPrint(forPdf = false) {
    const now = fmtDateTime(new Date());
    const html = buildPrintHtml({ client, company, backHref }, now, forPdf);
    const win = window.open("", "_blank", "width=900,height=1100,menubar=yes,toolbar=yes");
    if (!win) { alert("Libere pop-ups para esta página e tente novamente."); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  return (
    <div className="mx-auto max-w-[210mm]">

      {/* ── Barra de ações ──────────────────────────────────────────── */}
      <div className="no-print mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-bold text-ink/55 hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
          {client ? "Voltar ao cliente" : "Voltar"}
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/clientes"
            className="flex items-center gap-2 rounded-xl border border-forest bg-forest px-4 py-2 text-sm font-semibold text-white hover:bg-ink"
          >
            <Users className="h-4 w-4" /> Gerar Ficha do Cliente
          </Link>
          <Link
            href="/medicoes/ficha-em-branco"
            className="flex items-center gap-2 rounded-xl border border-sand bg-white px-4 py-2 text-sm font-semibold hover:bg-cream"
          >
            Gerar Ficha em Branco
          </Link>
          <button
            type="button"
            onClick={() => openPrint(false)}
            className="flex items-center gap-2 rounded-xl border border-sand bg-white px-4 py-2 text-sm font-semibold hover:bg-cream"
          >
            <Printer className="h-4 w-4" /> Imprimir
          </button>
          <button
            type="button"
            onClick={() => openPrint(true)}
            className="flex items-center gap-2 rounded-xl border border-forest bg-forest px-4 py-2 text-sm font-semibold text-white hover:bg-ink"
          >
            <FileDown className="h-4 w-4" /> Gerar PDF
          </button>
        </div>
      </div>

      {/* ── Preview da ficha (tela) ──────────────────────────────────── */}
      <article
        ref={sheetRef}
        className="visit-sheet bg-white shadow-md"
        style={{
          width: "210mm",
          minHeight: "297mm",
          padding: "10mm 12mm",
          boxSizing: "border-box",
          fontFamily: "'Segoe UI','Inter',system-ui,sans-serif",
          position: "relative",
        }}
      >
        {/* Data/hora (preview estático) */}
        <div style={{ fontSize: "8px", color: "#888", marginBottom: "4mm", letterSpacing: ".03em" }}>
          {fmtDateTime(new Date())} <span style={{ color: "#bbb" }}>(atualiza na impressão)</span>
        </div>

        {/* Cabeçalho */}
        <header style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: "6mm" }}>
          <div style={{ width: "22mm", display: "flex", alignItems: "center" }}>
            {company.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={tradeName} src={company.logo_url} crossOrigin="anonymous"
                style={{ width: "22mm", maxHeight: "18mm", objectFit: "contain" }} />
            ) : (
              <div style={{ width: "22mm", height: "18mm", background: red, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px" }}>
                <span style={{ color: "#fff", fontWeight: 900, fontSize: "14px" }}>MC</span>
              </div>
            )}
          </div>
          <div>
            <p style={{ fontSize: "15px", fontWeight: 900, color: "#111", lineHeight: 1.1, marginBottom: "1.5mm" }}>{tradeName}</p>
            {company.name && company.name !== tradeName && (
              <p style={{ fontSize: "8px", color: "#555", marginBottom: "0.8mm" }}>
                {company.name}{company.tax_id ? ` - CNPJ ${company.tax_id}` : ""}
              </p>
            )}
            {!company.name && company.tax_id && (
              <p style={{ fontSize: "8px", color: "#555", marginBottom: "0.8mm" }}>CNPJ {company.tax_id}</p>
            )}
            {compAddr && <p style={{ fontSize: "8px", color: "#555" }}>{compAddr}</p>}
          </div>
          <div style={{ textAlign: "right", fontSize: "8.5px", color: "#444", lineHeight: "1.85" }}>
            {company.whatsapp && <ContactRow icon={<WaIcon />} text={`WhatsApp: ${company.whatsapp}`} />}
            {company.phone && <ContactRow icon={<PhoneIcon />} text={`Telefone: ${company.phone}`} />}
            {company.email && <ContactRow icon={<MailIcon />} text={company.email} />}
            {company.website && <ContactRow icon={<IgIcon />} text={company.website} />}
          </div>
        </header>

        {/* Linha vermelha */}
        <div style={{ height: "1.5px", background: red, margin: "3.5mm 0" }} />

        {/* Cards linha 1 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "3mm", marginBottom: "3mm" }}>
          <FieldCard label="CLIENTE" value={client?.name} large blank={!client} />
          <FieldCard label="TELEFONE / WHATSAPP" value={phone} blank={!client} />
          <FieldCard label="BAIRRO" value={neighborhood || (client ? "Não informado" : "")} blank={!client} />
          <FieldCard label="CIDADE" value={city} blank={!client} />
        </div>

        {/* Cards linha 2 */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "3mm", marginBottom: "4mm" }}>
          <FieldCard label="ENDEREÇO" value={address} blank={!client} />
          <FieldCard label="DISPONIBILIDADE DE HORÁRIO" value="" blank />
          <FieldCard label="MEDIDOR" value="" blank />
        </div>

        {/* Área de escrita pautada */}
        <div style={{
          border: "1px solid #e0e0e0",
          borderRadius: "6px",
          overflow: "hidden",
          backgroundImage: "linear-gradient(to bottom,transparent 27px,#e8e8e8 28px)",
          backgroundSize: "100% 28px",
          minHeight: "185mm",
        }} />
      </article>
    </div>
  );
}

/* ─── Sub-componentes de tela ────────────────────────────────────────────── */
function ContactRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <p style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "3px", margin: 0 }}>
      {icon} {text}
    </p>
  );
}

function FieldCard({ label, value, large = false, blank = false }: { label: string; value?: string; large?: boolean; blank?: boolean }) {
  return (
    <div style={{ background: "#f7f7f7", borderRadius: "6px", padding: "3mm 3.5mm", minHeight: "12mm", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
      <p style={{ fontSize: "7px", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: "1.5mm" }}>{label}</p>
      {blank || !value
        ? <div style={{ borderBottom: "1px solid #bbb", height: "10px", marginTop: "5mm" }} />
        : <p style={{ fontSize: large ? "12px" : "9px", fontWeight: large ? 900 : 700, color: "#111", lineHeight: 1.2 }}>{value}</p>}
    </div>
  );
}

/* ─── Ícones SVG ─────────────────────────────────────────────────────────── */
function WaIcon() {
  return <svg width="9" height="9" viewBox="0 0 24 24" fill="#555" style={{ flexShrink: 0 }}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
  </svg>;
}
function PhoneIcon() {
  return <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" style={{ flexShrink: 0 }}>
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.01 1.17 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.27 6.27l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
  </svg>;
}
function MailIcon() {
  return <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" style={{ flexShrink: 0 }}>
    <rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,14 22,4"/>
  </svg>;
}
function IgIcon() {
  return <svg width="9" height="9" viewBox="0 0 24 24" fill="#555" style={{ flexShrink: 0 }}>
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
  </svg>;
}
