export type CompanyBrandData = {
  name?: string | null; trade_name?: string | null; tax_id?: string | null; phone?: string | null; whatsapp?: string | null;
  email?: string | null; address?: string | null; neighborhood?: string | null; city?: string | null; state?: string | null;
  website?: string | null; logo_url?: string | null; primary_color?: string | null; accent_color?: string | null; quote_footer?: string | null;
};

export function CompanyBrand({ company, compact = false }: { company: CompanyBrandData; compact?: boolean }) {
  const tradeName = company.trade_name || "Marquinhos Calhas e Esquadrias";
  const location = [company.address, company.neighborhood, company.city, company.state].filter(Boolean).join(" · ");
  return <div className="flex items-center justify-between gap-5 border-b-2 pb-4" style={{ borderColor: company.primary_color || "#234d3c" }}>
    <div className="flex min-w-0 items-center gap-4">
      {company.logo_url ? <img alt={tradeName} src={company.logo_url} className={`${compact ? "h-14 w-20" : "h-20 w-28"} object-contain`} /> : <div className={`${compact ? "h-14 w-14 text-lg" : "h-20 w-20 text-2xl"} flex shrink-0 items-center justify-center rounded-xl font-black text-white`} style={{ background: company.primary_color || "#234d3c" }}>MC</div>}
      <div className="min-w-0"><h1 className={`${compact ? "text-xl" : "text-2xl"} font-black leading-tight`}>{tradeName}</h1><p className="mt-1 text-xs text-ink/55">{company.name}{company.tax_id ? ` · CNPJ ${company.tax_id}` : ""}</p>{location && <p className="mt-1 text-xs text-ink/55">{location}</p>}</div>
    </div>
    <div className="hidden text-right text-xs leading-5 text-ink/65 sm:block">{company.whatsapp && <p>WhatsApp: {company.whatsapp}</p>}{company.phone && <p>Telefone: {company.phone}</p>}{company.email && <p>{company.email}</p>}{company.website && <p>{company.website}</p>}</div>
  </div>;
}
