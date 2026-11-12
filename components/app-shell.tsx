"use client";
import { LiveSearchForm } from "./live-search-form";

import { useMobile } from "@/lib/use-mobile";
import { NotificationCenter } from "@/components/notification-center";
import { isManagement, moduleAccess } from "@/lib/module-access";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertCircle,BarChart3,Bell,Bot,Boxes,Building2,CalendarCheck,ChevronLeft,ChevronRight,CircleDollarSign,ClipboardCheck,Factory,FileText,HandCoins,LayoutDashboard,Menu,MessageCircle,Plus,Ruler,Search,Settings,Shield,UserCog,Users,WalletCards,X } from "lucide-react";
import { Suspense,useEffect,useRef,useState } from "react";
import { NavProgress } from "./nav-progress";
import { InputHelpers } from "./input-helpers";
import { LogoutButton } from "./logout-button";
import { AuthorSignature,BrandLogo } from "./brand-logo";
import { ThemeToggle } from "./theme-toggle";
const groups=[
 {title:"Principal",items:[["Dashboard", "/dashboard",LayoutDashboard],["Pendências", "/pendencias",AlertCircle],["Atendimento", "/atendimento",MessageCircle],["Clientes", "/clientes",Users],["Pipeline", "/pipeline",BarChart3],["Orçamentos", "/orcamentos",FileText],["Vendas", "/vendas",HandCoins],["Pedidos", "/pedidos",ClipboardCheck]]},
 {title:"Operação",items:[["Agenda", "/agenda",CalendarCheck],["Medições", "/medicoes",Ruler],["Produção", "/producao",Factory],["Instalações", "/instalacoes",CalendarCheck]]},
 {title:"Gestão",items:[["Produtos & Peças", "/tabela-calhas",Boxes],["Compras", "/compras",HandCoins],["Fornecedores", "/fornecedores",Building2],["Estoque", "/estoque",Boxes],["Financeiro", "/financeiro",CircleDollarSign],["A Receber", "/financeiro/receber",WalletCards],["A Pagar", "/financeiro/pagar",HandCoins],["Relatórios", "/relatorios",BarChart3]]},
 {title:"Equipe",items:[["Funcionários", "/configuracoes/funcionarios",UserCog],["Cargos", "/configuracoes/cargos",Shield]]},
 {title:"Geral",items:[["Automações", "/automacoes",Bot],["Central de IA", "/central-ia",Bot],["Agente IA", "/agente-ia",Bot],["Auditoria", "/auditoria",Shield],["Configurações", "/configuracoes",Settings],["Guia visual", "/design-system",Boxes]]},
] as const;
export function AppShell({children,userName,companyName,roles=[],viewable=[]}:{children:React.ReactNode;userName:string;companyName:string;roles?:string[];viewable?:string[]}){
 const pathname=usePathname(),[open,setOpen]=useState(false),[collapsed,setCollapsed]=useState(false),searchRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{try{setCollapsed(localStorage.getItem("marquinhos-sidebar")==="collapsed")}catch{}const shortcut=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();searchRef.current?.focus()}if(e.key==="Escape")setOpen(false)};addEventListener("keydown",shortcut);return()=>removeEventListener("keydown",shortcut)},[]);
 const toggleSidebar=()=>{setCollapsed(!collapsed);try{localStorage.setItem("marquinhos-sidebar",collapsed?"expanded":"collapsed")}catch{}};
 const mobile=useMobile(),compact=collapsed&&!mobile;
 useEffect(()=>{if(!open||!mobile)return;const previous=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=previous}},[open,mobile]);
 const management = isManagement(roles);
 const canSee = (href: string) => {
  const access = moduleAccess(href);
  return (!access.management || management) && (!access.resource || viewable.includes(access.resource));
 };
 return <div className="app-shell-root">
  {open&&<button aria-label="Fechar menu" className="sidebar-overlay" onClick={()=>setOpen(false)}/>}
  <aside className={"app-sidebar"+(open?" is-open":"")+(compact?" is-collapsed":"")}>
   <div className="sidebar-brand"><Link href="/dashboard" aria-label="Marquinhos Calhas e Esquadrias — início"><BrandLogo compact={compact}/></Link><button className="sidebar-close" aria-label="Fechar navegação" onClick={()=>setOpen(false)}><X size={18}/></button></div>
   <nav className="sidebar-nav" aria-label="Navegação principal">{groups.map(group=>{const items=group.items.filter(([,href])=>canSee(href));if(!items.length)return null;return <div className="sidebar-section" key={group.title}>{!compact&&<p>{group.title}</p>}{items.map(([label,href,Icon])=>{const active=pathname===href||(href!=="/dashboard"&&pathname.startsWith(href+"/"));return <Link href={href} key={href} title={label} aria-current={active?"page":undefined} onClick={()=>setOpen(false)} className={"sidebar-link"+(active?" is-active":"")}><Icon size={18}/>{!compact&&label}</Link>})}</div>})}</nav>
   <div className="sidebar-footer"><LogoutButton collapsed={compact}/>{!compact&&<div className="sidebar-credit"><AuthorSignature/></div>}</div>
   <button className="sidebar-collapse" aria-label={collapsed?"Expandir menu":"Recolher menu"} onClick={toggleSidebar}>{collapsed?<ChevronRight size={16}/>:<ChevronLeft size={16}/>}</button>
  </aside>
  <div className="app-workspace">
   <header className="app-topbar"><button className="mobile-menu-button" aria-label="Abrir menu" aria-expanded={open} onClick={()=>setOpen(true)}><Menu size={21}/></button>
    <LiveSearchForm action="/busca" className="topbar-search"><Search size={17}/><input ref={searchRef} className="field" name="q" aria-label="Busca global" placeholder="Pesquisar no sistema..."/><kbd>Ctrl K</kbd></LiveSearchForm>
    <div className="topbar-actions"><ThemeToggle/><NotificationCenter/><div className="topbar-user"><span className="user-avatar">{userName.slice(0,2).toUpperCase()}</span><span>{userName}<small title={companyName}>Marquinhos · Gestão</small></span></div></div>
   </header>
   <Suspense fallback={null}><NavProgress/></Suspense><InputHelpers/><main className="app-content">{children}</main><footer className="app-footer"><AuthorSignature/></footer>
  </div>
  <nav className="mobile-bottom-bar" aria-label="Navegação no celular">
   <Link href="/dashboard" aria-current={pathname==="/dashboard"?"page":undefined}><LayoutDashboard size={19}/>Início</Link>
   {canSee("/clientes")?<Link href="/clientes" aria-current={pathname.startsWith("/clientes")?"page":undefined}><Users size={19}/>Clientes</Link>:<Link href="/pendencias"><AlertCircle size={19}/>Pendências</Link>}
   {canSee("/orcamentos")?<Link className="mobile-create" href="/orcamentos/calhas" aria-label="Novo orçamento"><Plus size={24}/><span>Orçamento</span></Link>:<Link className="mobile-create" href="/pendencias"><ClipboardCheck size={24}/><span>Pendências</span></Link>}
   <Link href={canSee("/agenda")?"/agenda":"/busca"} aria-current={pathname.startsWith("/agenda")?"page":undefined}><CalendarCheck size={19}/>{canSee("/agenda")?"Agenda":"Busca"}</Link>
   <button type="button" onClick={()=>setOpen(true)} aria-expanded={open}><Menu size={20}/>Menu</button>
  </nav>
 </div>;
}
