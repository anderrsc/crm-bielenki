"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Boxes, Building2, CalendarCheck, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardCheck, Factory, FileText, HandCoins, LayoutDashboard, Menu, PackageSearch, Ruler, Search, Settings, Shield, ShoppingCart, UserCog, Users, WalletCards, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const groups = [
  { title: "Visão geral", items: [["Dashboard", "/dashboard", LayoutDashboard], ["Pipeline", "/pipeline", BarChart3], ["Busca global", "/busca", Search]] },
  { title: "Comercial", items: [["Clientes", "/clientes", Users], ["Orçamentos", "/orcamentos", FileText], ["Central de Preços", "/tabela-calhas", Ruler], ["Vendas", "/vendas", HandCoins], ["Pedidos", "/pedidos", ClipboardCheck]] },
  { title: "Operação", items: [["Compras", "/compras", ShoppingCart], ["Fornecedores", "/fornecedores", Building2], ["Estoque", "/estoque", Boxes], ["Produção", "/producao", Factory], ["Instalações", "/instalacoes", CalendarCheck]] },
  { title: "Financeiro", items: [["Financeiro", "/financeiro", CircleDollarSign], ["A Receber", "/financeiro/receber", WalletCards], ["A Pagar", "/financeiro/pagar", HandCoins]] },
  { title: "Pessoas", items: [["Funcionários", "/configuracoes/funcionarios", UserCog], ["Cargos", "/configuracoes/cargos", Shield]] },
  { title: "Gestão", items: [["Automações", "/automacoes", Bot], ["Agente IA", "/agente-ia", Bot], ["Relatórios", "/relatorios", BarChart3], ["Auditoria", "/auditoria", Shield], ["Configurações", "/configuracoes", Settings]] },
] as const;

export function AppShell({ children, userName, companyName, roles=[] }: { children: React.ReactNode; userName: string; companyName: string; roles?: string[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  return <div className="min-h-screen lg:flex">
    {open && <button aria-label="Fechar menu" className="fixed inset-0 z-30 bg-ink/50 lg:hidden" onClick={() => setOpen(false)} />}
    <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-72 -translate-x-full flex-col bg-ink text-white transition-all lg:sticky lg:translate-x-0", open && "translate-x-0", collapsed && "lg:w-[86px]") }>
      <div className="flex h-20 items-center justify-between border-b border-white/10 px-6"><Link href="/dashboard" className="font-black tracking-tight leading-tight">{collapsed ? <span className="text-lime text-xl">M</span> : <><span className="text-white">MARQUINHOS</span><br/><span className="text-lime text-xs font-bold tracking-widest">CALHAS &amp; ESQUADRIAS</span></>}</Link><button className="lg:hidden" onClick={() => setOpen(false)}><X /></button></div>
      <nav className="flex-1 space-y-6 overflow-y-auto p-4">{groups.map((group) => <div key={group.title}><p className={cn("mb-2 px-3 text-[10px] font-bold uppercase tracking-[.2em] text-white/35", collapsed && "hidden")}>{group.title}</p><div className="space-y-1">{group.items.filter(([,href])=>href!=="/tabela-calhas"||roles.some(role=>["administrador","gerente","vendedor","compras","financeiro"].includes(role))).map(([label, href, Icon]) => { const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`)); return <Link title={label} onClick={() => setOpen(false)} href={href} key={href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/65 transition hover:bg-white/10 hover:text-white", active && "bg-lime text-ink hover:bg-lime hover:text-ink", collapsed && "justify-center")}><Icon className="h-[18px] w-[18px] shrink-0" />{!collapsed && label}</Link>})}</div></div>)}</nav>
      <button onClick={() => setCollapsed(!collapsed)} className="hidden border-t border-white/10 p-4 text-white/50 hover:text-white lg:block">{collapsed ? <ChevronRight className="mx-auto" /> : <ChevronLeft className="mx-auto" />}</button>
    </aside>
    <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b bg-cream/90 px-5 backdrop-blur-xl lg:px-8"><div className="flex items-center gap-3"><button className="lg:hidden" onClick={() => setOpen(true)}><Menu /></button><div><p className="text-xs text-ink/45">{companyName}</p><p className="text-sm font-bold">Olá, {userName}</p></div></div><form action="/busca" className="relative hidden w-full max-w-md sm:block"><Search className="absolute left-3 top-3 h-4 w-4 text-ink/35"/><input name="q" className="field h-10 bg-white/80 pl-9" placeholder="Buscar cliente, pedido, compra..."/></form><Link href="/busca" aria-label="Busca global" className="button-ghost h-10 px-3 sm:hidden"><Search className="h-4 w-4"/></Link></header>
      <main className="p-5 lg:p-8">{children}</main>
    </div>
  </div>;
}
