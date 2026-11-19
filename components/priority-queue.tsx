import Link from "next/link";
import { ArrowRight, CheckCircle2, ClipboardList, Factory, FileText, MessageCircle, Ruler, Wrench } from "lucide-react";
import { getRequestClient } from "@/lib/supabase/server";
import { waitingLabel, waitingSince } from "@/lib/inbox-waiting";
import { cn } from "@/lib/utils";

type Item = { key: string; icon: typeof MessageCircle; title: string; detail: string; href: string; urgent?: boolean };

/**
 * "O que preciso fazer agora": poucas ações reais, cada uma com contagem e link direto.
 * Usa o acesso de quem está logado (RLS): quem não vê um módulo simplesmente não recebe o item.
 */
export async function PriorityQueue() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const db = await getRequestClient();
  const week = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const threeDays = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
  // Início e fim do dia de hoje em Brasília: medições e instalações marcadas para hoje.
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const dayStart = new Date(`${ymd}T00:00:00-03:00`).toISOString(), dayEnd = new Date(`${ymd}T23:59:59-03:00`).toISOString();
  const [convs, pending, quotes, measurements, installs, production] = await Promise.all([
    db.from("conversations").select("last_inbound_at,last_message_at,status,archived_at").eq("channel", "whatsapp").not("last_inbound_at", "is", null).gte("last_inbound_at", week).limit(1000),
    db.from("v_order_pending").select("order_id", { count: "exact", head: true }),
    db.from("quotes").select("id", { count: "exact", head: true }).eq("status", "enviado").is("sale_id", null).lte("sent_at", threeDays),
    db.from("measurements").select("id", { count: "exact", head: true }).is("completed_at", null).not("status", "in", "(concluida,cancelada)").gte("scheduled_at", dayStart).lte("scheduled_at", dayEnd),
    db.from("installations").select("id", { count: "exact", head: true }).is("completed_at", null).not("status", "in", "(concluida,cancelada)").gte("scheduled_at", dayStart).lte("scheduled_at", dayEnd),
    db.from("production_orders").select("id", { count: "exact", head: true }).eq("status", "aguardando_material"),
  ]);
  const items: Item[] = [];
  const waiting = ((convs.data ?? []) as Array<{ last_inbound_at: string; last_message_at: string | null; status: string | null; archived_at: string | null }>)
    .filter((c) => !c.archived_at && c.status !== "resolvida")
    .map((c) => waitingSince(c.last_inbound_at, c.last_message_at)).filter((w): w is string => !!w).sort();
  if (waiting.length) {
    const oldest = waitingLabel(waiting[0]);
    items.push({ key: "chat", icon: MessageCircle, title: `${waiting.length} cliente(s) esperando resposta`, detail: oldest ? `O mais antigo espera há ${oldest}` : "Responda para não perder a venda", href: "/atendimento", urgent: !!oldest && /h|dia/.test(oldest) });
  }
  if (!pending.error && (pending.count ?? 0) > 0) items.push({ key: "med", icon: ClipboardList, title: `${pending.count} pendência(s) de pedidos fechados`, detail: "Conferir medidas, agendar visita ou liberar corte", href: "/agenda" });
  if (!quotes.error && (quotes.count ?? 0) > 0) items.push({ key: "orc", icon: FileText, title: `${quotes.count} orçamento(s) sem retorno há 3 dias ou mais`, detail: "Consulte o cliente para esclarecer dúvidas", href: "/orcamentos" });

  if (!measurements.error && (measurements.count ?? 0) > 0) items.push({ key: "hoje-med", icon: Ruler, title: `${measurements.count} medição(ões) marcada(s) para hoje`, detail: "Confira endereço e horário antes de sair", href: "/medicoes" });
  if (!installs.error && (installs.count ?? 0) > 0) items.push({ key: "hoje-inst", icon: Wrench, title: `${installs.count} instalação(ões) marcada(s) para hoje`, detail: "Veja checklist, fotos e endereço", href: "/instalacoes" });
  if (!production.error && (production.count ?? 0) > 0) items.push({ key: "prod", icon: Factory, title: `${production.count} ordem(ns) de produção aguardando material`, detail: "Receber o material libera o corte", href: "/producao" });
  // Contas vencidas já aparecem nos avisos logo acima do painel: não repetir aqui.
  // Itens do dia e atrasos antes das demais pendências.
  const order = ["chat", "hoje-med", "hoje-inst", "prod", "med", "orc"];
  items.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  return (
    <section aria-label="O que fazer agora" className="card mb-6 p-5">
      <h2 className="font-black">O que fazer agora</h2>
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink/60"><CheckCircle2 className="h-4 w-4 text-green-600" /> Nada urgente no momento. Pendências novas aparecem aqui.</p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => (
            <li key={i.key}>
              <Link href={i.href} className={cn("flex h-full items-start gap-3 rounded-xl border p-3 hover:bg-cream", i.urgent ? "border-red-500/40" : "border-sand")}>
                <i.icon className={cn("mt-0.5 h-5 w-5 shrink-0", i.urgent ? "text-red-500" : "text-forest")} />
                <span className="min-w-0 flex-1"><b className="block text-sm">{i.title}</b><span className="text-xs text-ink/60">{i.detail}</span></span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink/40" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
