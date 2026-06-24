"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ChevronDown, FileDown, Printer, Users } from "lucide-react";
import { proxyLogoUrl, shortDate } from "@/lib/utils";

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

const QTY_OPTIONS = [1, 5, 10, 20, 50, 100];

export function VisitSheet({ clientId, client, company, backHref = "/medicoes" }: VisitSheetData) {
  const [qty, setQty] = useState(1);
  const [showQty, setShowQty] = useState(false);
  const red = company.primary_color || "#d71920";
  const tradeName = company.trade_name || company.name || "Marquinhos Calhas e Esquadrias";
  const legalName = company.name && company.name !== tradeName ? company.name : "Marcus Luiz Keil";
  const phone = client?.whatsapp || client?.phone || "";
  const city = [client?.city, client?.state].filter(Boolean).join(" / ");
  const address = [client?.address, client?.city, client?.state].filter(Boolean).join(" - ");
  const companyLine = [
    legalName,
    company.tax_id ? `CNPJ ${company.tax_id}` : null,
  ].filter(Boolean).join(" - ");
  const companyAddress = [company.address, company.neighborhood, company.city, company.state].filter(Boolean).join(" - ");
  const printHref = clientId ? `/ficha/${clientId}` : "/ficha/branco";

  return (
    <div className="mx-auto max-w-[210mm]">
      <div className="no-print mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-bold text-ink/55 hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
          {client ? "Voltar ao cliente" : "Voltar"}
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link href="/clientes" className="flex items-center gap-2 rounded-xl border border-sand bg-white px-4 py-2 text-sm font-semibold hover:bg-cream">
            <Users className="h-4 w-4" /> Gerar Ficha do Cliente
          </Link>
          <div className="relative">
            <div className="flex">
              <Link href={`/ficha/branco${qty > 1 ? `?qty=${qty}` : ""}`} target="_blank" className="flex items-center gap-2 rounded-l-xl border border-sand bg-white px-4 py-2 text-sm font-semibold hover:bg-cream">
                Ficha em Branco{qty > 1 ? ` (${qty})` : ""}
              </Link>
              <button onClick={() => setShowQty((v) => !v)} className="flex items-center rounded-r-xl border border-l-0 border-sand bg-white px-2 py-2 hover:bg-cream">
                <ChevronDown className="h-3.5 w-3.5 text-ink/50" />
              </button>
            </div>
            {showQty && (
              <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-xl border bg-white p-2 shadow-lg">
                <p className="mb-1.5 px-2 text-xs font-bold text-ink/40">Quantidade</p>
                {QTY_OPTIONS.map((n) => (
                  <button key={n} onClick={() => { setQty(n); setShowQty(false); }} className={`w-full rounded-lg px-3 py-1.5 text-left text-sm font-medium hover:bg-cream ${qty === n ? "bg-lime/20 font-bold text-forest" : ""}`}>
                    {n} {n === 1 ? "cópia" : "cópias"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Link href={printHref} target="_blank" className="flex items-center gap-2 rounded-xl border border-sand bg-white px-4 py-2 text-sm font-semibold hover:bg-cream">
            <Printer className="h-4 w-4" /> Imprimir
          </Link>
          <Link href={printHref} target="_blank" className="flex items-center gap-2 rounded-xl bg-[#234d3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#18221e]">
            <FileDown className="h-4 w-4" /> Gerar PDF
          </Link>
        </div>
      </div>

      <article className="measure-sheet print-sheet bg-white shadow-md" style={{ "--measure-primary": red } as React.CSSProperties}>
        <header className="measure-header">
          <div className="measure-logo-wrap">
            {company.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={tradeName} src={proxyLogoUrl(company.logo_url)!} className="measure-logo-img" />
            ) : (
              <div className="measure-logo-fallback">Marquinhos</div>
            )}
          </div>
          <div className="measure-company">
            <h1>{tradeName}</h1>
            <p>{companyLine}</p>
            <p>{companyAddress || "Ingrácia da Rosa, 92 - Rau - Jaraguá do Sul - SC"}</p>
          </div>
          <div className="measure-contact">
            <p><span>☏</span> WhatsApp: {company.whatsapp || "47 9 9696-0340"}</p>
            <p><span>☎</span> Telefone: {company.phone || "47 96824-8637"}</p>
            <p><span>✉</span> {company.email || "calhasmarcosluiz@gmail.com"}</p>
            <p><span>◎</span> {company.website || "@calhasmarquinhos"}</p>
          </div>
        </header>

        <div className="measure-red-line" />
        <p className="measure-date">Data: {shortDate(new Date().toISOString().slice(0, 10))}</p>

        <section className="measure-grid measure-grid-4">
          <MeasureCard label="CLIENTE" value={client?.name || ""} strong />
          <MeasureCard label="TELEFONE / WHATSAPP" value={phone} />
          <MeasureCard label="BAIRRO" value={client?.neighborhood || (client ? "Não informado" : "")} strong />
          <MeasureCard label="CIDADE" value={city || ""} />
        </section>

        <section className="measure-grid measure-grid-3">
          <MeasureCard label="ENDEREÇO" value={address || ""} />
          <MeasureCard label="DISPONIBILIDADE DE HORÁRIO" blank />
          <MeasureCard label="MEDIDOR" blank />
        </section>

        <section className="measure-lines" aria-label="Área para medidas" />
      </article>
    </div>
  );
}

function MeasureCard({ label, value, strong = false, blank = false }: { label: string; value?: string; strong?: boolean; blank?: boolean }) {
  return (
    <div className="measure-card">
      <p className="measure-card-label">{label}</p>
      {blank || !value ? <div className="measure-card-line" /> : <p className={strong ? "measure-card-value measure-card-value-strong" : "measure-card-value"}>{value}</p>}
    </div>
  );
}
