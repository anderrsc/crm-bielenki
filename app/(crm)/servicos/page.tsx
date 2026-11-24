import Link from "next/link";
import { Plus } from "lucide-react";
import { getRequestClient } from "@/lib/supabase/server";
import { money, shortDate, todayISO } from "@/lib/utils";
import { friendlyError } from "@/lib/friendly-error";
import { SERVICE_KINDS, SERVICE_PRIORITY, SERVICE_STATUS, serviceOpen } from "@/lib/service-orders";
import { OperationalIndicators } from "@/components/operational-indicators";

type Row = { id: string; service_number: string; kind: string; status: string; priority: string; description: string; expected_date: string | null; scheduled_at: string | null; billing: string; expected_amount: number | null; final_amount: number | null; client: { name: string } | null; responsible: { full_name: string } | null };
const FILTERS: Record<string, string> = { abertos: "Em aberto", urgentes: "Urgentes", agendar: "Aguardando agendamento", agendados: "Agendados", concluidos: "Concluídos", todos: "Todos" };
const PAGE = 30;

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ q?: string; filtro?: string; tipo?: string; pagina?: string; erro?: string; ok?: string }> }) {
  const search = await searchParams;
  const db = await getRequestClient();
  const filtro = search.filtro && FILTERS[search.filtro] ? search.filtro : "abertos";
  const tipo = search.tipo && SERVICE_KINDS[search.tipo] ? search.tipo : "";
  const page = Math.max(1, Number.parseInt(search.pagina ?? "1", 10) || 1);
  const term = (search.q ?? "").trim().slice(0, 80).replace(/[,()*%\\]/g, " ").trim();
  let query = db.from("service_orders").select("id,service_number,kind,status,priority,description,expected_date,scheduled_at,billing,expected_amount,final_amount,client:clients(name),responsible:profiles!service_orders_responsible_id_fkey(full_name)")
    .order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE);
  if (filtro === "abertos") query = query.not("status", "in", "(concluido,cancelado)");
  if (filtro === "urgentes") query = query.not("status", "in", "(concluido,cancelado)").eq("priority", "urgente");
  if (filtro === "agendar") query = query.in("status", ["solicitacao_recebida", "aguardando_avaliacao", "aguardando_agendamento", "necessita_retorno"]);
  if (filtro === "agendados") query = query.eq("status", "visita_agendada");
  if (filtro === "concluidos") query = query.eq("status", "concluido");
  if (tipo) query = query.eq("kind", tipo);
  if (term) {
    const { data: found } = await db.from("clients").select("id").ilike("name", `%${term}%`).limit(200);
    const ids = (found ?? []).map((c) => c.id);
    query = query.or([`service_number.ilike.*${term}*`, `description.ilike.*${term}*`, ids.length ? `client_id.in.(${ids.join(",")})` : ""].filter(Boolean).join(","));
  }
  const [{ data, error }, { data: canCreate }] = await Promise.all([query, db.rpc("has_table_access", { resource: "service_orders", action: "insert" })]);
  if (error) return <div className="mx-auto max-w-5xl"><p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">Não foi possível carregar os serviços. Atualize a página.</p></div>;
  const all = (data ?? []) as unknown as Row[];
  const hasMore = all.length > PAGE;
  const rows = all.slice(0, PAGE);
  const today = todayISO();
  const href = (p: Record<string, string | number>) => `/servicos?${new URLSearchParams(Object.entries({ q: term, filtro, tipo, ...p }).filter(([, v]) => v !== "").map(([k, v]) => [k, String(v)]))}`;

  return <div className="mx-auto max-w-6xl space-y-5">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-semibold text-forest">Operação</p><h1 className="mt-2 text-3xl font-semibold">Serviços</h1>
        <p className="mt-1 text-sm text-ink/55">Instalações avulsas, manutenções, reparos, garantias e visitas técnicas.</p></div>
      {canCreate === true && <Link href="/servicos/novo" className="button"><Plus className="h-4 w-4" /> Novo serviço</Link>}
    </div>
    {search.erro && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{friendlyError(search.erro)?.slice(0, 250)}</p>}
    {search.ok && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{search.ok.slice(0, 200)}</p>}
    <OperationalIndicators />

    <div className="flex flex-wrap gap-2">{Object.entries(FILTERS).map(([k, v]) => <Link key={k} href={href({ filtro: k, pagina: "" })} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${filtro === k ? "border-forest bg-brand-strong text-white" : "border-sand hover:bg-sand/50"}`}>{v}</Link>)}</div>
    <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
      <input type="hidden" name="filtro" value={filtro} />
      <label><span className="label">Buscar</span><input className="field" name="q" defaultValue={search.q ?? ""} placeholder="Cliente, número ou descrição" /></label>
      <label><span className="label">Tipo</span><select className="field" name="tipo" defaultValue={tipo}><option value="">Todos</option>{Object.entries(SERVICE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <button className="button-ghost">Filtrar</button>
      {(term || tipo) && <Link href={href({ q: "", tipo: "" })} className="pb-2 font-semibold text-ink/55 underline">Limpar</Link>}
    </form>

    {!rows.length && <div className="card p-10 text-center text-sm text-ink/45">Nenhum serviço encontrado.</div>}
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((s) => {
        const late = serviceOpen(s.status) && !!s.expected_date && s.expected_date < today;
        return <Link key={s.id} href={`/servicos/${s.id}`} className={`card block p-4 transition hover:shadow-soft ${s.priority === "urgente" && serviceOpen(s.status) ? "border-red-300" : late ? "border-amber-300" : ""}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="truncate text-base font-semibold">{s.client?.name ?? "Cliente"}</p><p className="text-xs text-ink/55">{s.service_number} · {SERVICE_KINDS[s.kind] ?? s.kind}</p></div>
            <span className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-semibold ${s.status === "concluido" ? "bg-emerald-50 text-emerald-700" : s.status === "cancelado" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-800"}`}>{SERVICE_STATUS[s.status] ?? s.status}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm">{s.description}</p>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink/60">
            {s.priority !== "normal" && <span className={s.priority === "urgente" ? "font-semibold text-red-700" : "font-semibold"}>Prioridade {SERVICE_PRIORITY[s.priority]?.toLowerCase()}</span>}
            {s.scheduled_at ? <span>Visita {shortDate(s.scheduled_at)}</span> : s.expected_date ? <span className={late ? "font-semibold text-red-700" : ""}>Previsto {shortDate(s.expected_date)}{late ? " · atrasado" : ""}</span> : <span>Sem data</span>}
            {s.responsible?.full_name && <span>{s.responsible.full_name}</span>}
            <span>{s.billing === "gratuito" ? "Gratuito" : s.final_amount !== null ? money(s.final_amount) : s.expected_amount !== null ? `Previsto ${money(s.expected_amount)}` : "A cobrar"}</span>
          </p>
        </Link>;
      })}
    </div>
    {(page > 1 || hasMore) && <div className="flex items-center justify-between text-sm"><span className="text-ink/50">Página {page}</span>
      <div className="flex gap-2">{page > 1 && <Link className="button-ghost" href={href({ pagina: page - 1 })}>Anterior</Link>}{hasMore && <Link className="button-ghost" href={href({ pagina: page + 1 })}>Próxima</Link>}</div></div>}
  </div>;
}
