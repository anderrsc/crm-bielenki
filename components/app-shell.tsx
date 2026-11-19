"use client";
import { LiveSearchForm } from "./live-search-form";
import { CommandPalette, type PaletteItem } from "./command-palette";
import { Toaster } from "./ui-feedback/toast";
import { QuickCreateMenu } from "./quick-create-menu";
import { ConfirmHost } from "./ui-feedback/confirm";

import { useMobile } from "@/lib/use-mobile";
import { NotificationCenter } from "@/components/notification-center";
import { isManagement, moduleAccess } from "@/lib/module-access";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Star,ReceiptText,Wrench,AlertCircle,BarChart3,Bell,Bot,Boxes,Building2,CalendarCheck,ChevronLeft,ChevronRight,CircleDollarSign,ClipboardCheck,Factory,FileText,HandCoins,LayoutDashboard,Menu,MessageCircle,Plus,Ruler,Search,Settings,Shield,Sparkles,UserCog,Users,WalletCards,X } from "lucide-react";
import { Suspense,useEffect,useRef,useState } from "react";
import { NavProgress } from "./nav-progress";
import { InputHelpers } from "./input-helpers";
import { LogoutButton } from "./logout-button";
import { AuthorSignature,BrandLogo } from "./brand-logo";
import { ThemeToggle } from "./theme-toggle";
const groups=[
 {title:"Principal",items:[["Dashboard", "/dashboard",LayoutDashboard],["Pendências", "/pendencias",AlertCircle],["Atendimento", "/atendimento",MessageCircle],["Clientes", "/clientes",Users],["Pipeline", "/pipeline",BarChart3],["Orçamentos", "/orcamentos",FileText],["Vendas", "/vendas",HandCoins],["Pedidos", "/pedidos",ClipboardCheck]]},
 {title:"Operação",items:[["Agenda", "/agenda",CalendarCheck],["Medições", "/medicoes",Ruler],["Produção", "/producao",Factory],["Instalações", "/instalacoes",CalendarCheck],["Serviços", "/servicos",Wrench]]},
 {title:"Gestão",items:[["Produtos & Peças", "/tabela-calhas",Boxes],["Compras", "/compras",HandCoins],["Fornecedores", "/fornecedores",Building2],["Estoque", "/estoque",Boxes],["Financeiro", "/financeiro",CircleDollarSign],["Conciliação", "/financeiro/conciliacao",ClipboardCheck],["Extrato por conta", "/financeiro/extrato",ReceiptText],["Recorrências", "/financeiro/recorrencias",CalendarCheck],["Relatórios financeiros", "/financeiro/relatorios",BarChart3],["A Receber", "/financeiro/receber",WalletCards],["A Pagar", "/financeiro/pagar",HandCoins],["Relatórios", "/relatorios",BarChart3]]},
 {title:"Equipe",items:[["Funcionários", "/configuracoes/funcionarios",UserCog],["Cargos", "/configuracoes/cargos",Shield]]},
 {title:"Geral",items:[["Automações", "/automacoes",Bot],["Central de IA", "/central-ia",Bot],["Agente IA", "/agente-ia",Bot],["Auditoria", "/auditoria",Shield],["Configurações", "/configuracoes",Settings],["Guia visual", "/design-system",Boxes]]},
] as const;
// Painel do Jarvis (fila de tarefas de IA na VPS). Projeto separado: anderrsc/JARVIS-AI-CRM-Bielenki.
// Atalhos de criação da paleta Ctrl+K (cada um só aparece para quem vê o módulo).
const CREATE=[
 {label:"Novo orçamento de calhas",href:"/orcamentos/calhas",base:"/orcamentos",icon:FileText,keywords:"orcamento calha rufo"},
 {label:"Novo orçamento de esquadrias",href:"/orcamentos/esquadrias",base:"/orcamentos",icon:FileText,keywords:"orcamento janela porta aluminio"},
 {label:"Novo cliente",href:"/clientes/novo",base:"/clientes",icon:Users,keywords:"cadastro cliente"},
 {label:"Nova venda",href:"/vendas/nova",base:"/vendas",icon:HandCoins,keywords:"venda manual"},
 {label:"Nova compra",href:"/compras/nova",base:"/compras",icon:HandCoins,keywords:"compra fornecedor nota material"},
] as const;
const JARVIS_URL="https://jarvis-ai-crm-bielenki.vercel.app";
export function AppShell({children,userName,companyName,roles=[],viewable=[]}:{children:React.ReactNode;userName:string;companyName:string;roles?:string[];viewable?:string[]}){
 const pathname=usePathname(),[open,setOpen]=useState(false),[collapsed,setCollapsed]=useState(false),searchRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{try{setCollapsed(localStorage.getItem("marquinhos-sidebar")==="collapsed")}catch{}const shortcut=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false)};addEventListener("keydown",shortcut);return()=>removeEventListener("keydown",shortcut)},[]);
 const toggleSidebar=()=>{setCollapsed(!collapsed);try{localStorage.setItem("marquinhos-sidebar",collapsed?"expanded":"collapsed")}catch{}};
 const mobile=useMobile(),compact=collapsed&&!mobile;
 useEffect(()=>{if(!open||!mobile)return;const previous=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=previous}},[open,mobile]);
 const management = isManagement(roles);
 const canSee = (href: string) => {
  const access = moduleAccess(href);
  return (!access.management || management) && (!access.resource || viewable.includes(access.resource));
 };
 const paletteItems:PaletteItem[]=[
  ...CREATE.filter(c=>canSee(c.base)).map(c=>({label:c.label,href:c.href,icon:c.icon,group:"Criar",keywords:c.keywords})),
  ...(canSee("/atendimento")?[{label:"Números de WhatsApp",href:"/atendimento/canais",icon:MessageCircle,group:"Ir para",keywords:"canais qr conectar whatsapp"}]:[]),
  ...groups.flatMap(g=>g.items.filter(([,href])=>canSee(href)).map(([label,href,Icon])=>({label,href,icon:Icon,group:"Ir para",keywords:g.title}))),
 ];
 // Favoritos e recentes (por navegador): atalhos para as telas mais usadas.
 const flat=groups.flatMap(g=>g.items.map(([label,href,Icon])=>({label,href,Icon}))).filter(i=>canSee(i.href));
 const current=[...flat].sort((a,b)=>b.href.length-a.href.length).find(i=>pathname===i.href||pathname.startsWith(i.href+"/"));
 const [favs,setFavs]=useState<string[]>([]),[recent,setRecent]=useState<string[]>([]);
 useEffect(()=>{try{setFavs(JSON.parse(localStorage.getItem("marquinhos-favs")||"[]"));setRecent(JSON.parse(localStorage.getItem("marquinhos-recent")||"[]"))}catch{}},[]);
 const currentHref=current?.href;
 useEffect(()=>{if(!currentHref)return;setRecent(old=>{const next=[currentHref,...old.filter(h=>h!==currentHref)].slice(0,5);try{localStorage.setItem("marquinhos-recent",JSON.stringify(next))}catch{}return next})},[currentHref]);
 const toggleFav=(href:string)=>setFavs(old=>{const next=old.includes(href)?old.filter(h=>h!==href):[...old,href].slice(0,8);try{localStorage.setItem("marquinhos-favs",JSON.stringify(next))}catch{}return next});
 const byHref=(list:string[])=>list.map(h=>flat.find(i=>i.href===h)).filter((i):i is (typeof flat)[number]=>!!i);
 const favItems=byHref(favs),recentItems=byHref(recent.filter(h=>!favs.includes(h))).slice(0,4);
 const shortcutLink=(i:(typeof flat)[number])=><Link href={i.href} key={i.href} title={i.label} aria-current={pathname===i.href?"page":undefined} onClick={()=>setOpen(false)} className={"sidebar-link"+(pathname===i.href?" is-active":"")}><i.Icon size={18}/>{!compact&&i.label}</Link>;
 const shortcuts=(favItems.length>0||recentItems.length>0)&&<>
  {favItems.length>0&&<div className="sidebar-section">{!compact&&<p>Favoritos</p>}{favItems.map(shortcutLink)}</div>}
  {recentItems.length>0&&!compact&&<div className="sidebar-section"><p>Recentes</p>{recentItems.map(shortcutLink)}</div>}
 </>;
 return <div className="app-shell-root">
  {open&&<button aria-label="Fechar menu" className="sidebar-overlay" onClick={()=>setOpen(false)}/>}
  <aside className={"app-sidebar"+(open?" is-open":"")+(compact?" is-collapsed":"")}>
   <div className="sidebar-brand"><Link href="/dashboard" aria-label="Marquinhos Calhas e Esquadrias — início"><BrandLogo compact={compact}/></Link><button className="sidebar-close" aria-label="Fechar navegação" onClick={()=>setOpen(false)}><X size={18}/></button></div>
   <nav className="sidebar-nav" aria-label="Navegação principal">{shortcuts}{groups.map(group=>{const items=group.items.filter(([,href])=>canSee(href));if(!items.length)return null;return <div className="sidebar-section" key={group.title}>{!compact&&<p>{group.title}</p>}{items.map(([label,href,Icon])=>{const active=pathname===href||(href!=="/dashboard"&&pathname.startsWith(href+"/"));return <Link href={href} key={href} title={label} aria-current={active?"page":undefined} onClick={()=>setOpen(false)} className={"sidebar-link"+(active?" is-active":"")}><Icon size={18}/>{!compact&&label}</Link>})}</div>})}{management&&<div className="sidebar-section">{!compact&&<p>Assistente</p>}<a href={JARVIS_URL} target="_blank" rel="noopener noreferrer" title="Jarvis (abre em nova aba)" onClick={()=>setOpen(false)} className="sidebar-link"><Sparkles size={18}/>{!compact&&"Jarvis"}</a></div>}</nav>
   <div className="sidebar-footer"><LogoutButton collapsed={compact}/>{!compact&&<div className="sidebar-credit"><AuthorSignature/></div>}</div>
   <button className="sidebar-collapse" aria-label={collapsed?"Expandir menu":"Recolher menu"} onClick={toggleSidebar}>{collapsed?<ChevronRight size={16}/>:<ChevronLeft size={16}/>}</button>
  </aside>
  <div className="app-workspace">
   <header className="app-topbar"><button className="mobile-menu-button" aria-label="Abrir menu" aria-expanded={open} onClick={()=>setOpen(true)}><Menu size={21}/></button>
    <LiveSearchForm action="/busca" className="topbar-search"><Search size={17}/><input ref={searchRef} className="field" name="q" aria-label="Busca global" placeholder="Pesquisar no sistema..."/><kbd role="button" tabIndex={0} title="Comandos rápidos (Ctrl K)" style={{cursor:"pointer"}} onClick={()=>dispatchEvent(new Event("open-command-palette"))} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();dispatchEvent(new Event("open-command-palette"))}}}>Ctrl K</kbd></LiveSearchForm>
    <div className="topbar-actions">{current&&<button type="button" onClick={()=>toggleFav(current.href)} aria-pressed={favs.includes(current.href)} title={favs.includes(current.href)?"Tirar dos favoritos":"Fixar nos favoritos"} aria-label={favs.includes(current.href)?`Tirar ${current.label} dos favoritos`:`Fixar ${current.label} nos favoritos`} className="rounded-lg p-2 text-ink/50 hover:bg-cream hover:text-ink"><Star size={18} fill={favs.includes(current.href)?"currentColor":"none"}/></button>}<QuickCreateMenu items={CREATE.filter(c=>canSee(c.base)).map(c=>({label:c.label,href:c.href}))}/><ThemeToggle/><NotificationCenter/><div className="topbar-user"><span className="user-avatar">{userName.slice(0,2).toUpperCase()}</span><span>{userName}<small title={companyName}>Marquinhos · Gestão</small></span></div></div>
   </header>
   <Suspense fallback={null}><NavProgress/><Toaster/></Suspense><ConfirmHost/><CommandPalette items={paletteItems}/><InputHelpers/><main className="app-content">{children}</main><footer className="app-footer"><AuthorSignature/></footer>
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
