import Link from "next/link";
import { Boxes, Building2, ClipboardCheck, FileText, HandCoins, Search, ShoppingCart, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

type Result={entity_type:string;entity_id:string;title:string;subtitle:string;status:string;href:string;priority:number};
const icons:Record<string,typeof Search>={cliente:Users,pedido:ClipboardCheck,"orçamento":FileText,venda:HandCoins,compra:ShoppingCart,fornecedor:Building2,material:Boxes};
const labels:Record<string,string>={cliente:"Clientes",pedido:"Pedidos","orçamento":"Orçamentos",venda:"Vendas",compra:"Compras",fornecedor:"Fornecedores",material:"Materiais"};

export async function GlobalSearch({query}:{query?:string}) {
  let results:Result[]=[]; let error=""; const term=query?.trim()??"";
  if(term.length>=2&&process.env.NEXT_PUBLIC_SUPABASE_URL){const db=await createClient();const response=await db.rpc("global_search",{p_query:term});results=(response.data as Result[])??[];error=response.error?.message??"";}
  const groups=Object.entries(Object.groupBy(results,item=>item.entity_type));
  return <div className="mx-auto max-w-6xl"><div className="mb-7"><p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Encontre qualquer registro</p><h1 className="mt-2 text-3xl font-black">Busca global</h1><p className="mt-1 text-sm text-ink/50">Clientes, documentos comerciais, fornecedores e materiais em uma consulta.</p></div>
    <form className="card relative p-3"><Search className="absolute left-7 top-7 h-5 w-5 text-ink/35"/><input autoFocus className="field py-3.5 pl-12 text-base" name="q" defaultValue={term} placeholder="Nome, telefone, número do pedido, orçamento, compra..."/><button className="button absolute right-5 top-5">Buscar</button></form>
    {error&&<p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">Não foi possível buscar: {error}</p>}
    {term.length>0&&term.length<2&&<p className="mt-8 text-center text-sm text-ink/45">Digite ao menos dois caracteres.</p>}
    {term.length>=2&&!error&&!results.length&&<div className="card mt-5 p-12 text-center"><Search className="mx-auto h-8 w-8 text-ink/20"/><h2 className="mt-4 font-black">Nenhum resultado para “{term}”</h2><p className="mt-1 text-sm text-ink/45">Tente nome, telefone ou número sem pontuação.</p></div>}
    <div className="mt-5 space-y-5">{groups.map(([type,items])=>{const Icon=icons[type]??Search;return <section className="card overflow-hidden" key={type}><div className="flex items-center gap-3 border-b bg-cream/45 px-5 py-3"><Icon className="h-4 w-4 text-forest"/><h2 className="font-black">{labels[type]??type}</h2><span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-ink/45">{items?.length??0}</span></div><div className="divide-y">{items?.map(item=><Link href={item.href} key={`${item.entity_type}-${item.entity_id}`} className="flex items-center justify-between gap-4 p-4 transition hover:bg-cream/40"><div className="min-w-0"><p className="font-bold">{item.title}</p><p className="truncate text-xs text-ink/45">{item.subtitle||"Sem informação complementar"}</p></div><Status value={item.status}/></Link>)}</div></section>})}</div>
  </div>;
}
function Status({value}:{value:string}){return <span className="whitespace-nowrap rounded-full bg-cream px-2.5 py-1 text-xs font-bold text-ink/60">{value?.replaceAll("_"," ")||"-"}</span>}
