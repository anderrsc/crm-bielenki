import Link from "next/link";
import { getRequestClient } from "@/lib/supabase/server";
import { money } from "@/lib/utils";
import { friendlyError } from "@/lib/friendly-error";
import { SubmitButton } from "@/components/submit-button";
import { saveExpectedCost } from "@/app/(crm)/order-result-actions";
import { orderResultStatus, type OrderResult } from "@/lib/order-result";

const PAGE = 25;
const SITUACOES: Record<string, string> = { abertas: "Em andamento", todas: "Todas", estouradas: "Acima do previsto", semprevisao: "Sem custo previsto" };

export default async function OrderResultsPage({ searchParams }: { searchParams: Promise<{ q?: string; situacao?: string; pagina?: string; erro?: string; salvo?: string }> }) {
  const search = await searchParams;
  const db = await getRequestClient();
  const term = (search.q ?? "").trim().slice(0, 80).replace(/[,()*%\\]/g, " ").trim();
  const situacao = search.situacao && SITUACOES[search.situacao] ? search.situacao : "abertas";
  const page = Math.max(1, Number.parseInt(search.pagina ?? "1", 10) || 1);
  let query = db.from("v_order_result").select("*").order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE);
  if (term) query = query.or(`order_number.ilike.*${term}*,client_name.ilike.*${term}*`);
  if (situacao === "abertas") query = query.not("operational_status", "in", "(finalizado,cancelado)");
  if (situacao === "semprevisao") query = query.is("expected_cost", null);
  const [{ data, error }, { data: allowed }] = await Promise.all([query, db.rpc("has_table_access", { resource: "financial_entries", action: "update" })]);
  const back = <Link href="/financeiro" className="text-sm font-bold text-forest underline">Voltar ao financeiro</Link>;
  if (error) return <div className="mx-auto max-w-5xl space-y-4">{back}<p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">Não foi possível carregar as obras. Atualize a página.</p></div>;
  let rows = ((data ?? []) as OrderResult[]);
  const hasMore = rows.length > PAGE;
  rows = rows.slice(0, PAGE);
  // "Acima do previsto" depende de soma: filtra na pagina carregada e avisa.
  const shown = situacao === "estouradas" ? rows.filter((r) => orderResultStatus(r).over) : rows;
  const params = (p: Record<string, string | number>) => `/financeiro/obras?${new URLSearchParams(Object.entries({ q: term, situacao, pagina: page, ...p }).filter(([, v]) => v !== "").map(([k, v]) => [k, String(v)]))}`;
  const self = params({});

  return <div className="mx-auto max-w-6xl space-y-5">
    {back}
    <div>
      <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Controle financeiro</p>
      <h1 className="mt-2 text-3xl font-black">Resultado por obra</h1>
      <p className="mt-1 text-sm text-ink/60">Para cada pedido: quanto foi contratado, o custo que você previu, o que está comprometido em compras ainda não recebidas e o custo já realizado.</p>
    </div>
    {search.erro && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{friendlyError(search.erro)?.slice(0, 250)}</p>}
    {search.salvo === "1" && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">Custo previsto salvo.</p>}

    <form method="get" className="flex flex-wrap items-end gap-2 rounded-2xl border border-sand bg-surface p-3 text-sm">
      <label><span className="label">Buscar</span><input className="field" name="q" defaultValue={search.q ?? ""} placeholder="Cliente ou número do pedido" /></label>
      <label><span className="label">Situação</span><select className="field" name="situacao" defaultValue={situacao}>{Object.entries(SITUACOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <button className="button">Filtrar</button>
      {(term || situacao !== "abertas") && <Link href="/financeiro/obras" className="pb-2 font-bold text-ink/55 underline">Limpar</Link>}
    </form>
    {situacao === "estouradas" && <p className="text-xs text-ink/55">Este filtro confere as {rows.length} obras desta página; use as páginas para ver as demais.</p>}

    {!shown.length && <div className="card p-8 text-center text-sm text-ink/45">Nenhuma obra encontrada.</div>}
    <div className="space-y-3">
      {shown.map((r) => {
        const s = orderResultStatus(r);
        return <div key={r.order_id} className={`card space-y-3 p-4 ${s.over ? "border-red-200" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><p className="truncate text-base font-black">{r.client_name ?? "Cliente não informado"}</p><p className="text-xs text-ink/55">Pedido {r.order_number}{r.sale_id ? <> · <Link className="underline" href={`/vendas/${r.sale_id}`}>ver venda</Link></> : null}</p></div>
            <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${s.over ? "bg-red-50 text-red-700" : s.noForecast ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{s.label}</span>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Item label="Contratado" value={money(r.revenue)} hint={`recebido ${money(r.received)}`} />
            <Item label="Custo previsto" value={r.expected_cost === null ? "—" : money(r.expected_cost)} hint={s.usedPct === null ? "sem previsão" : `${s.usedPct}% usado`} />
            <Item label="Comprometido" value={money(r.cost_committed)} hint="compras ainda não recebidas" />
            <Item label="Realizado" value={money(r.cost_realized)} hint={`pago ${money(r.cost_paid)}`} />
            <Item label="Margem prevista" value={r.margin_expected === null ? "—" : money(r.margin_expected)} tone={r.margin_expected !== null && Number(r.margin_expected) < 0 ? "bad" : undefined} />
            <Item label="Margem atual" value={money(r.margin_current)} hint={s.marginPct === null ? undefined : `${s.marginPct}% do contratado`} tone={Number(r.margin_current) < 0 ? "bad" : "good"} />
          </dl>
          {allowed === true && <form action={saveExpectedCost} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="order_id" value={r.order_id} /><input type="hidden" name="_back" value={self} />
            <label><span className="label">Custo previsto da obra</span><input className="field w-40" name="expected_cost" inputMode="decimal" placeholder="0,00" defaultValue={r.expected_cost === null ? "" : Number(r.expected_cost).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} aria-label={`Custo previsto do pedido ${r.order_number}`} /></label>
            <SubmitButton className="button-ghost">Salvar previsão</SubmitButton>
            <Link className="button-ghost" href={`/financeiro/rateios?q=${encodeURIComponent(r.client_name ?? r.order_number)}`}>Ratear contas</Link>
          </form>}
        </div>;
      })}
    </div>
    {(page > 1 || hasMore) && <div className="flex items-center justify-between text-sm">
      <span className="text-ink/50">Página {page}</span>
      <div className="flex gap-2">{page > 1 && <Link className="button-ghost" href={params({ pagina: page - 1 })}>Anterior</Link>}{hasMore && <Link className="button-ghost" href={params({ pagina: page + 1 })}>Próxima</Link>}</div>
    </div>}
    <p className="text-xs text-ink/55">Margem atual = contratado menos o realizado e o comprometido. Entram só as contas lançadas e as compras confirmadas; mão de obra, impostos e comissões entram quando forem lançados e rateados para a obra. É uma visão gerencial.</p>
  </div>;
}

function Item({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return <div><dt className="text-xs font-bold uppercase tracking-wider text-ink/45">{label}</dt><dd className={`mt-0.5 font-black ${tone === "bad" ? "text-red-700" : tone === "good" ? "text-emerald-700" : ""}`}>{value}</dd>{hint && <dd className="text-xs text-ink/55">{hint}</dd>}</div>;
}
