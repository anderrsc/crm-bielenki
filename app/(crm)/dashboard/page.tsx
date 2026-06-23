import Link from "next/link";
import {
  AlertCircle, AlertTriangle, ArrowUpRight, BadgeCheck, BarChart3, Bell,
  CalendarClock, CircleDollarSign, ClipboardList, FileText, ShoppingCart,
  TrendingUp, Users, WalletCards,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";

async function loadDashboard() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const db = await createClient();
  const [summaryRes, execRes, actionsRes, alertsRes] = await Promise.all([
    db.rpc("dashboard_summary"),
    db.rpc("dashboard_executivo"),
    db.from("v_order_overview").select("*").neq("operational_status","finalizado").order("next_action_date",{ascending:true}).limit(6),
    db.from("operational_alerts").select("*").eq("resolved",false).order("created_at",{ascending:false}).limit(5),
  ]);
  return {
    ...(summaryRes.data as Record<string,unknown> ?? {}),
    ...(execRes.data  as Record<string,unknown> ?? {}),
    actions: actionsRes.data,
    alerts:  alertsRes.data,
  };
}

const ALERTA_ICON: Record<string,string>  = { lead_sem_resposta:"⚠️", parcela_vencida:"💰", producao_atrasada:"🏭", instalacao_atrasada:"🔧" };
const ALERTA_COR:  Record<string,string>  = { critical:"bg-red-100 text-red-700", high:"bg-red-100 text-red-700", medium:"bg-amber-100 text-amber-700", low:"bg-slate-100 text-slate-600" };
const ALERTA_LABEL:Record<string,string>  = { critical:"CRÍTICO", high:"ALTO", medium:"MÉDIO", low:"BAIXO" };

export default async function Dashboard({ searchParams }: { searchParams?: Promise<{ aba?: string }> }) {
  const sp   = searchParams ? await searchParams : {};
  const aba  = sp.aba ?? "geral";
  const data = await loadDashboard();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d    = data as any;

  const vendas   = d?.vendas_mes        ?? d?.month_sales  ?? 0;
  const receitas = d?.receitas_abertas  ?? d?.receivable   ?? 0;
  const despesas = d?.despesas_abertas  ?? d?.payable      ?? 0;
  const saldo    = receitas - despesas;

  const overdueBadges = [
    (d?.overdue_receivable ?? 0) > 0 && { label:`${money(d.overdue_receivable)} a receber vencido(s)`, href:"/financeiro/receber", color:"bg-red-50 border-red-200 text-red-800", icon:AlertCircle },
    (d?.overdue_payable    ?? 0) > 0 && { label:`${money(d.overdue_payable)} a pagar vencido(s)`,      href:"/financeiro/pagar",  color:"bg-orange-50 border-orange-200 text-orange-800", icon:AlertCircle },
    (d?.due_today          ?? 0) > 0 && { label:`${d.due_today} vencimento(s) hoje`,                   href:"/financeiro",        color:"bg-amber-50 border-amber-200 text-amber-800", icon:AlertTriangle },
    (d?.orcamentos_pendentes ?? d?.quotes_pending ?? 0) > 0 && { label:`${d?.orcamentos_pendentes ?? d?.quotes_pending} orçamento(s) pendente(s)`, href:"/orcamentos", color:"bg-blue-50 border-blue-200 text-blue-800", icon:FileText },
  ].filter(Boolean) as { label:string; href:string; color:string; icon:typeof AlertCircle }[];

  const ABAS = [
    { key:"geral",      label:"Visão Geral" },
    { key:"comercial",  label:"Comercial" },
    { key:"producao",   label:"Produção" },
    { key:"financeiro", label:"Financeiro" },
  ];

  return (
    <div className="mx-auto max-w-[1500px]">
      {/* Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Pulso da operação</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight lg:text-4xl">Dashboard</h1>
          <p className="mt-1 text-sm text-ink/50">Visão completa — do comercial à instalação.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/pendencias" className="button-ghost flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Pendências
          </Link>
          <Link href="/orcamentos/novo" className="button flex items-center gap-2">
            Novo orçamento <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {!process.env.NEXT_PUBLIC_SUPABASE_URL && <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><b>Configuração necessária:</b> preencha o arquivo <code>.env.local</code> e execute as migrações.</div>}
      {data && "error" in data && <div className="mb-6 rounded-2xl bg-red-50 p-4 text-sm text-red-700">Não foi possível carregar o painel: {(data as Record<string,string>).error}</div>}

      {overdueBadges.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {overdueBadges.map(b => (
            <Link key={b.href} href={b.href} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition hover:opacity-80 ${b.color}`}>
              <b.icon className="h-3.5 w-3.5" />{b.label}
            </Link>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {ABAS.map(a => (
          <Link key={a.key} href={`/dashboard?aba=${a.key}`}
            className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-semibold transition
              ${aba === a.key ? "bg-forest text-white border-forest" : "bg-white border-sand hover:bg-cream"}`}>
            {a.label}
          </Link>
        ))}
      </div>

      {/* ── ABA GERAL ─────────────────────────────────────────── */}
      {aba === "geral" && <>
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {([
            ["Vendas do mês",  money(vendas),   TrendingUp,       "text-emerald-700 bg-emerald-50"],
            ["A receber",      money(receitas), WalletCards,      "text-blue-700 bg-blue-50"],
            ["A pagar",        money(despesas), CircleDollarSign, "text-orange-700 bg-orange-50"],
            ["Saldo previsto", money(saldo),    ArrowUpRight,     saldo >= 0 ? "text-violet-700 bg-violet-50" : "text-red-700 bg-red-50"],
          ] as const).map(([label, value, Icon, color]) => (
            <div className="card p-5" key={label}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink/55">{label}</p>
                <span className={`rounded-xl p-2.5 ${color}`}><Icon className="h-5 w-5" /></span>
              </div>
              <p className="mt-5 text-2xl font-black tracking-tight">{value}</p>
            </div>
          ))}
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_.8fr]">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b p-5">
              <div><h2 className="font-bold">Próximas ações</h2><p className="text-xs text-ink/45">Pedidos ativos por prazo</p></div>
              <Link href="/pedidos" className="text-sm font-bold text-forest">Ver todos</Link>
            </div>
            <div className="divide-y">
              {d?.actions?.length ? d.actions.map((x: Record<string,string>) => (
                <Link href={`/pedidos/${x.id}`} key={x.id} className="grid gap-2 p-4 transition hover:bg-cream/50 sm:grid-cols-[1fr_1.5fr_auto] sm:items-center">
                  <div><p className="text-xs text-ink/40">{x.order_number}</p><p className="font-bold">{x.client_name}</p></div>
                  <div><p className="text-xs text-ink/40">Próxima ação</p><p className="text-sm">{x.next_action || "Definir próxima ação"}</p></div>
                  <span className="text-xs font-semibold text-ink/55">{shortDate(x.next_action_date)}</span>
                </Link>
              )) : <div className="p-10 text-center text-sm text-ink/45">Nenhum pedido ativo.</div>}
            </div>
          </div>

          <div className="space-y-5">
            <div className="card p-5">
              <h2 className="mb-4 font-bold">Pontos de atenção</h2>
              <div className="space-y-3">
                <Attn icon={AlertTriangle} label="Pedidos travados"   value={d?.blocked_orders ?? 0}     href="/pedidos"   color="text-red-600 bg-red-50" />
                <Attn icon={ShoppingCart}  label="Compras atrasadas"  value={d?.compras_pendentes ?? d?.late_purchases ?? 0}  href="/compras"  color="text-orange-600 bg-orange-50" />
                <Attn icon={ClipboardList} label="Em produção"        value={d?.em_producao ?? d?.in_production ?? 0}          href="/producao" color="text-amber-600 bg-amber-50" />
                <Attn icon={CalendarClock} label="Follow-ups hoje"    value={d?.followups_hoje ?? d?.late_followups ?? 0}      href="/pipeline" color="text-violet-600 bg-violet-50" />
                <Attn icon={BadgeCheck}    label="Instalações hoje"   value={d?.instalacoes_hoje ?? 0}   href="/instalacoes" color="text-sky-600 bg-sky-50" />
              </div>
            </div>

            {d?.alerts?.length > 0 && (
              <div className="card overflow-hidden">
                <div className="flex items-center gap-2 border-b p-4">
                  <Bell className="h-4 w-4 text-red-600" />
                  <h2 className="text-sm font-bold">Alertas ativos</h2>
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">{d.alertas_ativos ?? d.alerts.length}</span>
                </div>
                <div className="divide-y">
                  {d.alerts.map((a: Record<string,string>) => (
                    <div key={a.id} className={`flex items-start gap-3 p-3 ${a.severity === "high" || a.severity === "critical" ? "bg-red-50/40" : ""}`}>
                      <span className="mt-0.5 text-sm">{ALERTA_ICON[a.type] ?? "📋"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">{a.title}</p>
                        {a.description && <p className="text-xs text-ink/50">{a.description}</p>}
                      </div>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${ALERTA_COR[a.severity] ?? ALERTA_COR.medium}`}>{ALERTA_LABEL[a.severity] ?? "MÉDIO"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </>}

      {/* ── ABA COMERCIAL ─────────────────────────────────────── */}
      {aba === "comercial" && <>
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Leads do mês"      value={String(d?.leads_mes ?? 0)}         sub={`Mês anterior: ${d?.leads_mes_ant ?? 0}`}        icon={Users}      color="text-violet-700 bg-violet-50" />
          <KpiCard label="Vendas fechadas"   value={String(d?.qtd_vendas_mes ?? 0)}    sub={money(d?.vendas_mes ?? 0)}                         icon={TrendingUp} color="text-emerald-700 bg-emerald-50" />
          <KpiCard label="Ticket médio"      value={money(d?.ticket_medio ?? 0)}       sub="Média das vendas do mês"                           icon={BarChart3}  color="text-blue-700 bg-blue-50" />
          <KpiCard label="Taxa de conversão" value={`${d?.taxa_conversao ?? 0}%`}      sub="Leads → Vendas"                                    icon={ArrowUpRight} color="text-amber-700 bg-amber-50" />
        </section>
        <section className="mt-5 grid gap-5 xl:grid-cols-2">
          <div className="card overflow-hidden">
            <div className="border-b p-5"><h2 className="font-bold">Top vendedores do mês</h2></div>
            <div className="divide-y">
              {(d?.top_vendedores as { nome:string; qtd_vendas:number; total_vendido:number }[] | null)?.length
                ? (d.top_vendedores as { nome:string; qtd_vendas:number; total_vendido:number }[]).map((v, i) => (
                  <div key={v.nome} className="flex items-center gap-4 p-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-forest/10 text-sm font-black text-forest">{i+1}</span>
                    <div className="flex-1"><p className="font-bold">{v.nome}</p><p className="text-xs text-ink/45">{v.qtd_vendas} venda{v.qtd_vendas !== 1 ? "s" : ""}</p></div>
                    <p className="font-black text-emerald-700">{money(v.total_vendido)}</p>
                  </div>
                ))
                : <div className="p-10 text-center text-sm text-ink/45">Nenhuma venda neste mês.</div>}
            </div>
          </div>
          <div className="card p-5">
            <h2 className="mb-4 font-bold">Funil comercial</h2>
            <div className="space-y-3">
              <FunnelRow label="Leads gerados"      value={d?.leads_mes ?? 0}            total={d?.leads_mes ?? 1} color="bg-violet-500" />
              <FunnelRow label="Orçamentos enviados" value={d?.orcamentos_mes ?? 0}       total={d?.leads_mes ?? 1} color="bg-blue-500" />
              <FunnelRow label="Vendas fechadas"    value={d?.qtd_vendas_mes ?? 0}        total={d?.leads_mes ?? 1} color="bg-emerald-500" />
            </div>
            <div className="mt-5 flex gap-3">
              <Link href="/pipeline" className="button-ghost flex-1 text-center text-sm">Ver pipeline</Link>
              <Link href="/orcamentos" className="button-ghost flex-1 text-center text-sm">Ver orçamentos</Link>
            </div>
          </div>
        </section>
      </>}

      {/* ── ABA PRODUÇÃO ──────────────────────────────────────── */}
      {aba === "producao" && <>
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Em produção"       value={String(d?.em_producao ?? 0)}         sub="Pedidos ativos"          icon={ClipboardList} color="text-amber-700 bg-amber-50" />
          <KpiCard label="Compras pendentes" value={String(d?.compras_pendentes ?? 0)}   sub="Aguardando recebimento"  icon={ShoppingCart}  color="text-orange-700 bg-orange-50" />
          <KpiCard label="Instalações hoje"  value={String(d?.instalacoes_hoje ?? 0)}    sub="Agendadas para hoje"     icon={CalendarClock} color="text-sky-700 bg-sky-50" />
          <KpiCard label="Pedidos travados"  value={String(d?.blocked_orders ?? 0)}      sub="Bloqueados por materiais" icon={AlertTriangle}  color="text-red-700 bg-red-50" />
        </section>
        <section className="mt-5 grid gap-4 sm:grid-cols-3">
          <Link href="/producao" className="card flex flex-col items-center gap-3 p-6 text-center hover:shadow-md transition hover:-translate-y-px">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50"><ClipboardList className="h-6 w-6 text-amber-700" /></span>
            <div><p className="font-bold">Fluxo de Produção</p><p className="text-xs text-ink/45">Gerenciar etapas</p></div>
          </Link>
          <Link href="/producao/materiais-do-pedido" className="card flex flex-col items-center gap-3 p-6 text-center hover:shadow-md transition hover:-translate-y-px">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50"><ShoppingCart className="h-6 w-6 text-orange-700" /></span>
            <div><p className="font-bold">Materiais do Pedido</p><p className="text-xs text-ink/45">Receber materiais</p></div>
          </Link>
          <Link href="/instalacoes" className="card flex flex-col items-center gap-3 p-6 text-center hover:shadow-md transition hover:-translate-y-px">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50"><BadgeCheck className="h-6 w-6 text-sky-700" /></span>
            <div><p className="font-bold">Instalações</p><p className="text-xs text-ink/45">Checklists e status</p></div>
          </Link>
        </section>
      </>}

      {/* ── ABA FINANCEIRO ────────────────────────────────────── */}
      {aba === "financeiro" && <>
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Recebido no mês"  value={money(d?.receitas_mes ?? 0)}    sub="Pagamentos do mês"    icon={TrendingUp}      color="text-emerald-700 bg-emerald-50" />
          <KpiCard label="Pago no mês"      value={money(d?.despesas_mes ?? 0)}    sub="Saídas do mês"        icon={CircleDollarSign} color="text-orange-700 bg-orange-50" />
          <KpiCard label="A receber"        value={money(d?.receitas_abertas ?? 0)} sub="Saldo em aberto"     icon={WalletCards}     color="text-blue-700 bg-blue-50" />
          <KpiCard label="A pagar"          value={money(d?.despesas_abertas ?? 0)} sub="Saldo em aberto"     icon={AlertCircle}     color="text-red-700 bg-red-50" />
        </section>
        <section className="mt-5 grid gap-4 sm:grid-cols-3">
          <Link href="/financeiro" className="card flex flex-col items-center gap-3 p-6 text-center hover:shadow-md transition hover:-translate-y-px">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50"><WalletCards className="h-6 w-6 text-emerald-700" /></span>
            <div><p className="font-bold">Financeiro</p><p className="text-xs text-ink/45">Visão geral</p></div>
          </Link>
          <Link href="/financeiro/receber" className="card flex flex-col items-center gap-3 p-6 text-center hover:shadow-md transition hover:-translate-y-px">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50"><TrendingUp className="h-6 w-6 text-blue-700" /></span>
            <div><p className="font-bold">A Receber</p><p className="text-xs text-ink/45">Contas a receber</p></div>
          </Link>
          <Link href="/financeiro/pagar" className="card flex flex-col items-center gap-3 p-6 text-center hover:shadow-md transition hover:-translate-y-px">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50"><CircleDollarSign className="h-6 w-6 text-orange-700" /></span>
            <div><p className="font-bold">A Pagar</p><p className="text-xs text-ink/45">Contas a pagar</p></div>
          </Link>
        </section>
        {(d?.overdue_receivable > 0 || d?.overdue_payable > 0) && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {d.overdue_receivable > 0 && <div className="card border-red-200 bg-red-50 p-5"><p className="text-xs font-bold uppercase tracking-wider text-red-600">Recebimentos vencidos</p><p className="mt-2 text-2xl font-black text-red-700">{money(d.overdue_receivable)}</p><Link href="/financeiro/receber" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-red-600">Ver detalhes <ArrowUpRight className="h-3 w-3" /></Link></div>}
            {d.overdue_payable > 0 && <div className="card border-orange-200 bg-orange-50 p-5"><p className="text-xs font-bold uppercase tracking-wider text-orange-600">Pagamentos vencidos</p><p className="mt-2 text-2xl font-black text-orange-700">{money(d.overdue_payable)}</p><Link href="/financeiro/pagar" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-orange-600">Ver detalhes <ArrowUpRight className="h-3 w-3" /></Link></div>}
          </div>
        )}
      </>}
    </div>
  );
}

function Attn({ icon:Icon, label, value, href, color }: { icon:typeof AlertTriangle; label:string; value:number; href:string; color:string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border p-3 hover:bg-cream/50 transition">
      <span className={`rounded-lg p-2 ${color}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
      <b>{value}</b>
    </Link>
  );
}

function KpiCard({ label, value, sub, icon:Icon, color }: { label:string; value:string; sub:string; icon:typeof TrendingUp; color:string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink/55">{label}</p>
        <span className={`rounded-xl p-2.5 ${color}`}><Icon className="h-5 w-5" /></span>
      </div>
      <p className="mt-4 text-2xl font-black tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-ink/40">{sub}</p>
    </div>
  );
}

function FunnelRow({ label, value, total, color }: { label:string; value:number; total:number; color:string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-black">{value} <span className="font-normal text-ink/40">({pct}%)</span></span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink/10">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
