"use client";
import { LiveSearchForm } from "./live-search-form";
import { CommandPalette, type PaletteItem } from "./command-palette";
import { Toaster } from "./ui-feedback/toast";
import { QuickCreateMenu } from "./quick-create-menu";
import { Breadcrumbs } from "./breadcrumbs";
import { SavedViews, SAVED_VIEW_PAGES } from "./saved-views";
import { UnsavedGuard } from "./unsaved-guard";
import { ConfirmHost } from "./ui-feedback/confirm";

import { useMobile } from "@/lib/use-mobile";
import { NotificationCenter } from "@/components/notification-center";
import { isManagement, moduleAccess } from "@/lib/module-access";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { House,LayoutGrid,Calculator,Smartphone,Workflow,ChevronDown,Star,ReceiptText,Wrench,AlertCircle,BarChart3,Bell,Bot,Boxes,Building2,CalendarCheck,ChevronLeft,ChevronRight,CircleDollarSign,ClipboardCheck,Factory,FileText,HandCoins,LayoutDashboard,Menu,MessageCircle,Plus,Ruler,Search,Settings,Shield,Sparkles,UserCog,Users,WalletCards,X } from "lucide-react";
import { Suspense,useEffect,useRef,useState } from "react";
import { NavProgress } from "./nav-progress";
import { InputHelpers } from "./input-helpers";
import { LogoutButton } from "./logout-button";
import { AccessContext } from "./access-context";
import { AuthorSignature,BrandLogo } from "./brand-logo";
// Menu por área. Todo grupo abre/fecha no título; o da tela atual abre sozinho. Principal começa aberto.
const groups=[
 {title:"Principal",items:[["Dashboard", "/dashboard",LayoutDashboard],["Pendências", "/pendencias",AlertCircle],["Atendimento", "/atendimento",MessageCircle],["WhatsApp", "/atendimento/canais",Smartphone],["Clientes", "/clientes",Users],["Pipeline", "/pipeline",BarChart3],["Orçamentos", "/orcamentos",FileText],["Vendas", "/vendas",HandCoins],["Pedidos", "/pedidos",ClipboardCheck]]},
 {title:"Operação",items:[["Agenda", "/agenda",CalendarCheck],["Equipes e veículos", "/equipes",Users],["Medições", "/medicoes",Ruler],["Produção", "/producao",Factory],["Instalações", "/instalacoes",CalendarCheck],["Serviços", "/servicos",Wrench]]},
 {title:"Compras e estoque",items:[["Compras", "/compras",HandCoins],["Fornecedores", "/fornecedores",Building2],["Estoque", "/estoque",Boxes],["Produtos & Peças", "/tabela-calhas",Boxes]]},
 {title:"Financeiro",items:[["Financeiro", "/financeiro",CircleDollarSign],["A Receber", "/financeiro/receber",WalletCards],["A Pagar", "/financeiro/pagar",HandCoins],["Conciliação", "/financeiro/conciliacao",ClipboardCheck],["Extrato por conta", "/financeiro/extrato",ReceiptText],["Recorrências", "/financeiro/recorrencias",CalendarCheck],["Relatórios financeiros", "/financeiro/relatorios",BarChart3],["Tributos (calculadora)", "/fiscal",Calculator],["Relatórios", "/relatorios",BarChart3]]},
 // IA num lugar só: a Central de IA abre conversas e configurações da Lia (antes "Agente IA" era outro item).
 {title:"Sistema",items:[["Central de IA", "/central-ia",Bot],["Automações", "/automacoes",Workflow],["Funcionários", "/configuracoes/funcionarios",UserCog],["Cargos", "/configuracoes/cargos",Shield],["Configurações", "/configuracoes",Settings],["Auditoria", "/auditoria",Shield],["Guia visual", "/design-system",Boxes]]},
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
export function AppShell({children,userName,companyName,roles=[],viewable=[],unreadChats=0}:{children:React.ReactNode;userName:string;companyName:string;roles?:string[];viewable?:string[];unreadChats?:number}){
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
  ...groups.flatMap(g=>g.items.filter(([,href])=>canSee(href)).map(([label,href,Icon])=>({label,href,icon:Icon,group:"Ir para",keywords:g.title}))),
 ];
 // Favoritos e recentes (por navegador): atalhos para as telas mais usadas.
 const flat=groups.flatMap(g=>g.items.map(([label,href,Icon])=>({label,href,Icon}))).filter(i=>canSee(i.href));
 const route=pathname.startsWith("/agente-ia")?"/central-ia":pathname;
 const current=[...flat].sort((a,b)=>b.href.length-a.href.length).find(i=>route===i.href||route.startsWith(i.href+"/"));
 const [favs,setFavs]=useState<string[]>([]),[recent,setRecent]=useState<string[]>([]);
 useEffect(()=>{try{setFavs(JSON.parse(localStorage.getItem("marquinhos-favs")||"[]"));setRecent(JSON.parse(localStorage.getItem("marquinhos-recent")||"[]"))}catch{}},[]);
 const currentHref=current?.href;
 useEffect(()=>{if(!currentHref)return;setRecent(old=>{const next=[currentHref,...old.filter(h=>h!==currentHref)].slice(0,5);try{localStorage.setItem("marquinhos-recent",JSON.stringify(next))}catch{}return next})},[currentHref]);
 // Estado aberto/fechado de cada grupo, escolhido pela pessoa (guardado neste navegador).
 const [groupState,setGroupState]=useState<Record<string,boolean>>({});
 useEffect(()=>{try{setGroupState(JSON.parse(localStorage.getItem("marquinhos-menu-groups")||"{}"))}catch{}},[]);
 const groupOpen=(title:string,hasActive=false)=>compact||(groupState[title]??(hasActive||title==="Principal"||title==="Favoritos"));
 const toggleGroup=(title:string,hasActive=false)=>setGroupState(old=>{const next={...old,[title]:!(old[title]??(hasActive||title==="Principal"||title==="Favoritos"))};try{localStorage.setItem("marquinhos-menu-groups",JSON.stringify(next))}catch{}return next});
 // Ao entrar numa tela de um grupo fechado, ele abre sozinho (o item atual nunca fica escondido).
 const activeGroup=groups.find(g=>g.items.some(([,href])=>href===current?.href))?.title;
 useEffect(()=>{if(!activeGroup)return;setGroupState(old=>old[activeGroup]===false?{...old,[activeGroup]:true}:old)},[activeGroup,currentHref]);
 const groupHeader=(title:string,open:boolean,hasActive=false)=>!compact&&<button type="button" className="sidebar-group-toggle" aria-expanded={open} onClick={()=>toggleGroup(title,hasActive)}>{title}<ChevronDown size={13} className={open?"":"-rotate-90"}/></button>;
 const toggleFav=(href:string)=>setFavs(old=>{const next=old.includes(href)?old.filter(h=>h!==href):[...old,href].slice(0,8);try{localStorage.setItem("marquinhos-favs",JSON.stringify(next))}catch{}return next});
 const byHref=(list:string[])=>list.map(h=>flat.find(i=>i.href===h)).filter((i):i is (typeof flat)[number]=>!!i);
 const favItems=byHref(favs),recentItems=byHref(recent.filter(h=>!favs.includes(h)&&h!==currentHref)).slice(0,3);
 const shortcutLink=(i:(typeof flat)[number])=><Link href={i.href} key={i.href} title={i.label} aria-current={pathname===i.href?"page":undefined} onClick={()=>setOpen(false)} className={"sidebar-link"+(pathname===i.href?" is-active":"")}><i.Icon size={18}/>{!compact&&i.label}</Link>;
 // Favoritos no topo (escolha da pessoa); recentes no fim, para não repetir o menu logo de cara.
 const shortcuts=favItems.length>0&&<div className="sidebar-section">{groupHeader("Favoritos",groupOpen("Favoritos"))}{groupOpen("Favoritos")&&favItems.map(shortcutLink)}</div>;
 const recentBlock=recentItems.length>0&&!compact&&<div className="sidebar-section">{groupHeader("Recentes",groupOpen("Recentes"))}{groupOpen("Recentes")&&recentItems.map(shortcutLink)}</div>;
 // Barra do celular: Início · WhatsApp · Agenda · Orçamentos · Mais. Só entra o que o cargo pode ver.
 const mobileTabs=[
  {href:"/dashboard",label:"Início",Icon:House,show:true},
  {href:"/atendimento",label:"WhatsApp",Icon:MessageCircle,show:canSee("/atendimento")},
  {href:"/agenda",label:"Agenda",Icon:CalendarCheck,show:canSee("/agenda")},
  {href:"/orcamentos",label:"Orçamentos",Icon:FileText,show:canSee("/orcamentos")},
 ].filter(t=>t.show);
 if(mobileTabs.length<4)mobileTabs.splice(1,0,{href:"/pendencias",label:"Pendências",Icon:AlertCircle,show:true});
 return <AccessContext.Provider value={canSee}><div className="app-shell-root">
  {open&&<button aria-label="Fechar menu" className="sidebar-overlay" onClick={()=>setOpen(false)}/>}
  <aside className={"app-sidebar"+(open?" is-open":"")+(compact?" is-collapsed":"")}>
   <div className="sidebar-brand"><Link href="/dashboard" aria-label="Marquinhos Calhas e Esquadrias — início"><BrandLogo compact={compact}/></Link><button className="sidebar-close" aria-label="Fechar navegação" onClick={()=>setOpen(false)}><X size={18}/></button></div>
   <nav className="sidebar-nav" aria-label="Navegação principal"><Link href="/busca" onClick={()=>setOpen(false)} className="sidebar-link sidebar-search-link"><Search size={18}/>Buscar</Link>{shortcuts}{groups.map(group=>{const items=group.items.filter(([,href])=>canSee(href));if(!items.length)return null;const hasActive=items.some(([,href])=>href===current?.href);const open=groupOpen(group.title,hasActive);return <div className="sidebar-section" key={group.title}>{groupHeader(group.title,open,hasActive)}{open&&items.map(([label,href,Icon])=>{const active=current?.href===href;return <Link href={href} key={href} title={label} aria-current={active?"page":undefined} onClick={()=>setOpen(false)} className={"sidebar-link"+(active?" is-active":"")}><Icon size={18}/>{!compact&&label}</Link>})}{group.title==="Sistema"&&management&&open&&<a href={JARVIS_URL} target="_blank" rel="noopener noreferrer" title="Jarvis (abre em nova aba)" onClick={()=>setOpen(false)} className="sidebar-link"><Sparkles size={18}/>{!compact&&"Jarvis"}</a>}</div>})}{recentBlock}</nav>
   <div className="sidebar-footer"><LogoutButton collapsed={compact}/>{!compact&&<div className="sidebar-credit"><AuthorSignature/></div>}</div>
   <button className="sidebar-collapse" aria-label={collapsed?"Expandir menu":"Recolher menu"} onClick={toggleSidebar}>{collapsed?<ChevronRight size={16}/>:<ChevronLeft size={16}/>}</button>
  </aside>
  <div className="app-workspace">
   <header className="app-topbar"><button className="mobile-menu-button" aria-label="Abrir menu" aria-expanded={open} onClick={()=>setOpen(true)}><Menu size={21}/></button>
    <Link href="/dashboard" className="mobile-brand" aria-label="Marquinhos Calhas e Esquadrias — início"><img src="/brand/marquinhos-logo.svg" alt="Marquinhos Calhas e Esquadrias" width={117} height={40}/></Link>
    <LiveSearchForm action="/busca" className="topbar-search"><Search size={17}/><input ref={searchRef} className="field" name="q" aria-label="Busca global" placeholder="Pesquisar…"/><kbd role="button" tabIndex={0} title="Comandos rápidos (Ctrl K)" style={{cursor:"pointer"}} onClick={()=>dispatchEvent(new Event("open-command-palette"))} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();dispatchEvent(new Event("open-command-palette"))}}}>Ctrl K</kbd></LiveSearchForm>
    <div className="topbar-actions">{current&&<button type="button" onClick={()=>toggleFav(current.href)} aria-pressed={favs.includes(current.href)} title={favs.includes(current.href)?"Tirar dos favoritos":"Fixar nos favoritos"} aria-label={favs.includes(current.href)?`Tirar ${current.label} dos favoritos`:`Fixar ${current.label} nos favoritos`} className="rounded-lg p-2 text-ink/50 hover:bg-cream hover:text-ink"><Star size={18} fill={favs.includes(current.href)?"currentColor":"none"}/></button>}<QuickCreateMenu items={CREATE.filter(c=>canSee(c.base)).map(c=>({label:c.label,href:c.href}))}/><NotificationCenter/><div className="topbar-user"><span className="user-avatar">{userName.slice(0,2).toUpperCase()}</span><span>{userName}<small title={companyName}>Marquinhos · Gestão</small></span></div></div>
   </header>
   <Suspense fallback={null}><NavProgress/><Toaster/></Suspense><ConfirmHost/><CommandPalette items={paletteItems}/><InputHelpers/><main className="app-content">{current&&pathname.replace(/\/$/,"")===current.href&&<div className="shell-band" aria-hidden="true"><span className="shell-band-icon"><current.Icon size={22}/></span><span>{current.label}</span></div>}<Breadcrumbs pathname={pathname} sectionLabel={href=>flat.find(i=>i.href===href)?.label}/>{SAVED_VIEW_PAGES.includes(pathname)&&<Suspense fallback={null}><SavedViews/></Suspense>}{children}</main><UnsavedGuard/><footer className="app-footer"><AuthorSignature/></footer>
  </div>
  <nav className="mobile-bottom-bar" aria-label="Navegação no celular">
   {mobileTabs.map(({href,label,Icon})=>{const active=href==="/dashboard"?pathname===href:pathname===href||pathname.startsWith(href+"/");return <Link key={href} href={href} aria-current={active?"page":undefined}><span className="mobile-tab-icon"><Icon size={22} strokeWidth={active?2.2:1.8}/>{href==="/atendimento"&&unreadChats>0&&<b className="mobile-tab-badge" aria-label={`${unreadChats} não lidas`}>{unreadChats>99?"99+":unreadChats}</b>}</span><span>{label}</span></Link>})}
   <button type="button" onClick={()=>setOpen(true)} aria-expanded={open}><LayoutGrid size={22} strokeWidth={1.8}/><span>Mais</span></button>
  </nav>
 </div></AccessContext.Provider>;
}
