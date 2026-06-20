import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { approveQuote } from "@/app/(crm)/actions";
import { CompanyBrand, type CompanyBrandData } from "@/components/company-brand";
import { PrintButton } from "@/components/print-button";
import { createClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";

type Row = Record<string, unknown>;
type QuoteData = { id:string; quote_number:string; status:string; subtotal:number; discount:number; freight:number; total:number; valid_until:string|null; notes:string|null; created_at:string; client:Row; company:CompanyBrandData };
type QuoteItem = { product:string; description?:string|null; thickness?:string; cut?:string; quantity:number; meters?:number; unit_price:number; total:number };
export async function QuoteDocument({ id, error }: { id: string; error?: string }) {
  const db = await createClient();
  const quoteResult = await db.from("quotes").select("id,quote_number,status,subtotal,discount,freight,total,valid_until,notes,created_at,client:clients(name,phone,whatsapp,email,tax_id,address,neighborhood,city,state),sale_type:sale_types(name),company:companies(*)").eq("id", id).single();
  if (quoteResult.error || !quoteResult.data) return <p className="card p-8">Orçamento não encontrado: {quoteResult.error?.message}</p>;
  const quote = quoteResult.data as unknown as QuoteData;
  const gutter = await db.from("gutter_quotes").select("id,items:gutter_quote_items(product,thickness,cut,quantity,meters,unit_price,total)").eq("quote_id", id).maybeSingle();
  let items = ((gutter.data as unknown as { items?: QuoteItem[] } | null)?.items ?? []);
  if (!items.length) { const result = await db.from("quote_items").select("product,description,unit,quantity,unit_price,total").eq("quote_id", id); items = (result.data as unknown as QuoteItem[]) ?? []; }
  const company = quote.company; const client = quote.client; const isGutter = Boolean(gutter.data);
  return <div className="mx-auto max-w-5xl"><div className="no-print mb-5 flex items-center justify-between"><Link href="/orcamentos" className="inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft className="h-4 w-4" /> Voltar</Link><div className="flex gap-3"><PrintButton />{quote.status !== "aprovado" && <form action={approveQuote}><input type="hidden" name="quote_id" value={id} /><button className="button-ghost"><CheckCircle2 className="h-4 w-4" /> Aprovar orçamento</button></form>}</div></div>
    {error && <p className="no-print mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <article className="print-sheet card bg-white p-7 lg:p-10"><CompanyBrand company={company} /><div className="mt-7 flex items-start justify-between gap-6"><div><p className="text-xs font-bold uppercase tracking-[.2em]" style={{color:company.primary_color || "#234d3c"}}>Orçamento comercial</p><h2 className="mt-1 text-2xl font-black">{String(quote.quote_number)}</h2><p className="mt-1 text-xs text-ink/45">Emitido em {shortDate(String(quote.created_at).slice(0,10))} · Válido até {shortDate(quote.valid_until as string)}</p></div><span className="rounded-full px-3 py-1.5 text-xs font-bold" style={{background:company.accent_color || "#b9d349"}}>{String(quote.status).replaceAll("_"," ")}</span></div>
      <section className="mt-6 rounded-xl bg-cream/70 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Cliente</p><div className="mt-1 flex flex-wrap justify-between gap-3"><div><p className="text-lg font-black">{String(client.name)}</p><p className="text-xs text-ink/55">{[client.address,client.neighborhood,client.city,client.state].filter(Boolean).join(" · ")}</p></div><div className="text-right text-xs text-ink/60"><p>{String(client.whatsapp || client.phone || "")}</p><p>{String(client.email || "")}</p></div></div></section>
      <div className="mt-6 overflow-hidden rounded-xl border"><table className="w-full text-left text-xs"><thead className="text-white" style={{background:company.primary_color || "#234d3c"}}><tr><th className="p-3">Produto</th>{isGutter && <><th className="p-3">Espessura</th><th className="p-3">Corte</th><th className="p-3 text-right">Metragem</th></>}<th className="p-3 text-right">Qtd.</th><th className="p-3 text-right">Unitário</th><th className="p-3 text-right">Total</th></tr></thead><tbody className="divide-y">{items.map((item,index)=><tr key={index}><td className="p-3 font-bold">{String(item.product)}{item.description && <span className="block font-normal text-ink/45">{String(item.description)}</span>}</td>{isGutter && <><td className="p-3">{String(item.thickness)}</td><td className="p-3">{String(item.cut)}</td><td className="p-3 text-right">{String(item.meters)} m</td></>}<td className="p-3 text-right">{String(item.quantity)}</td><td className="p-3 text-right">{money(item.unit_price as number)}</td><td className="p-3 text-right font-bold">{money(item.total as number)}</td></tr>)}</tbody></table></div>
      <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_280px]"><div>{quote.notes && <><p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Observações</p><p className="mt-1 whitespace-pre-line text-xs leading-5 text-ink/65">{String(quote.notes)}</p></>}</div><div className="space-y-2 rounded-xl bg-cream/70 p-4 text-sm"><Line label="Subtotal" value={money(quote.subtotal as number)} /><Line label="Desconto" value={`- ${money(quote.discount as number)}`} /><Line label="Frete" value={money(quote.freight as number)} /><div className="border-t pt-3"><Line label="Total" value={money(quote.total as number)} strong /></div></div></div>
      <div className="mt-10 border-t pt-4 text-center text-[10px] leading-4 text-ink/45">{company.quote_footer || "Orçamento sujeito à disponibilidade de materiais e confirmação das medidas no local."}</div>
    </article>
  </div>;
}
function Line({label,value,strong}:{label:string;value:string;strong?:boolean}) { return <div className="flex justify-between gap-4"><span className={strong?"font-black":"text-ink/55"}>{label}</span><span className={strong?"text-lg font-black":"font-bold"}>{value}</span></div>; }
