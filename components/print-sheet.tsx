"use client";
import { useState } from "react";
import { MeasureCallBefore } from "./measure-call-before";
import { MeasureExtraRow } from "./measure-extra-row";
import { AuthorSignature } from "./brand-logo";

import { FileDown, Printer, X } from "lucide-react";
import { shortDate, todayISO } from "@/lib/utils";

type Company = {
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

type Client = {
  name: string;
  phone: string | null;
  whatsapp: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
};

export function PrintSheet({ client, company, qty = 1 }: { client?: Client; company: Company; qty?: number }) {
  const title = client ? `Ficha de Medidas - ${client.name}` : `Ficha de Medidas em Branco${qty > 1 ? ` (${qty})` : ""}`;

  return (
    <>
      <div className="no-print fixed left-0 right-0 top-0 z-50 flex items-center justify-between gap-3 border-b bg-white px-6 py-3 shadow-sm">
        <span className="text-sm font-bold text-ink">{title}</span>
        <div className="flex items-center gap-2">
          {!client && (
            <a href="/clientes" className="flex items-center gap-2 rounded-xl border border-sand bg-white px-4 py-2 text-sm font-semibold hover:bg-cream">
              Escolher Cliente
            </a>
          )}
          {client && (
            <a href="/ficha/branco" className="flex items-center gap-2 rounded-xl border border-sand bg-white px-4 py-2 text-sm font-semibold hover:bg-cream">
              Ficha em Branco
            </a>
          )}
          <button type="button" onClick={() => window.print()} className="flex items-center gap-2 rounded-xl border border-sand bg-white px-4 py-2 text-sm font-semibold hover:bg-cream">
            <Printer className="h-4 w-4" /> Imprimir
          </button>
          <button type="button" onClick={() => window.print()} className="flex items-center gap-2 rounded-xl bg-brand-strong px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong">
            <FileDown className="h-4 w-4" /> Gerar PDF
          </button>
          <a href={client ? "/clientes" : "/medicoes"} className="flex items-center gap-2 rounded-xl border border-sand bg-white px-3 py-2 text-sm font-semibold hover:bg-cream" title="Fechar">
            <X className="h-4 w-4" />
          </a>
        </div>
      </div>

      <div className="flex min-h-screen flex-col items-center gap-4 bg-[#f0f0f0] pb-8 pt-[72px] print:block print:min-h-0 print:bg-white print:p-0">
        {Array.from({ length: Math.max(1, qty) }).map((_, index) => (
          <MeasurePage
            key={index}
            client={client}
            company={company}
            pageBreak={index < qty - 1}
          />
        ))}
      </div>
    </>
  );
}

function MeasurePage({ client, company, pageBreak }: { client?: Client; company: Company; pageBreak?: boolean }) {
  const [availability, setAvailability] = useState("");
  const red = "var(--red-500)";
  const tradeName = company.trade_name || company.name || "Marquinhos Calhas e Esquadrias";
  const legalName = company.name && company.name !== tradeName ? company.name : "Marcus Luiz Keil";
  const phone = client?.whatsapp || client?.phone || "";
  const city = [client?.city, client?.state].filter(Boolean).join(" / ");
  const address = [client?.address, client?.city, client?.state].filter(Boolean).join(" - ");
  const companyLine = [legalName, company.tax_id ? `CNPJ ${company.tax_id}` : null].filter(Boolean).join(" - ");
  const companyAddress = [company.address, company.neighborhood, company.city, company.state].filter(Boolean).join(" - ");

  return (
    <article
      className="measure-sheet print-sheet bg-white shadow-md print:shadow-none"
      style={{
        "--measure-primary": red,
        pageBreakAfter: pageBreak ? "always" : "auto",
        breakAfter: pageBreak ? "page" : "auto",
      } as React.CSSProperties}
    >
      <header className="measure-header">
        <div className="measure-logo-wrap">
          <img alt={tradeName} src="/brand/marquinhos-logo.svg" className="measure-logo-img" />
        </div>
        <div className="measure-company">
          <h1>{tradeName}</h1>
          <p>{companyLine}</p>
          <p>{companyAddress || "Ingracia da Rosa, 92 - Rau - Jaragua do Sul - SC"}</p>
        </div>
        <div className="measure-contact">
          <p><span>☎</span> WhatsApp: {company.whatsapp || "47 9 9696-0340"}</p>
          <p><span>☏</span> Telefone: {company.phone || "47 96824-8637"}</p>
          <p><span>✉</span> {company.email || "calhasmarcosluiz@gmail.com"}</p>
          <p><span>◎</span> {company.website || "@calhasmarquinhos"}</p>
        </div>
      </header>

      <div className="measure-red-line" />
      {client && <p className="measure-date">Data: {shortDate(todayISO())}</p>}

      <section className="measure-grid measure-grid-4">
        <MeasureCard label="CLIENTE" value={client?.name || ""} strong />
        <MeasureCard label="TELEFONE / WHATSAPP" value={phone} />
        <MeasureCard label="BAIRRO" value={client?.neighborhood || (client ? "Nao informado" : "")} strong />
        <MeasureCard label="CIDADE" value={city || ""} />
      </section>

      <section className="measure-grid measure-grid-visit">
        <MeasureCard label="ENDERECO" value={address || ""} />
        <label className="measure-card min-w-0">
          <span className="measure-card-label block">DISPONIBILIDADE DE HORÁRIO</span>
          <input className="measure-card-value w-full border-b border-black bg-transparent print:hidden" value={availability}
            maxLength={100} placeholder="Ex. após as 14h" onChange={event => setAvailability(event.target.value)} />
          <span className="hidden print:block">
            {availability.trim()
              ? <span className="measure-card-value">{availability.trim()}</span>
              : <span className="measure-card-line block" />}
          </span>
        </label>
        <MeasureCard label="MEDIDOR" blank />
        <MeasureCallBefore />
      </section>

      <MeasureExtraRow />

      <section className="measure-lines" aria-label="Area para medidas" />
      <div className="measure-credit"><AuthorSignature/></div>
    </article>
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
