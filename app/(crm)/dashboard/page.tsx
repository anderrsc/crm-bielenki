import Link from "next/link";
import { AlertCircle, AlertTriangle, ArrowUpRight, BadgeCheck, Bell, CalendarClock, CircleDollarSign, ClipboardList, FileText, ShoppingCart, TrendingUp, WalletCards } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";

async function loadDashboard() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const db = await createClient();
  const { data, error } = await db.rpc("dashboard_summary");
  if (error) return { error: error.message };
  const { data: actions } = await db.from("v_order_overview").select("*").neq("operational_status", "finalizado").order("next_action_date", { ascending: true }).limit(6);
  const { data: alerts } = await db.from("operational_alerts").select("*").eq("resolved", false).order("created_at", { ascending: false }).limit(5);
  return { ...data, actions, alerts };
}

const ALERTA_ICON: Record<string, string> = { lead_sem_resposta: "⚠️", parcela_vencida: "💰", producao_atrasada: "🏭", instalacao_atrasada: "🔧" };
const ALERTA_COR: Record<string, string> = { critical: "bg-red-100 text-red-700", high: "bg-red-100 text-red-700", medium: "bg-amber-100 text-amber-700", low: "bg-slate-100 text-slate-600" };
const ALERTA_LABEL: Record<string, string> = { critical: "CRÍTICO", high: "ALTO", medium: "MÉDIO", low: "BAIXO" };

export default async function Dashboard() {
  const data = await loadDashboard();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dd = data as any;
  const vendas   = dd?.vendas_mes   ?? dd?.month_sales  ?? 0;
  const receitas = dd?.receitas_abertas ?? dd?.receivable ?? 0;
  const despesas = dd?.despesas_abertas ?? dd?.payable   ?? 0;
  const saldo    = receitas - despesas;

  const cards = [
    ["Vendas do mês",  money(vendas),   TrendingUp,       "text-emerald-700 bg-emerald-50"],
    ["A receber",      money(receitas), WalletCards,      "text-blue-700 bg-blue-50"],
    ["A pagar",        money(despesas), CircleDollarSign, "text-orange-700 bg-orange-50"],
    ["Saldo previsto", money(saldo),    ArrowUpRight,     saldo >= 0 ? "text-violet-700 bg-violet-50" : "text-red-700 bg-red-50"],
  ] as const;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  const overdueBadges = [
    (d?.overdue_receivable ?? 0) > 0 && { label: `${money(d.overdue_receivable)} recebimento(s) vencido(s)`, href: "/financeiro/receber", color: "bg-red-50 border-red-200 text-red-800", icon: AlertCircle },
    (d?.overdue_payable   ?? 0) > 0 && { label: `${money(d.overdue_payable)} pagamento(s) vencido(s)`,    href: "/financeiro/pagar",  color: "bg-orange-50 border-orange-200 text-orange-800", icon: AlertCircle },
    (d?.due_today         ?? 0) > 0 && { label: `${d.due_today} vencimento(s) hoje`,                       href: "/financeiro",        color: "bg-amber-50 border-amber-200 text-amber-800", icon: AlertTriangle },
    (d?.orcamentos_pendentes ?? d?.quotes_pending ?? 0) > 0 && { label: `${d?.orcamentos_pendentes ?? d?.quotes_pending} orçamento(s) aguardando`, href: "/orcamentos", color: "bg-blue-50 border-blue-200 text-blue-800", icon: FileText },
  ].filter(Boolean) as { label: string; href: string; color: string; icon: typeof AlertCircle }[];

  const da = dd;

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Pulso da operação</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight lg:text-4xl">Visão geral</h1>
          <p className="mt-2 text-sm text-ink/50">O que exige atenção hoje, do comercial à instalação.</p>
        </div>
        <Link href="/orcamentos/novo" className="button">Novo orçamento <ArrowUpRight className="h-4 w-4" /></Link>
      </div>

      {!process.env.NEXT_PUBLIC_SUPABASE_URL && <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><b>Configuração necessária:</b> preencha o arquivo <code>.env.local</code> e execute a migração do Supabase.</div>}
      {data && "error" in data && <div className="mb-6 rounded-2xl bg-red-50 p-4 text-sm text-red-700">Não foi possível carregar o painel: {(data as Record<string,string>).error}</div>}
      {overdueBadges.length > 0 && <div className="mb-5 flex flex-wrap gap-2">{overdueBadges.map(b => <Link key={b.href} href={b.href} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition hover:opacity-80 ${b.color}`}><b.icon className="h-3.5 w-3.5" />{b.label}</Link>)}</div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, Icon, color]) => (
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
            <div><h2 className="font-bold">Próximas ações</h2><p className="text-xs text-ink/45">Pedidos ativos ordenados por prazo</p></div>
            <Link href="/pedidos" className="text-sm font-bold text-forest">Ver todos</Link>
          </div>
          <div className="divide-y">
            {da?.actions?.length ? da.actions.map((x: Record<string,string>) => (
              <Link href={`/pedidos/${x.id}`} key={x.id} className="grid gap-2 p-4 transition hover:bg-cream/50 sm:grid-cols-[1fr_1.5fr_auto] sm:items-center">
                <div><p className="text-xs text-ink/40">{x.order_number}</p><p className="font-bold">{x.client_name}</p></div>
                <div><p className="text-xs text-ink/40">Próxima ação</p><p className="text-sm">{x.next_action || "Definir próxima ação"}</p></div>
                <span className="text-xs font-semibold text-ink/55">{shortDate(x.next_action_date)}</span>
              </Link>
            )) : <Empty text="Nenhum pedido ativo encontrado." />}
          </div>
        </div>

        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="font-bold">Pontos de atenção</h2>
            <div className="mt-4 space-y-3">
              <Attention icon={AlertTriangle} label="Pedidos travados"     value={da?.blocked_orders ?? 0}     href="/pedidos?filtro=bloqueado"  color="text-red-600 bg-red-50" />
              <Attention icon={ShoppingCart}  label="Compras atrasadas"    value={da?.late_purchases ?? 0}     href="/compras?filtro=atrasado"   color="text-orange-600 bg-orange-50" />
              <Attention icon={ClipboardList} label="Produções em aberto"  value={da?.em_producao ?? da?.waiting_materials ?? 0} href="/producao" color="text-amber-600 bg-amber-50" />
              <Attention icon={CalendarClock} label="Follow-ups hoje"      value={da?.followups_hoje ?? da?.late_followups ?? 0} href="/pipeline" color="text-violet-600 bg-violet-50" />
              <Attention icon={BadgeCheck}    label="Em produção agora"    value={da?.em_producao ?? da?.in_production ?? 0}    href="/producao" color="text-sky-600 bg-sky-50" />
            </div>
          </div>

          {da?.alerts?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center gap-2 border-b p-4">
                <Bell className="h-4 w-4 text-red-600" />
                <h2 className="text-sm font-bold">Alertas ativos</h2>
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">{da.alertas_ativos ?? da.alerts.length}</span>
              </div>
              <div className="divide-y">
                {da.alerts.map((a: Record<string,string>) => (
                  <div key={a.id} className={`flex items-start gap-3 p-3 ${a.severity === 'high' || a.severity === 'critical' ? 'bg-red-50/40' : ''}`}>
                    <span className="mt-0.5 text-sm">{ALERTA_ICON[a.type] ?? '📋'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{a.title}</p>
                      {a.description && <p className="text-xs text-ink/50">{a.description}</p>}
                    </div>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${ALERTA_COR[a.severity] ?? ALERTA_COR.medium}`}>{ALERTA_LABEL[a.severity] ?? 'MÉDIO'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Attention({ icon: Icon, label, value, href, color }: { icon: typeof AlertTriangle; label: string; value: number; href: string; color: string }) {
  return <Link href={href} className="flex items-center gap-3 rounded-xl border p-3 hover:bg-cream/50"><span className={`rounded-lg p-2 ${color}`}><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1 text-sm font-medium">{label}</span><b>{value}</b></Link>;
}
function Empty({ text }: { text: string }) { return <div className="p-10 text-center text-sm text-ink/45">{text}</div>; }
