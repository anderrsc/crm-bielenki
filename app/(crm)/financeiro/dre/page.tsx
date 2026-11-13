import Link from "next/link";
import { getRequestClient } from "@/lib/supabase/server";
import { money, todayISO } from "@/lib/utils";
import { buildDre, monthsBetween, type DreLine } from "@/lib/financial-dre";
import { validIsoDate } from "@/lib/valid-date";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };
const isMonth = (v?: string) => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export default async function DrePage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; tipo?: string }> }) {
  const search = await searchParams;
  const today = todayISO();
  const year = today.slice(0, 4);
  const from = isMonth(search.de) ? search.de! : `${year}-01`;
  let to = isMonth(search.ate) ? search.ate! : today.slice(0, 7);
  if (to < from) to = from;
  const start = `${from}-01`, end = lastDay(to);
  const months = monthsBetween(start, end);
  const db = await getRequestClient();
  const { data: types } = await db.from("sale_types").select("id,name").eq("active", true).order("name");
  const tipo = search.tipo && (types ?? []).some((t) => t.id === search.tipo) ? search.tipo : "";
  const { data, error } = validIsoDate(start) && validIsoDate(end)
    ? await db.rpc("financial_dre_lines", { p_start: start, p_end: end, p_sale_type: tipo || null })
    : { data: null, error: { message: "Período inválido" } };
  if (error) return <div className="mx-auto max-w-5xl space-y-4"><Link href="/financeiro" className="text-sm font-bold text-forest underline">Voltar ao financeiro</Link><p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">Não foi possível carregar a DRE. Atualize a página.</p></div>;
  const rows = buildDre((data ?? []) as DreLine[], months);
  const receita = rows[0].total, resultado = rows[10].total;
  const margin = receita ? Math.round((resultado / receita) * 1000) / 10 : null;
  const uncategorized = rows.flatMap((r) => r.details ?? []).filter((d) => /sem categoria/i.test(d.category)).reduce((s, d) => s + Math.abs(d.total), 0);
  const href = (p: Record<string, string>) => `/financeiro/dre?${new URLSearchParams(Object.entries({ de: from, ate: to, tipo, ...p }).filter(([, v]) => v))}`;
  const prev = String(Number(year) - 1);

  return <div className="mx-auto max-w-[1400px] space-y-5">
    <Link href="/financeiro" className="text-sm font-bold text-forest underline">Voltar ao financeiro</Link>
    <div>
      <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Controle financeiro</p>
      <h1 className="mt-2 text-3xl font-black">DRE gerencial</h1>
      <p className="mt-1 text-sm text-ink/60">Resultado por competência (mês a que a conta pertence), não pelo dia do pagamento. É uma visão gerencial: não substitui o resultado contábil oficial.</p>
    </div>

    <form method="get" className="flex flex-wrap items-end gap-2 rounded-2xl border border-sand bg-surface p-3 text-sm">
      <div><label className="label">De</label><input className="field" type="month" name="de" defaultValue={from} /></div>
      <div><label className="label">Até</label><input className="field" type="month" name="ate" defaultValue={to} /></div>
      <div><label className="label">Tipo de venda</label><select className="field" name="tipo" defaultValue={tipo}><option value="">Todos</option>{(types ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      <button className="button">Aplicar</button>
      <Link className="button-ghost" href={href({ de: today.slice(0, 7), ate: today.slice(0, 7) })}>Este mês</Link>
      <Link className="button-ghost" href={href({ de: `${year}-01`, ate: today.slice(0, 7) })}>Este ano</Link>
      <Link className="button-ghost" href={href({ de: `${prev}-01`, ate: `${prev}-12` })}>Ano passado</Link>
    </form>

    <div className="grid gap-3 sm:grid-cols-3">
      <div className="card p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Receita bruta</p><p className="mt-1 text-2xl font-black">{money(receita)}</p></div>
      <div className={`card p-4 ${resultado < 0 ? "border-red-200" : "border-emerald-200"}`}><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Resultado do período</p><p className={`mt-1 text-2xl font-black ${resultado < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(resultado)}</p></div>
      <div className="card p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Margem sobre a receita</p><p className="mt-1 text-2xl font-black">{margin === null ? "—" : `${margin.toLocaleString("pt-BR")}%`}</p></div>
    </div>

    {tipo && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Visão por tipo de venda: entram as receitas das vendas desse tipo e os custos ligados à venda ou rateados para as obras. Despesas gerais sem obra ficam de fora; veja em “Todos”.</p>}
    {uncategorized > 0 && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{money(uncategorized)} em contas sem categoria. <Link className="font-bold underline" href="/financeiro/classificacoes">Classifique as contas</Link> para a DRE ficar correta.</p>}

    <div className="card overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b bg-cream text-left text-xs font-bold uppercase tracking-wider text-ink/45">
          <th className="px-3 py-2">Linha</th>{months.map((m) => <th key={m} className="px-3 py-2 text-right">{label(m)}</th>)}{months.length > 1 && <th className="px-3 py-2 text-right">Total</th>}
        </tr></thead>
        {rows.map((r) => <tbody key={r.key} className="border-b">
          <tr className={r.kind === "total" ? "bg-cream/60" : ""}>
            <td className={`px-3 py-2 ${r.kind === "total" ? "font-black" : "font-bold"}`}>{r.label}</td>
            {r.values.map((v, i) => <Cell key={i} n={v} strong={r.kind === "total"} />)}{months.length > 1 && <Cell n={r.total} strong />}
          </tr>
          {(r.details ?? []).map((d) => <tr key={d.category} className="text-ink/65">
            <td className="px-3 py-1.5 pl-8">{d.category}</td>
            {d.values.map((v, i) => <Cell key={i} n={v} />)}{months.length > 1 && <Cell n={d.total} />}
          </tr>)}
        </tbody>)}
      </table>
    </div>
    <p className="text-xs text-ink/55">Contas canceladas não entram. Juros e descontos das baixas aparecem no resultado financeiro e nas deduções. A linha de cada categoria é definida em <Link className="underline" href="/financeiro/classificacoes">Categorias e centros de custos</Link>.</p>
  </div>;
}

function Cell({ n, strong = false }: { n: number; strong?: boolean }) {
  return <td className={`whitespace-nowrap px-3 py-2 text-right ${strong ? "font-black" : ""} ${n < 0 ? "text-red-700" : ""}`}>{n === 0 ? "—" : money(n)}</td>;
}
