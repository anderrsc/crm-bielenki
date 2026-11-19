// Linha do tempo auditável (quem, o quê, quando), mais recente primeiro. Sem animação: é registro.
export type TimelineEvent = { action: string; at: string; who: string | null; detail: string | null };
const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative mt-4 space-y-4 border-l border-sand pl-5">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span aria-hidden className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${i === 0 ? "bg-forest" : "bg-ink/30"}`} />
          <p className="text-sm"><strong>{e.action}</strong>{e.detail ? <span className="text-ink/75">: {e.detail}</span> : null}</p>
          <p className="text-xs text-ink/55">{e.who ?? "Usuário"} · <time dateTime={e.at}>{fmt.format(new Date(e.at))}</time></p>
        </li>
      ))}
    </ol>
  );
}
