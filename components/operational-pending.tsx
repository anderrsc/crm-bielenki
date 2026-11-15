import Link from "next/link";
import { MapPin, Phone } from "lucide-react";
import { getRequestClient } from "@/lib/supabase/server";
import { shortDate } from "@/lib/utils";

type Row = { order_id: string; order_number: string; sale_id: string | null; op_stage: string; client_name: string | null; phone: string | null; address: string | null; check_status: string | null; scheduled_at: string | null; responsible_name: string | null };

const GROUPS: { key: string; title: string; hint: string; match: (r: Row) => boolean }[] = [
  { key: "decisao", title: "Definir se precisa conferir medidas", hint: "Pedido fechado ainda sem resposta", match: (r) => r.op_stage === "aguardando_decisao" },
  { key: "agendar", title: "Conferências de medidas sem data", hint: "Falta agendar a visita", match: (r) => r.op_stage === "aguardando_conferencia" && r.check_status !== "agendada" },
  { key: "agendadas", title: "Conferências de medidas agendadas", hint: "Registrar o resultado depois da visita", match: (r) => r.op_stage === "aguardando_conferencia" && r.check_status === "agendada" },
  { key: "validar", title: "Medidas alteradas ou orçamento a revisar", hint: "Aguardando a gerência", match: (r) => r.op_stage === "aguardando_validacao" || r.op_stage === "revisar_orcamento" },
  { key: "corte", title: "Aguardando liberação para corte", hint: "Medidas confirmadas", match: (r) => r.op_stage === "aguardando_liberacao_corte" },
];
const time = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Pendencias operacionais que ainda nao tem data: ficam separadas dos compromissos agendados. */
export async function OperationalPending() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const db = await getRequestClient();
  const { data, error } = await db.from("v_order_pending").select("order_id,order_number,sale_id,op_stage,client_name,phone,address,check_status,scheduled_at,responsible_name").order("op_stage_at").limit(200);
  // Banco sem a migration ou usuario sem acesso a pedidos: a Agenda segue normal.
  if (error || !data?.length) return null;
  const rows = data as Row[];
  return <section className="mb-6 rounded-2xl border border-amber-300 bg-amber-50/60 p-4 sm:p-5" aria-label="Pendências operacionais">
    <h2 className="text-lg font-black">Pendências operacionais <span className="rounded-full bg-surface px-2 py-0.5 text-xs">{rows.length}</span></h2>
    <p className="text-xs text-ink/60">Tarefas de pedidos fechados que ainda não são compromissos com data. Elas saem daqui quando forem resolvidas.</p>
    <div className="mt-3 space-y-3">
      {GROUPS.map((g) => ({ ...g, items: rows.filter(g.match) })).filter((g) => g.items.length).map((g) => <details key={g.key} open={g.items.length <= 6} className="rounded-xl bg-surface p-3">
        <summary className="cursor-pointer text-sm font-bold">{g.title} <span className="rounded-full bg-sand px-2 py-0.5 text-xs">{g.items.length}</span> <span className="font-normal text-ink/55">· {g.hint}</span></summary>
        <ul className="mt-2 divide-y divide-sand/70">
          {g.items.map((r) => <li key={r.order_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-bold">{r.client_name ?? "Cliente"} <span className="font-normal text-ink/55">· Pedido {r.order_number}</span></p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/60">
                {r.scheduled_at && <span className="font-bold text-ink">{shortDate(r.scheduled_at)} às {time(r.scheduled_at)}{r.responsible_name ? ` · ${r.responsible_name}` : ""}</span>}
                {r.phone && <a className="inline-flex items-center gap-1 underline" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}><Phone size={12} />{r.phone}</a>}
                {r.address && <a className="inline-flex items-center gap-1 underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.address)}`}><MapPin size={12} />{r.address}</a>}
              </p>
            </div>
            {r.sale_id && <Link className="button-ghost" href={`/vendas/${r.sale_id}#etapa-operacional`}>Abrir pedido</Link>}
          </li>)}
        </ul>
      </details>)}
    </div>
  </section>;
}
