import Link from "next/link";
import { getRequestClient } from "@/lib/supabase/server";
import { type AluminumCalculation, kgText } from "@/lib/aluminum-cost";
import { money } from "@/lib/utils";

export async function QuoteAluminumCost({ quoteId }: { quoteId: string }) {
  const db = await getRequestClient();
  const { data, error } = await db.rpc("preview_quote_aluminum_cost", { p_quote_id: quoteId });
  if (error) return error.code === "42501" ? null : <p className="no-print mb-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Não foi possível calcular o custo do alumínio. Revise os cortes, as espessuras e o preço do kg antes de aprovar.</p>;
  if (!data) return null;
  if (data.configured === false) return <div className="no-print mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Defina o preço do kg na <Link className="font-semibold underline" href="/tabela-calhas?aba=custo-aluminio">Central de Preços</Link> para ativar o custo automático do alumínio.</div>;
  return <AluminumCostBreakdown calculation={data as AluminumCalculation} preview />;
}

export async function OrderAluminumCost({ orderId }: { orderId: string }) {
  const db = await getRequestClient();
  const { data } = await db.from("order_aluminum_costs").select("calculation").eq("order_id", orderId).maybeSingle();
  if (!data) return null;
  return <AluminumCostBreakdown calculation={data.calculation as AluminumCalculation} />;
}

export function AluminumCostBreakdown({ calculation: c, preview = false }: { calculation: AluminumCalculation; preview?: boolean }) {
  return <section className="no-print card my-5 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{preview ? "Previsão de custo do alumínio" : "Alumínio · custo previsto no fechamento"}</h2><p className="mt-1 text-xs text-ink/55">{kgText(c.kg)} kg × {money(c.price_per_kg)}/kg{preview ? " · gravado ao aprovar" : " · preço preservado neste pedido"}</p></div><p className="text-xl font-semibold">{money(c.total_cost)}</p></div>
    <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-forest">Ver peso e aproveitamento</summary>
      <div className="mt-3 space-y-2">{c.lines?.map((line,index)=><div key={index} className="flex flex-wrap justify-between gap-2 rounded-lg bg-cream/60 p-3 text-xs"><span>{line.product} · {String(line.thickness_mm).replace('.',',')} mm · corte {line.cut_mm} · {Number(line.meters).toLocaleString('pt-BR')} m</span><span>{line.kg !== undefined ? `${kgText(line.kg)} kg${line.kg_per_meter !== undefined ? ` · ${kgText(line.kg_per_meter)} kg/m` : ''}${line.cost !== undefined ? ` · ${money(line.cost)}` : ''}` : "Incluído no aproveitamento de 1 mm"}</span></div>)}</div>
      {!!c.one_mm?.patterns?.length && <div className="mt-4 rounded-xl border p-4"><p className="text-sm font-semibold">1 mm · aproveitamento {Number(c.one_mm.utilization_pct).toLocaleString('pt-BR')}%</p><p className="mt-1 text-xs text-ink/55">Sobra incluída: {kgText(c.one_mm.waste_kg)} kg</p>{c.one_mm.patterns.map((pattern,index)=><p className="mt-2 text-xs" key={index}>Bobina {pattern.coil_width_mm} mm · cortes {pattern.cuts.map(cut=>`${cut.strips} × ${cut.cut_mm}`).join(' + ')} · {Number(pattern.coil_meters).toLocaleString('pt-BR',{maximumFractionDigits:6})} m de bobina · {kgText(pattern.kg)} kg</p>)}</div>}
      {!!c.excluded_items && <p className="mt-3 text-xs text-ink/55">Os itens de outros materiais não entram no custo do alumínio.</p>}
    </details>
  </section>;
}
