"use client";
// Tributos (calculadora): simula IBS/CBS/IS com o motor oficial da Receita. Não emite nota e não lança
// nada no financeiro. Valores mostrados são SIMULAÇÃO, não documento fiscal autorizado.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, Info, Loader2, Play } from "lucide-react";
import { aprovarClassificacao, salvarClassificacao, salvarConfiguracaoFiscal, simularTributos, statusMotor, type Simulacao } from "@/app/(crm)/fiscal-actions";
import { money, shortDate, todayISO } from "@/lib/utils";
import { cn } from "@/lib/utils";

type Aliq = { cbs: number; ibsEstadual: number; ibsMunicipal: number; fonte: string };
export type FiscalData = {
  aba: "calculadora" | "classificacoes" | "historico" | "configuracao";
  orcamentoInicial: string | null;
  settings: { enabled: boolean; regime: "simples" | "hibrido" | "regular"; uf: string | null; municipio_ibge: number | null; aliquotas_informadas: Record<string, Aliq>; updated_at: string } | null;
  podeEditar: boolean; podeAprovar: boolean;
  quotes: { id: string; numero: string; cliente: string; total: number; data: string; status: string }[];
  classificacoes: { id: string; produto: string; produto_chave: string; natureza: "mercadoria" | "servico"; ncm: string | null; nbs: string | null; cst: string | null; cclasstrib: string | null; unidade: string | null; observacao: string | null; status: "rascunho" | "aprovada"; aprovado_em: string | null; aprovador: { full_name: string } | null }[];
  produtosSemClassificacao: string[];
  calculos: { id: string; origem: string; data_fato_gerador: string; versao_app: string | null; versao_db: string | null; simulado: boolean; status: string; total_base: number; total_cbs: number; total_ibs: number; total_is: number; created_at: string; quote: { quote_number: string } | null; autor: { full_name: string } | null }[];
};

const ABAS = [["calculadora", "Calculadora"], ["classificacoes", "Classificações"], ["historico", "Histórico"], ["configuracao", "Configuração"]] as const;
const ESTADO: Record<string, [string, string]> = {
  CALCULADO: ["Calculado", "bg-emerald-50 text-emerald-700"],
  CALCULO_SIMULADO: ["Simulado", "bg-amber-50 text-amber-800"],
  INCONSISTENCIA_ENTRADA: ["Dado inconsistente", "bg-red-50 text-red-700"],
  NAO_IMPLEMENTADO: ["Não implementado no motor", "bg-cream text-ink/60"],
  FALHA_TECNICA: ["Falha técnica", "bg-red-50 text-red-700"],
  SEM_CLASSIFICACAO: ["Sem classificação", "bg-cream text-ink/60"],
};

export function FiscalPage({ data }: { data: FiscalData }) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <p className="text-xs font-semibold text-forest">Reforma tributária</p>
        <h1 className="mt-2 text-3xl font-semibold">Tributos (calculadora)</h1>
        <p className="mt-1 text-sm text-ink/60">Simula CBS, IBS e Imposto Seletivo com o motor oficial da Receita Federal. É <b>simulação</b>: não emite nota, não muda preço e não lança nada no financeiro.</p>
      </div>
      <nav className="tab-strip" aria-label="Seções">
        {ABAS.map(([k, label]) => <Link key={k} href={`/fiscal?aba=${k}`} aria-current={data.aba === k ? "page" : undefined} className="tab-pill">{label}</Link>)}
      </nav>
      {!data.settings?.enabled && data.aba !== "configuracao" && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />A calculadora está desligada. {data.podeEditar ? <Link href="/fiscal?aba=configuracao" className="font-semibold underline">Configure e ligue</Link> : "Peça ao financeiro para configurar."}</p>
      )}
      {data.aba === "calculadora" && <Calculadora data={data} />}
      {data.aba === "classificacoes" && <Classificacoes data={data} />}
      {data.aba === "historico" && <Historico data={data} />}
      {data.aba === "configuracao" && <Configuracao data={data} />}
    </div>
  );
}

function Calculadora({ data }: { data: FiscalData }) {
  const [quoteId, setQuoteId] = useState(data.orcamentoInicial ?? "");
  const [dia, setDia] = useState(todayISO());
  const [res, setRes] = useState<Simulacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ano = Number(dia.slice(0, 4));
  const aliq = data.settings?.aliquotas_informadas?.[String(ano)];
  const simular = () => start(async () => {
    setErro(null); setRes(null);
    const r = await simularTributos({ quoteId, data: dia });
    if (r.ok) setRes(r); else setErro(r.error);
  });
  return (
    <div className="space-y-4">
      <section className="card grid gap-3 p-5 sm:grid-cols-[1fr_180px_auto] sm:items-end">
        <label><span className="label">Orçamento</span>
          <select className="field w-full" value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
            <option value="">Escolha o orçamento</option>
            {data.quotes.map((q) => <option key={q.id} value={q.id}>{q.numero} · {q.cliente} · {money(q.total)}</option>)}
          </select></label>
        <label><span className="label">Data da operação</span><input className="field w-full" type="date" value={dia} onChange={(e) => setDia(e.target.value)} /></label>
        <button type="button" className="button" disabled={!quoteId || pending || !data.settings?.enabled} onClick={simular}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Simular</button>
        {ano >= 2027 && <p className="text-xs text-ink/60 sm:col-span-3"><Info className="mr-1 inline h-3.5 w-3.5" />A base oficial ainda não tem alíquotas de {ano}. {aliq ? `Será usada a alíquota informada (fonte: ${aliq.fonte}) e o resultado sai como simulado.` : "Informe as alíquotas do ano na Configuração para simular."}</p>}
      </section>
      {erro && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {res && <Resultado r={res} />}
    </div>
  );
}

function Resultado({ r }: { r: Simulacao }) {
  const [aberto, setAberto] = useState<number | null>(null);
  return (
    <section className="card space-y-4 p-5" aria-label="Resultado da simulação">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Resultado {r.simulado && <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">simulado</span>}</h2>
        <span className="text-xs text-ink/55">Motor oficial {r.versao}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Base de cálculo", r.totais.total_base], ["CBS", r.totais.total_cbs], ["IBS", r.totais.total_ibs], ["Imposto Seletivo", r.totais.total_is]].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border border-sand p-3"><p className="text-xs font-semibold text-ink/50">{l}</p><p className="text-xl font-semibold tabular-nums">{money(Number(v))}</p></div>
        ))}
      </div>
      {r.status !== "calculado" && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Alguns itens não foram calculados (veja abaixo). Os totais somam só os calculados.</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-ink/50"><th className="py-2">Item</th><th>Situação</th><th className="text-right">Base</th><th className="text-right">CBS</th><th className="text-right">IBS</th><th /></tr></thead>
        <tbody>{r.itens.map((i) => <FragmentoItem key={i.numero} i={i} aberto={aberto === i.numero} onToggle={() => setAberto(aberto === i.numero ? null : i.numero)} />)}</tbody>
      </table></div>
      <p className="text-xs text-ink/50">Gravado no histórico. Valores de simulação: não substituem nota fiscal autorizada nem a apuração do contador.</p>
    </section>
  );
}

function FragmentoItem({ i, aberto, onToggle }: { i: Simulacao["itens"][number]; aberto: boolean; onToggle: () => void }) {
  const [rotulo, cor] = ESTADO[i.estado] ?? [i.estado, "bg-cream"];
  return (<>
    <tr className="border-b align-top">
      <td className="py-2 pr-2 font-semibold">{i.produto}</td>
      <td className="py-2 pr-2"><span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", cor)}>{rotulo}</span></td>
      <td className="py-2 text-right tabular-nums">{i.base != null ? money(i.base) : "—"}</td>
      <td className="py-2 text-right tabular-nums">{i.cbs != null ? money(i.cbs) : "—"}</td>
      <td className="py-2 text-right tabular-nums">{i.ibs != null ? money(i.ibs) : "—"}</td>
      <td className="py-2 text-right"><button type="button" className="text-xs font-semibold text-forest underline" onClick={onToggle}>{aberto ? "Fechar" : "Detalhes"}</button></td>
    </tr>
    {aberto && <tr className="border-b bg-cream/40"><td colSpan={6} className="p-3 text-xs">
      {i.memoria && <p className="whitespace-pre-wrap"><b>Memória de cálculo:</b> {i.memoria}</p>}
      {i.erros.map((e, k) => <p key={k} className="text-red-700"><b>{e.codigo}</b> {e.titulo}{e.detalhe ? ` — ${e.detalhe}` : ""}</p>)}
      {i.estado === "SEM_CLASSIFICACAO" && <Link href="/fiscal?aba=classificacoes" className="font-semibold text-forest underline">Classificar este produto</Link>}
    </td></tr>}
  </>);
}

function Classificacoes({ data }: { data: FiscalData }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const linhas = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    const todas = [...data.classificacoes.map((c) => ({ ...c, nova: false })), ...data.produtosSemClassificacao.map((p) => ({ id: "", produto: p, produto_chave: p.toLowerCase(), natureza: "mercadoria" as const, ncm: null, nbs: null, cst: null, cclasstrib: null, unidade: null, observacao: null, status: "rascunho" as const, aprovado_em: null, aprovador: null, nova: true }))];
    return f ? todas.filter((l) => l.produto.toLowerCase().includes(f)) : todas;
  }, [data, filtro]);
  const aprovadas = data.classificacoes.filter((c) => c.status === "aprovada").length;
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) => start(async () => { const r = await fn(); setMsg(r.ok ? ok : r.error); if (r.ok) router.refresh(); });
  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="text-lg font-semibold">Classificação fiscal dos produtos</h2>
          <p className="text-sm text-ink/60">{aprovadas} aprovada(s) · {data.classificacoes.length - aprovadas} em rascunho · {data.produtosSemClassificacao.length} sem classificação. Os códigos vêm do contador; só o financeiro, a gerência ou o administrador aprovam. Item sem classificação aprovada não é calculado.</p></div>
        <input className="field w-60" placeholder="Filtrar produto" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar produto" />
      </div>
      {msg && <p role="status" className="rounded-lg bg-cream p-2 text-sm">{msg}</p>}
      <div className="space-y-2">{linhas.slice(0, 200).map((l) => (
        <form key={l.produto_chave} className="grid items-end gap-2 rounded-xl border border-sand p-3 text-sm sm:grid-cols-[minmax(160px,1.5fr)_120px_120px_80px_100px_70px_auto]"
          onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); run(() => salvarClassificacao({ ...f, produto: l.produto }), "Classificação salva (rascunho)."); }}>
          <div><p className="font-semibold">{l.produto}</p>
            <p className="text-xs">{l.status === "aprovada" ? <span className="text-emerald-700"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Aprovada{l.aprovador ? ` por ${l.aprovador.full_name}` : ""}{l.aprovado_em ? ` em ${shortDate(l.aprovado_em)}` : ""}</span> : l.nova ? <span className="text-ink/50">Sem classificação</span> : <span className="text-amber-700">Rascunho</span>}</p></div>
          <label><span className="label">Natureza</span><select name="natureza" defaultValue={l.natureza} className="field w-full" disabled={!data.podeEditar}><option value="mercadoria">Mercadoria</option><option value="servico">Serviço</option></select></label>
          <label><span className="label">NCM / NBS</span><input name={l.natureza === "servico" ? "nbs" : "ncm"} defaultValue={l.ncm ?? l.nbs ?? ""} inputMode="numeric" className="field w-full" disabled={!data.podeEditar} /></label>
          <label><span className="label">CST</span><input name="cst" defaultValue={l.cst ?? ""} inputMode="numeric" maxLength={3} className="field w-full" disabled={!data.podeEditar} /></label>
          <label><span className="label">cClassTrib</span><input name="cclasstrib" defaultValue={l.cclasstrib ?? ""} inputMode="numeric" maxLength={6} className="field w-full" disabled={!data.podeEditar} /></label>
          <label><span className="label">Unid.</span><input name="unidade" defaultValue={l.unidade ?? ""} maxLength={6} className="field w-full" disabled={!data.podeEditar} /></label>
          <div className="flex gap-1">
            {data.podeEditar && <button className="button-ghost" disabled={pending}>Salvar</button>}
            {data.podeAprovar && l.id && l.status !== "aprovada" && <button type="button" className="button" disabled={pending} onClick={() => run(() => aprovarClassificacao(l.id), "Classificação aprovada.")}>Aprovar</button>}
            {data.podeAprovar && l.id && l.status === "aprovada" && <button type="button" className="button-ghost" disabled={pending} onClick={() => run(() => aprovarClassificacao(l.id, false), "Aprovação retirada.")}>Desaprovar</button>}
          </div>
        </form>
      ))}</div>
      {linhas.length > 200 && <p className="text-xs text-ink/50">Mostrando 200 de {linhas.length}. Use o filtro.</p>}
      <p className="text-xs text-ink/50">Ao trocar a natureza, salve e volte a informar o código (NCM para mercadoria, NBS para serviço). Mudar qualquer código tira a aprovação.</p>
    </section>
  );
}

function Historico({ data }: { data: FiscalData }) {
  const meses = useMemo(() => {
    const m = new Map<string, { n: number; base: number; cbs: number; ibs: number; is: number }>();
    for (const c of data.calculos) {
      const k = c.created_at.slice(0, 7);
      const a = m.get(k) ?? { n: 0, base: 0, cbs: 0, ibs: 0, is: 0 };
      a.n++; a.base += Number(c.total_base); a.cbs += Number(c.total_cbs); a.ibs += Number(c.total_ibs); a.is += Number(c.total_is);
      m.set(k, a);
    }
    return [...m].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data.calculos]);
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Simulações por mês</h2>
          <a href="/api/fiscal/exportar" className="button-ghost"><Download className="h-4 w-4" />Exportar CSV (contador)</a></div>
        <p className="text-sm text-ink/60">Soma das simulações feitas (pode haver mais de uma por orçamento). São valores simulados: não são tributo devido nem pago.</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-ink/50"><th className="py-2">Mês</th><th className="text-right">Simulações</th><th className="text-right">Base</th><th className="text-right">CBS</th><th className="text-right">IBS</th><th className="text-right">IS</th></tr></thead>
          <tbody>{meses.map(([k, v]) => <tr key={k} className="border-b"><td className="py-2">{k.slice(5)}/{k.slice(0, 4)}</td><td className="text-right">{v.n}</td><td className="text-right tabular-nums">{money(v.base)}</td><td className="text-right tabular-nums">{money(v.cbs)}</td><td className="text-right tabular-nums">{money(v.ibs)}</td><td className="text-right tabular-nums">{money(v.is)}</td></tr>)}
            {!meses.length && <tr><td colSpan={6} className="py-4 text-center text-ink/50">Nenhuma simulação ainda.</td></tr>}</tbody></table></div>
      </section>
      <section className="card p-5">
        <h2 className="text-lg font-semibold">Últimas simulações</h2>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-ink/50"><th className="py-2">Quando</th><th>Documento</th><th>Data da operação</th><th>Situação</th><th className="text-right">CBS</th><th className="text-right">IBS</th><th>Motor</th><th>Quem</th></tr></thead>
          <tbody>{data.calculos.slice(0, 50).map((c) => <tr key={c.id} className="border-b"><td className="py-2">{shortDate(c.created_at)}</td><td>{c.quote?.quote_number ?? (c.origem === "avulso" ? "Avulso" : "—")}</td><td>{shortDate(c.data_fato_gerador)}</td>
            <td>{c.status === "calculado" ? "Calculado" : c.status === "parcial" ? "Parcial" : "Sem cálculo"}{c.simulado ? " · simulado" : ""}</td>
            <td className="text-right tabular-nums">{money(Number(c.total_cbs))}</td><td className="text-right tabular-nums">{money(Number(c.total_ibs))}</td><td className="text-xs text-ink/55">{c.versao_app ?? "—"}{c.versao_db ? ` · ${c.versao_db}` : ""}</td><td className="text-xs">{c.autor?.full_name ?? "—"}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

function Configuracao({ data }: { data: FiscalData }) {
  const router = useRouter();
  const s = data.settings;
  const [enabled, setEnabled] = useState(s?.enabled ?? false);
  const [regime, setRegime] = useState(s?.regime ?? "simples");
  const [uf, setUf] = useState(s?.uf ?? "SC");
  const [mun, setMun] = useState(String(s?.municipio_ibge ?? ""));
  const [aliqs, setAliqs] = useState<Record<string, Aliq>>(s?.aliquotas_informadas ?? {});
  const [novoAno, setNovoAno] = useState("2027");
  const [msg, setMsg] = useState<string | null>(null);
  const [motor, setMotor] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const num = (v: string) => Number(v.replace(",", "."));
  const salvar = () => start(async () => {
    const r = await salvarConfiguracaoFiscal({ enabled, regime, uf: uf.toUpperCase(), municipio_ibge: Number(mun), aliquotas_informadas: aliqs });
    setMsg(r.ok ? "Configuração salva." : r.error); if (r.ok) router.refresh();
  });
  const testar = () => start(async () => { const r = await statusMotor(); setMotor(r.ok ? `Respondendo: versão ${r.versao}, base ${r.base}${r.data ? ` de ${shortDate(r.data)}` : ""} (${r.url})` : r.error); });
  const dis = !data.podeEditar;
  return (
    <section className="card max-w-3xl space-y-4 p-5">
      <h2 className="text-lg font-semibold">Configuração fiscal</h2>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={enabled} disabled={dis} onChange={(e) => setEnabled(e.target.checked)} />Calculadora ligada</label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className="label">Regime</span><select className="field w-full" value={regime} disabled={dis} onChange={(e) => setRegime(e.target.value as typeof regime)}>
          <option value="simples">Simples Nacional</option><option value="hibrido">Simples com IBS/CBS no regime regular (híbrido)</option><option value="regular">Regime regular</option></select></label>
        <label><span className="label">UF</span><input className="field w-full" maxLength={2} value={uf} disabled={dis} onChange={(e) => setUf(e.target.value.toUpperCase())} /></label>
        <label><span className="label">Município (código IBGE)</span><input className="field w-full" inputMode="numeric" maxLength={7} value={mun} disabled={dis} onChange={(e) => setMun(e.target.value.replace(/\D/g, ""))} placeholder="Jaraguá do Sul = 4208906" /></label>
      </div>
      {regime === "simples" && <p className="rounded-lg bg-cream p-2 text-xs text-ink/70">No Simples Nacional puro, a CBS e o IBS vão no DAS e a alíquota efetiva vem do PGDAS-D. O motor do Simples ainda não está disponível para uso; esta calculadora usa o motor do regime regular, então trate o resultado como referência do regime híbrido (2027) e confirme com o contador.</p>}
      <div className="space-y-2">
        <p className="text-sm font-semibold">Alíquotas informadas (só para anos sem alíquota na base oficial, ex.: 2027)</p>
        <p className="text-xs text-ink/60">A base oficial tem as alíquotas de 2026 (teste). Para 2027 em diante, ainda não. Informe só com fonte (ex.: "estimativa do contador em 20/11/2026"); o resultado sai marcado como simulado.</p>
        {Object.entries(aliqs).sort().map(([ano, a]) => (
          <div key={ano} className="grid items-end gap-2 rounded-lg border border-sand p-2 text-sm sm:grid-cols-[60px_90px_90px_90px_1fr_auto]">
            <b>{ano}</b>
            <label><span className="label">CBS %</span><input className="field w-full" inputMode="decimal" defaultValue={a.cbs} disabled={dis} onBlur={(e) => setAliqs({ ...aliqs, [ano]: { ...a, cbs: num(e.target.value) } })} /></label>
            <label><span className="label">IBS UF %</span><input className="field w-full" inputMode="decimal" defaultValue={a.ibsEstadual} disabled={dis} onBlur={(e) => setAliqs({ ...aliqs, [ano]: { ...a, ibsEstadual: num(e.target.value) } })} /></label>
            <label><span className="label">IBS mun. %</span><input className="field w-full" inputMode="decimal" defaultValue={a.ibsMunicipal} disabled={dis} onBlur={(e) => setAliqs({ ...aliqs, [ano]: { ...a, ibsMunicipal: num(e.target.value) } })} /></label>
            <label><span className="label">Fonte</span><input className="field w-full" defaultValue={a.fonte} disabled={dis} onBlur={(e) => setAliqs({ ...aliqs, [ano]: { ...a, fonte: e.target.value } })} /></label>
            {!dis && <button type="button" className="button-ghost text-red-700" onClick={() => { const n = { ...aliqs }; delete n[ano]; setAliqs(n); }}>Remover</button>}
          </div>
        ))}
        {!dis && <div className="flex items-end gap-2"><label><span className="label">Ano</span><input className="field w-24" inputMode="numeric" maxLength={4} value={novoAno} onChange={(e) => setNovoAno(e.target.value.replace(/\D/g, ""))} /></label>
          <button type="button" className="button-ghost" disabled={!/^20\d{2}$/.test(novoAno) || !!aliqs[novoAno]} onClick={() => setAliqs({ ...aliqs, [novoAno]: { cbs: 0, ibsEstadual: 0, ibsMunicipal: 0, fonte: "" } })}>Adicionar ano</button></div>}
      </div>
      <div className="flex flex-wrap gap-2">
        {!dis && <button type="button" className="button" disabled={pending} onClick={salvar}>Salvar configuração</button>}
        <button type="button" className="button-ghost" disabled={pending} onClick={testar}>Testar motor oficial</button>
      </div>
      {msg && <p role="status" className="rounded-lg bg-cream p-2 text-sm">{msg}</p>}
      {motor && <p role="status" className="rounded-lg bg-cream p-2 text-xs">{motor}</p>}
      {dis && <p className="text-xs text-ink/50">Só o financeiro, a gerência ou o administrador alteram a configuração.</p>}
    </section>
  );
}
