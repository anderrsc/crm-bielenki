import Link from "next/link";
import { AlertCircle, AlertTriangle, ArrowUpRight, BadgeCheck, CalendarClock, CircleDollarSign, ClipboardList, FileText, ShoppingCart, TrendingUp, WalletCards } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";

async function loadDashboard() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const db = await createClient();
  const { data, error } = await db.rpc("dashboard_summary");
  if (error) return { error: error.message };
  const { data: actions } = await db.from("v_order_overview").select("*").neq("operational_status", "finalizado").order("next_action_date", { ascending: true }).limit(6);
  return { ...data, actions };
}

export default async function Dashboard() {
  const data = await loadDashboard();
  const cards = [
    ["Vendas do mês", money(data?.month_sales), TrendingUp, "text-emerald-700 bg-emerald-50"],
    ["A receber", money(data?.receivable), WalletCards, "text-blue-700 bg-blue-50"],
    ["A pagar", money(data?.payable), CircleDollarSign, "text-orange-700 bg-orange-50"],
    ["Saldo previsto", money((data?.receivable ?? 0) - (data?.payable ?? 0)), ArrowUpRight, "text-violet-700 bg-violet-50"],
  ] as const;
  const overdueBadges = [
    data?.overdue_receivable > 0 && { label: `${data.overdue_receivable} recebimento(s) vencido(s)`, href: "/financeiro/receber", color: "bg-red-50 border-red-200 text-red-800", icon: AlertCircle },
    data?.overdue_payable > 0 && { label: `${data.overdue_payable} pagamento(s) vencido(s)`, href: "/financeiro/pagar", color: "bg-orange-50 border-orange-200 text-orange-800", icon: AlertCircle },
    data?.due_today > 0 && { label: `${data.due_today} vencimento(s) hoje`, href: "/financeiro", color: "bg-amber-50 border-amber-200 text-amber-800", icon: AlertTriangle },
    data?.quotes_pending > 0 && { label: `${data.quotes_pending} orçamento(s) aguardando resposta`, href: "/orcamentos", color: "bg-blue-50 border-blue-200 text-blue-800", icon: FileText },
  ].filter(Boolean) as { label: string; href: string; color: string; icon: typeof AlertCircle }[];
  return <div className="mx-auto max-w-[1500px]">
    <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Pulso da operação</p><h1 className="mt-2 text-3xl font-black tracking-tight lg:text-4xl">Visão geral</h1><p className="mt-2 text-sm text-ink/50">O que exige atenção hoje, do comercial à instalação.</p></div><Link href="/orcamentos/novo" className="button">Novo orçamento <ArrowUpRight className="h-4 w-4" /></Link></div>
    {!process.env.NEXT_PUBLIC_SUPABASE_URL && <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><b>Configuração necessária:</b> preencha o arquivo <code>.env.local</code> e execute a migração do Supabase. Nenhum dado demonstrativo permanente é exibido.</div>}
    {data && "error" in data && <div className="mb-6 rounded-2xl bg-red-50 p-4 text-sm text-red-700">Não foi possível carregar o painel: {data.error}</div>}
    {overdueBadges.length > 0 && <div className="mb-5 flex flex-wrap gap-2">{overdueBadges.map(b => <Link key={b.href} href={b.href} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition hover:opacity-80 ${b.color}`}><b.icon className="h-3.5 w-3.5" />{b.label}</Link>)}</div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, Icon, color]) => <div className="card p-5" key={label}><div className="flex items-center justify-between"><p className="text-sm font-medium text-ink/55">{label}</p><span className={`rounded-xl p-2.5 ${color}`}><Icon className="h-5 w-5" /></span></div><p className="mt-5 text-2xl font-black tracking-tight">{value}</p></div>)}</section>
    <section className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_.8fr]">
      <div className="card overflow-hidden"><div className="flex items-center justify-between border-b p-5"><div><h2 className="font-bold">Próximas ações</h2><p className="text-xs text-ink/45">Pedidos ativos ordenados por prazo</p></div><Link href="/pedidos" className="text-sm font-bold text-forest">Ver todos</Link></div><div className="divide-y">{data?.actions?.length ? data.actions.map((x: Record<string, string>) => <Link href={`/pedidos/${x.id}`} key={x.id} className="grid gap-2 p-4 transition hover:bg-cream/50 sm:grid-cols-[1fr_1.5fr_auto] sm:items-center"><div><p className="text-xs text-ink/40">{x.order_number}</p><p className="font-bold">{x.client_name}</p></div><div><p className="text-xs text-ink/40">Próxima ação</p><p className="text-sm">{x.next_action || "Definir próxima ação"}</p></div><span className="text-xs font-semibold text-ink/55">{shortDate(x.next_action_date)}</span></Link>) : <Empty text="Nenhum pedido ativo encontrado." />}</div></div>
      <div className="space-y-5"><div className="card p-5"><h2 className="font-bold">Pontos de atenção</h2><div className="mt-4 space-y-3"><Attention icon={AlertTriangle} label="Pedidos travados" value={data?.blocked_orders ?? 0} href="/pedidos?filtro=bloqueado" color="text-red-600 bg-red-50" /><Attention icon={ShoppingCart} label="Compras atrasadas" value={data?.late_purchases ?? 0} href="/compras?filtro=atrasado" color="text-orange-600 bg-orange-50" /><Attention icon={ClipboardList} label="Produções aguardando" value={data?.waiting_materials ?? 0} href="/producao/materiais-do-pedido" color="text-amber-600 bg-amber-50" /><Attention icon={CalendarClock} label="Follow-ups atrasados" value={data?.late_followups ?? 0} href="/pipeline?filtro=atrasado" color="text-violet-600 bg-violet-50" /><Attention icon={BadgeCheck} label="Em produção agora" value={data?.in_production ?? 0} href="/producao" color="text-sky-600 bg-sky-50" /></div></div></div>
    </section>
  </div>;
}

function Attention({ icon: Icon, label, value, href, color }: { icon: typeof AlertTriangle; label: string; value: number; href: string; color: string }) { return <Link href={href} className="flex items-center gap-3 rounded-xl border p-3 hover:bg-cream/50"><span className={`rounded-lg p-2 ${color}`}><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1 text-sm font-medium">{label}</span><b>{value}</b></Link> }
function Empty({ text }: { text: string }) { return <div className="p-10 text-center text-sm text-ink/45">{text}</div> }
