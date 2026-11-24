import Link from "next/link";
import { AgendaEventLink } from "@/components/agenda-event-link";
import type { AgendaSource } from "@/lib/agenda";
import { CalendarCheck, CalendarPlus, ChevronRight, CircleDollarSign, FileText, Layers, Plus, ShoppingCart, User, Users } from "lucide-react";

type TodayEvent = { id: string; source?: AgendaSource; title: string; starts_at: string; event_type: string; client_name?: string };
export type MobileHomeProps = {
  name: string; greeting: string; dateLabel: string;
  kpis: { quotes: number; orders: number; today: number; receivable: string | null; receivableNote: string; leads: number };
  today: TodayEvent[];
  stages: { measure: number; production: number; install: number; done: number } | null;
};

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const TYPE: Record<string, string> = { medicao: "Medição", instalacao: "Instalação", visita: "Visita", reuniao: "Reunião", entrega: "Entrega" };

/** Início no celular, na organização das referências: saudação, 4 indicadores, ações rápidas, agenda de hoje e pedidos em andamento. */
export function MobileHome({ name, greeting, dateLabel, kpis, today, stages }: MobileHomeProps) {
  const tiles = [
    { label: "Orçamentos", value: String(kpis.quotes), note: "pendentes", Icon: FileText, tone: "success", href: "/orcamentos" },
    { label: "Pedidos", value: String(kpis.orders), note: "em andamento", Icon: ShoppingCart, tone: "info", href: "/pedidos" },
    { label: "Agenda", value: String(kpis.today), note: "hoje", Icon: CalendarCheck, tone: "violet", href: "/agenda" },
    kpis.receivable !== null
      ? { label: "A receber", value: kpis.receivable, note: kpis.receivableNote, Icon: CircleDollarSign, tone: "warning", href: "/financeiro/receber" }
      : { label: "Leads", value: String(kpis.leads), note: "novos", Icon: Users, tone: "warning", href: "/pipeline" },
  ];
  const actions = [
    { label: "Novo orçamento", href: "/orcamentos/calhas", Icon: Plus },
    { label: "Agendar medição", href: "/medicoes", Icon: CalendarPlus },
    { label: "Nova compra", href: "/compras/nova", Icon: ShoppingCart },
    { label: "Novo cliente", href: "/clientes/novo", Icon: Users },
  ];
  return (
    <div className="mobile-only mobile-home">
      <h1 className="mh-greeting">{greeting}, {name}</h1>
      <p className="mh-date">{dateLabel}</p>

      <div className="mh-kpis">
        {tiles.map(({ label, value, note, Icon, tone, href }) => (
          <Link key={label} href={href} className="mh-kpi">
            <span className="mh-kpi-icon" data-tone={tone}><Icon size={22} /></span>
            <span className="mh-kpi-text"><small>{label}</small><strong>{value}</strong><em>{note}</em></span>
          </Link>
        ))}
      </div>

      <h2 className="mh-title">Ações rápidas</h2>
      <div className="mh-actions">
        {actions.map(({ label, href, Icon }) => <Link key={label} href={href}><Icon size={26} strokeWidth={1.6} /><span>{label}</span></Link>)}
      </div>

      <div className="mh-section-head"><h2 className="mh-title"><CalendarCheck size={20} />Agenda de hoje</h2><Link href="/agenda">Ver agenda <ChevronRight size={15} /></Link></div>
      {today.length ? (
        <ul className="mh-list">
          {today.slice(0, 4).map(e => (
            <li key={`${e.source}-${e.id}`}>
              <AgendaEventLink eventId={e.id} source={e.source} className="mh-event">
                <span className="mh-time">{hhmm(e.starts_at)}</span>
                <span className="mh-event-text"><strong>{TYPE[e.event_type] ?? e.title}</strong><small>{e.client_name ? <><User size={14} />{e.client_name}</> : e.title}</small></span>
                <ChevronRight size={18} className="mh-chevron" />
              </AgendaEventLink>
            </li>
          ))}
        </ul>
      ) : <p className="mh-empty">Nenhum compromisso para hoje.</p>}

      {stages && <>
        <div className="mh-section-head"><h2 className="mh-title"><Layers size={20} />Pedidos em andamento</h2><Link href="/pedidos">Ver todos <ChevronRight size={15} /></Link></div>
        <div className="mh-stages">
          <Link href="/medicoes" data-stage="measure"><strong>{stages.measure}</strong><span>Medição</span></Link>
          <Link href="/producao" data-stage="production"><strong>{stages.production}</strong><span>Produção</span></Link>
          <Link href="/instalacoes" data-stage="install"><strong>{stages.install}</strong><span>Instalação</span></Link>
          <Link href="/servicos" data-stage="done" title="Serviços concluídos no mês"><strong>{stages.done}</strong><span>Concluídos</span></Link>
        </div>
      </>}
    </div>
  );
}
