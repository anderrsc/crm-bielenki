import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CompanyBrand, type CompanyBrandData } from "@/components/company-brand";
import { PrintButton } from "@/components/print-button";
import { createClient } from "@/lib/supabase/server";
import { shortDate } from "@/lib/utils";

export async function VisitSheet({ clientId }: { clientId: string }) {
  const db = await createClient();
  const result = await db.from("clients").select("*,company:companies(*)").eq("id",clientId).single();
  if (result.error || !result.data) return <p className="card p-8">Cliente não encontrado: {result.error?.message}</p>;
  const client = result.data as unknown as Record<string,unknown>; const company = client.company as CompanyBrandData;
  return <div className="mx-auto max-w-[210mm]"><div className="no-print mb-5 flex items-center justify-between"><Link href={`/clientes/${clientId}`} className="inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft className="h-4 w-4" /> Voltar ao cliente</Link><PrintButton label="Imprimir ficha" /></div>
    <article className="print-sheet card min-h-[297mm] bg-white p-[10mm]"><CompanyBrand company={company} compact /><div className="mt-3 grid grid-cols-[1fr_auto] items-stretch gap-3"><div className="rounded-lg border-2 p-3" style={{borderColor:company.primary_color || "#234d3c"}}><p className="text-[9px] font-bold uppercase tracking-[.18em] text-ink/40">Cliente</p><p className="text-2xl font-black leading-tight">{String(client.name)}</p></div><div className="min-w-48 rounded-lg p-3 text-white" style={{background:company.primary_color || "#234d3c"}}><p className="text-[9px] font-bold uppercase tracking-[.18em] text-white/60">Bairro</p><p className="text-2xl font-black leading-tight">{String(client.neighborhood || "Não informado")}</p></div></div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]"><Info label="Telefone / WhatsApp" value={String(client.whatsapp || client.phone || "")} /><Info label="Endereço" value={[client.address,client.city,client.state].filter(Boolean).join(" · ")} /><Info label="Data da visita" value={shortDate(new Date().toISOString().slice(0,10))} /></div>
      <div className="visit-writing-area relative mt-3 min-h-[205mm] rounded-lg border border-ink/20 bg-white"><div className="absolute inset-x-0 top-0 flex justify-between border-b border-ink/10 px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-ink/30"><span>Medições / croquis / observações</span><span>Responsável: ____________________</span></div><div className="absolute inset-x-0 top-9 border-t border-dashed border-ink/5" style={{backgroundImage:"linear-gradient(to bottom, transparent 24px, rgba(24,34,30,.055) 25px)",backgroundSize:"100% 25px",height:"calc(100% - 36px)"}} /></div>
      <div className="mt-2 flex justify-between text-[9px] text-ink/35"><span>Ficha de visita técnica · {company.trade_name || "Marquinhos Calhas e Esquadrias"}</span><span>Cliente: {String(client.name)} · Bairro: {String(client.neighborhood || "-")}</span></div>
    </article>
  </div>;
}
function Info({label,value}:{label:string;value:string}) { return <div className="rounded-lg bg-cream/70 px-3 py-2"><p className="font-bold uppercase tracking-wider text-ink/35">{label}</p><p className="mt-0.5 font-bold">{value || "Não informado"}</p></div>; }
