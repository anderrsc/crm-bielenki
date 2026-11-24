import Link from "next/link";
import { AgendaEventLink } from "@/components/agenda-event-link";
import type { AgendaSource } from "@/lib/agenda";
import { ArrowUpRight, CalendarCheck, CalendarPlus, ChevronRight, CircleDollarSign, FileText, Layers, Plus, Ruler, ShoppingCart, Users, Wrench } from "lucide-react";

type TodayEvent = { id: string; source?: AgendaSource; title: string; starts_at: string; event_type: string; client_name?: string };
export type MobileHomeProps = {
  name: string; greeting: string; dateLabel: string;
  hero: { label: string; value: string; note: string; bars: { label: string; value: number; current: boolean }[] };
  kpis: { quotes: number; orders: number; today: number; receivable: string | null; receivableNote: string; leads: number };
  today: TodayEvent[];
  stages: { measure: number; production: number; install: number; done: number } | null;
};

/** "R$ 4.540,00" -> parte inteira grande e centavos pequenos (como nas referências). */
function Money({ text }: { text: string }) {
  const i = text.lastIndexOf(",");
  return i < 0 ? <>{text}</> : <>{text.slice(0, i)}<span className="mh-cents">{text.slice(i)}</span></>;
}
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const TYPE: Record<string, string> = { medicao: "Medição", instalacao: "Instalação", visita: "Visita", reuniao: "Reunião", entrega: "Entrega" };

/** Início no celular, na organização das referências: saudação, 4 indicadores, ações rápidas, agenda de hoje e pedidos em andamento. */
export function MobileHome({ name, greeting, dateLabel, hero, kpis, today, stages }: MobileHomeProps) {
  const top = Math.max(1, ...hero.bars.map(b => b.value));
  const tiles = [
    { label: "Orçamentos", value: String(kpis.quotes), note: "pendentes", Icon: FileText, tone: "success", href: "/orcamentos" },
    { label: "Pedidos", value: String(kpis.orders), note: "em andamento", Icon: ShoppingCart, tone: "info", href: "/pedidos" },
    { label: "Agenda", value: String(kpis.today), note: "hoje", Icon: CalendarCheck, tone: "violet", href: "/agenda" },
    kpis.receivable !== null
      ? { label: "A receber", value: kpis.receivable, note: kpis.receivableNote, Icon: CircleDollarSign, tone: "warning", href: "/financeiro/receber" }
      : { label: "Leads", value: String(kpis.leads), note: "novos", Icon: Users, tone: "warning", href: "/pipeline" },
  ];
  const actions = [
    { label: "Orçamento", href: "/orcamentos/calhas", Icon: Plus },
    { label: "Agendar", href: "/medicoes", Icon: CalendarPlus },
    { label: "Compra", href: "/compras/nova", Icon: ShoppingCart },
    { label: "Cliente", href: "/clientes/novo", Icon: Users },
  ];
  return (
    <div className="mobile-only mobile-home">
      <section className="mh-hero" aria-label="Resumo do mês">
        <h1 className="mh-greeting">{greeting}, {name}</h1>
        <p className="mh-date">{dateLabel}</p>
        <div className="mh-hero-card">
          <p className="mh-hero-label">{hero.label}</p>
          <p className="mh-hero-value"><Money text={hero.value} /></p>
          <p className="mh-hero-note">{hero.note}</p>
          {hero.bars.length > 0 && (
            <div className="mh-bars" role="img" aria-label={hero.bars.map(b => `${b.label}: ${b.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`).join("; ")}>
              {hero.bars.map(b => (
                <div key={b.label} className="mh-bar-col" data-current={b.current ? "true" : undefined}>
                  <i style={{ height: `${Math.max(6, Math.round((b.value / top) * 100))}%` }} />
                  <span>{b.label}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mh-circles">
            {actions.map(({ label, href, Icon }) => <Link key={label} href={href}><span><Icon size={22} /></span>{label}</Link>)}
          </div>
        </div>
      </section>

      <div className="mh-kpis">
        {tiles.map(({ label, value, note, Icon, tone, href }) => (
          <Link key={label} href={href} className="mh-kpi" data-tone={tone}>
            <span className="mh-kpi-top"><small><Icon size={16} />{label}</small><ArrowUpRight size={18} aria-hidden /></span>
            <span className="mh-kpi-value"><strong className={value.length > 8 ? "is-long" : undefined}>{value}</strong><em>{note}</em></span>
          </Link>
        ))}
      </div>

      <div className="mh-section-head"><h2 className="mh-title"><CalendarCheck size={20} />Agenda de hoje</h2><Link href="/agenda">Ver agenda <ChevronRight size={15} /></Link></div>
      {today.length ? (
        <ul className="mh-list">
          {today.slice(0, 4).map(e => (
            <li key={`${e.source}-${e.id}`}>
              <AgendaEventLink eventId={e.id} source={e.source} className="mh-event">
                <span className="mh-event-icon">{e.event_type === "medicao" ? <Ruler size={20} /> : e.event_type === "instalacao" ? <Wrench size={20} /> : <CalendarCheck size={20} />}</span>
                <span className="mh-event-text"><strong>{TYPE[e.event_type] ?? e.title}</strong><small>{e.client_name ?? e.title}</small></span>
                <span className="mh-event-time"><b>{hhmm(e.starts_at)}</b><small>hoje</small></span>
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
