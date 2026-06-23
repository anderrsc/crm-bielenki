import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CompanyBrand, type CompanyBrandData } from "@/components/company-brand";
import { PrintButton } from "@/components/print-button";
import { createClient } from "@/lib/supabase/server";
import { shortDate } from "@/lib/utils";

const checklist = [
  "Medidas conferidas",
  "Produto definido",
  "Cor definida",
  "Vidro definido",
  "Acessorios definidos",
  "Forma de instalacao definida",
  "Fotos realizadas",
  "Cliente aprovou medidas",
  "Producao liberada",
];

export async function VisitSheet({ clientId }: { clientId: string }) {
  const db = await createClient();
  const result = await db.from("clients").select("*,company:companies(*)").eq("id",clientId).single();
  if (result.error || !result.data) return <p className="card p-8">Cliente nao encontrado: {result.error?.message}</p>;
  const client = result.data as unknown as Record<string,unknown>;
  const company = client.company as CompanyBrandData;
  const address = [client.address, client.neighborhood, client.city, client.state].filter(Boolean).join(" - ");
  return <div className="mx-auto max-w-[210mm]"><div className="no-print mb-5 flex items-center justify-between"><Link href={`/clientes/${clientId}`} className="inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft className="h-4 w-4" /> Voltar ao cliente</Link><PrintButton label="Imprimir ficha" /></div>
    <article className="print-sheet card min-h-[297mm] bg-white p-[8mm]"><CompanyBrand company={company} compact />
      <div className="mt-2 flex items-center justify-between border-b-2 pb-2" style={{borderColor:company.primary_color || "#234d3c"}}>
        <div><p className="text-[9px] font-black uppercase tracking-[.22em] text-ink/40">Ficha oficial de medicao</p><h1 className="text-2xl font-black">Visita tecnica / croqui</h1></div>
        <div className="rounded-lg px-3 py-2 text-right text-white" style={{background:company.primary_color || "#234d3c"}}><p className="text-[9px] font-bold uppercase tracking-wider text-white/65">Data</p><p className="font-black">{shortDate(new Date().toISOString().slice(0,10))}</p></div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-[10px]">
        <Info label="Cliente" value={String(client.name)} strong />
        <Info label="Telefone / WhatsApp" value={String(client.whatsapp || client.phone || "")} />
        <Info label="Bairro" value={String(client.neighborhood || "Nao informado")} strong />
        <Info label="Cidade" value={[client.city,client.state].filter(Boolean).join(" / ")} />
        <div className="col-span-2"><Info label="Endereco" value={address} /></div>
        <Info label="Vendedor" value="____________________" />
        <Info label="Medidor" value="____________________" />
      </div>
      <div className="visit-writing-area relative mt-3 min-h-[172mm] rounded-lg border-2 border-ink/15 bg-white">
        <div className="absolute inset-x-0 top-0 flex justify-between border-b border-ink/10 px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-ink/35"><span>Area de croqui / desenhos / ambientes / anotacoes tecnicas</span><span>80% livre</span></div>
        <div className="absolute inset-x-0 top-9 border-t border-dashed border-ink/5" style={{backgroundImage:"linear-gradient(to bottom, transparent 23px, rgba(24,34,30,.06) 24px)",backgroundSize:"100% 24px",height:"calc(100% - 36px)"}} />
      </div>
      <table className="mt-3 w-full border-collapse text-[9px]">
        <thead><tr className="bg-cream text-left">{["Ambiente","Produto","Largura","Altura","Qtd","Cor","Vidro","Observacoes"].map(h=><th key={h} className="border px-1.5 py-1 font-black uppercase tracking-wide text-ink/55">{h}</th>)}</tr></thead>
        <tbody>{Array.from({length:7}).map((_,i)=><tr key={i}>{Array.from({length:8}).map((__,j)=><td key={j} className="h-6 border px-1.5">&nbsp;</td>)}</tr>)}</tbody>
      </table>
      <div className="mt-3 grid grid-cols-3 gap-1.5 text-[9px]">{checklist.map(item=><label key={item} className="flex items-center gap-1 rounded border px-2 py-1 font-semibold"><span className="inline-block h-3 w-3 border border-ink/40" />{item}</label>)}</div>
      <div className="mt-2 flex justify-between text-[9px] text-ink/35"><span>Ficha de medicao tecnica - {company.trade_name || "Marquinhos Calhas e Esquadrias"}</span><span>Cliente: {String(client.name)} - Bairro: {String(client.neighborhood || "-")}</span></div>
    </article>
  </div>;
}

function Info({label,value,strong=false}:{label:string;value:string;strong?:boolean}) {
  return <div className="rounded-lg bg-cream/70 px-3 py-2"><p className="font-bold uppercase tracking-wider text-ink/35">{label}</p><p className={`mt-0.5 ${strong ? "text-base font-black" : "font-bold"}`}>{value || "Nao informado"}</p></div>;
}
