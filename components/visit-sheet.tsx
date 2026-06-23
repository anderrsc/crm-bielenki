"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, FileDown, Printer, Users, ChevronDown } from "lucide-react";
import { proxyLogoUrl } from "@/lib/utils";

/* ─── Tipos ──────────────────────────────────────────────────────────────── */
export type VisitSheetData = {
  clientId?: string;
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

/* ─── Componente de preview (dentro do CRM) ─────────────────────────────── */
const QTY_OPTIONS = [1, 5, 10, 20, 50, 100];

export function VisitSheet({ clientId, client, company, backHref = "/medicoes" }: VisitSheetData) {
  const [qty, setQty] = useState(1);
  const [showQty, setShowQty] = useState(false);
  const red = company.primary_color || "#D71920";
  const tradeName = company.trade_name || company.name || "Marquinhos Calhas e Esquadrias";
  const phone = client?.whatsapp || client?.phone || "";
  const neighborhood = client?.neighborhood || "";
  const city = [client?.city, client?.state].filter(Boolean).join(" / ");
  const address = [client?.address, client?.neighborhood, client?.city, client?.state].filter(Boolean).join(" - ");
  const compAddr = [company.address, company.neighborhood, company.city, company.state].filter(Boolean).join(" - ");

  /* Rotas da página de impressão limpa */
  const printHref = clientId ? `/ficha/${clientId}` : "/ficha/branco";

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
            className="flex items-center gap-2 rounded-xl border border-sand bg-white px-4 py-2 text-sm font-semibold hover:bg-cream"
          >
            <Users className="h-4 w-4" /> Gerar Ficha do Cliente
          </Link>
          {/* Ficha em branco com seletor de quantidade */}
          <div className="relative">
            <div className="flex">
              <Link
                href={`/ficha/branco${qty > 1 ? `?qty=${qty}` : ""}`}
                target="_blank"
                className="flex items-center gap-2 rounded-l-xl border border-sand bg-white px-4 py-2 text-sm font-semibold hover:bg-cream"
              >
                Ficha em Branco{qty > 1 ? ` (${qty})` : ""}
              </Link>
              <button
                onClick={() => setShowQty(v => !v)}
                className="flex items-center rounded-r-xl border border-l-0 border-sand bg-white px-2 py-2 hover:bg-cream"
              >
                <ChevronDown className="h-3.5 w-3.5 text-ink/50" />
              </button>
            </div>
            {showQty && (
              <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-xl border bg-white shadow-lg p-2">
                <p className="mb-1.5 text-xs font-bold text-ink/40 px-2">Quantidade</p>
                {QTY_OPTIONS.map(n => (
                  <button key={n} onClick={() => { setQty(n); setShowQty(false); }}
                    className={`w-full rounded-lg px-3 py-1.5 text-left text-sm font-medium hover:bg-cream ${qty === n ? "bg-lime/20 text-forest font-bold" : ""}`}>
                    {n} {n === 1 ? "cópia" : "cópias"}
                  </button>
                ))}
                <div className="mt-1.5 border-t pt-1.5 px-2">
                  <label className="text-xs text-ink/40">Personalizado</label>
                  <input type="number" min={1} max={100} value={qty}
                    onChange={e => setQty(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                    className="mt-0.5 w-full rounded-lg border px-2 py-1 text-sm" />
                </div>
              </div>
            )}
          </div>
          <Link
            href={printHref}
            target="_blank"
            className="flex items-center gap-2 rounded-xl border border-sand bg-white px-4 py-2 text-sm font-semibold hover:bg-cream"
          >
            <Printer className="h-4 w-4" /> Imprimir
          </Link>
          <Link
            href={printHref}
            target="_blank"
            className="flex items-center gap-2 rounded-xl bg-[#234d3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#18221e]"
          >
            <FileDown className="h-4 w-4" /> Gerar PDF
          </Link>
        </div>
      </div>

      {/* ── Preview da ficha ────────────────────────────────────────── */}
      <article
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
        {/* Data/hora (indicativo) */}
        <div style={{ fontSize: "8px", color: "#bbb", marginBottom: "4mm", letterSpacing: ".03em" }}>
          data/hora — gerada automaticamente na impressão
        </div>

        {/* Cabeçalho */}
        <header style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: "6mm" }}>
          <div style={{ width: "22mm" }}>
            {company.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={tradeName} src={proxyLogoUrl(company.logo_url)!}
                style={{ width: "22mm", maxHeight: "18mm", objectFit: "contain" }} />
            ) : (
              <div style={{ width: "22mm", height: "18mm", background: red, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px" }}>
                <span style={{ color: "#fff", fontWeight: 900, fontSize: "14px" }}>MC</span>
              </div>
            )}
          </div>
          <div>
            <p style={{ fontSize: "15px", fontWeight: 900, color: "#111", lineHeight: 1.1, margin: "0 0 1.5mm" }}>{tradeName}</p>
            {company.name && company.name !== tradeName && (
              <p style={{ fontSize: "8px", color: "#555", margin: "0 0 0.8mm" }}>
                {company.name}{company.tax_id ? ` - CNPJ ${company.tax_id}` : ""}
              </p>
            )}
            {!company.name && company.tax_id && (
              <p style={{ fontSize: "8px", color: "#555", margin: "0 0 0.8mm" }}>CNPJ {company.tax_id}</p>
            )}
            {compAddr && <p style={{ fontSize: "8px", color: "#555", margin: 0 }}>{compAddr}</p>}
          </div>
          <div style={{ textAlign: "right", fontSize: "8.5px", color: "#444", lineHeight: "1.9" }}>
            {company.whatsapp && <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "3px" }}><WaIcon /> WhatsApp: {company.whatsapp}</div>}
            {company.phone && <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "3px" }}><PhoneIcon /> Telefone: {company.phone}</div>}
            {company.email && <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "3px" }}><MailIcon /> {company.email}</div>}
            {company.website && <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "3px" }}><IgIcon /> {company.website}</div>}
          </div>
        </header>

        <div style={{ height: "1.5px", background: red, margin: "3.5mm 0" }} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "3mm", marginBottom: "3mm" }}>
          <FieldCard label="CLIENTE" value={client?.name} large blank={!client} />
          <FieldCard label="TELEFONE / WHATSAPP" value={phone} blank={!client} />
          <FieldCard label="BAIRRO" value={neighborhood || (client ? "Não informado" : "")} blank={!client} />
          <FieldCard label="CIDADE" value={city} blank={!client} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "3mm", marginBottom: "4mm" }}>
          <FieldCard label="ENDEREÇO" value={address} blank={!client} />
          <FieldCard label="DISPONIBILIDADE DE HORÁRIO" value="" blank />
          <FieldCard label="MEDIDOR" value="" blank />
        </div>

        <div style={{
          border: "1px solid #e0e0e0",
          borderRadius: "6px",
          backgroundImage: "linear-gradient(to bottom,transparent 27px,#e8e8e8 28px)",
          backgroundSize: "100% 28px",
          minHeight: "183mm",
        }} />
      </article>
    </div>
  );
}

/* ─── Sub-componentes ────────────────────────────────────────────────────── */
function FieldCard({ label, value, large = false, blank = false }: { label: string; value?: string; large?: boolean; blank?: boolean }) {
  return (
    <div style={{ background: "#f7f7f7", borderRadius: "6px", padding: "3mm 3.5mm", minHeight: "12mm", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
      <p style={{ fontSize: "7px", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: ".1em", margin: "0 0 1.5mm" }}>{label}</p>
      {blank || !value
        ? <div style={{ borderBottom: "1px solid #bbb", height: "10px", marginTop: "5mm" }} />
        : <p style={{ fontSize: large ? "12px" : "9px", fontWeight: large ? 900 : 700, color: "#111", lineHeight: 1.2, margin: 0 }}>{value}</p>}
    </div>
  );
}

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
