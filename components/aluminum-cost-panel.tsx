import Link from "next/link";
import { Save, Scale } from "lucide-react";
import { getRequestClient } from "@/lib/supabase/server";
import { ALUMINUM_WEIGHT_ROWS, kgText } from "@/lib/aluminum-cost";
import { money } from "@/lib/utils";
import { saveAluminumKgPrice } from "@/app/(crm)/aluminum-cost-actions";
import { SubmitButton } from "@/components/submit-button";

export async function AluminumCostPanel({ companyId, canManage, selfHref }: { companyId?: string; canManage: boolean; selfHref: string }) {
  const db = await getRequestClient();
  const { data, error } = companyId ? await db.from("aluminum_cost_settings").select("price_per_kg,updated_at").eq("company_id", companyId).maybeSingle() : { data: null, error: null };
  const price = data ? Number(data.price_per_kg) : null;
  return <div className="space-y-6">
    <section className="card p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3"><Scale className="mt-1 h-5 w-5 text-forest" /><div><h2 className="text-lg font-semibold">Custo do alumínio</h2><p className="mt-1 text-sm text-ink/60">Ao aprovar o orçamento de calhas, o custo do alumínio entra automaticamente no custo previsto do pedido.</p></div></div>
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">Não foi possível consultar o custo do alumínio.</p>}
      {canManage ? <form action={saveAluminumKgPrice} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="_back" value={`${selfHref}?aba=custo-aluminio`} />
        <label><span className="label">Valor do kg do alumínio (R$)</span><input name="price_per_kg" aria-label="Valor do kg do alumínio" inputMode="decimal" autoComplete="off" required className="field w-48 text-lg font-semibold" placeholder="0,00" defaultValue={price === null ? "" : price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} /></label>
        <SubmitButton className="button"><Save className="h-4 w-4" />Salvar preço do kg</SubmitButton>
      </form> : <p className="text-2xl font-semibold">{price === null ? "Preço ainda não definido" : `${money(price)}/kg`}</p>}
      <p className="mt-3 text-xs text-ink/55">{price === null ? "Defina o preço do kg para ativar o custo automático nos próximos fechamentos." : "Cada pedido guarda o preço usado no fechamento. Alterar este valor vale para os próximos pedidos."}</p>
    </section>
    <section className="grid gap-5 lg:grid-cols-3">{[.5,.6,.7].map(thickness => <div className="card overflow-hidden" key={thickness}>
      <h3 className="border-b p-4 font-semibold">Alumínio {String(thickness).replace('.',',')} mm</h3>
      <table className="w-full text-sm"><thead className="bg-cream/60 text-left text-xs text-ink/60"><tr><th className="p-3">Corte</th><th className="p-3 text-right">kg/m</th><th className="p-3 text-right">Custo/m</th></tr></thead><tbody>{ALUMINUM_WEIGHT_ROWS.filter(row => row.thickness === thickness).map(row => <tr className="border-t" key={row.cut}><td className="p-3">{row.cut} mm</td><td className="p-3 text-right tabular-nums">{kgText(row.kg)}</td><td className="p-3 text-right tabular-nums">{price === null ? "—" : money(row.kg * price)}</td></tr>)}</tbody></table>
    </div>)}</section>
    <section className="card p-5"><h3 className="font-semibold">Alumínio de 1 mm · aproveitamento de bobina</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">{[[1000,2.75],[1200,3.3]].map(([width,kg])=><div className="rounded-xl bg-cream p-4" key={width}><p className="font-semibold">Bobina {width} mm</p><p className="mt-1 text-sm">{kgText(kg)} kg por metro de bobina{price !== null && ` · ${money(kg*price)}/m`}</p></div>)}</div><p className="mt-4 text-sm text-ink/65">Os cortes de 1 mm do mesmo pedido são combinados nas bobinas de 1.000 e 1.200 mm. O cálculo inclui a sobra e mostra o aproveitamento no pedido.</p><p className="mt-2 text-xs text-ink/50">Nos demais cortes fora da tabela, o peso é proporcional à bobina de 1.200 mm da mesma espessura.</p></section>
    <Link href="/financeiro/obras" className="button-ghost">Ver custos previstos por pedido</Link>
  </div>;
}
