"use server";

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { advanceProductionStep } from "@/app/(crm)/actions";
import { SubmitButton } from "@/components/submit-button";
import { shortDate, todayISO } from "@/lib/utils";

const STEPS_CALHAS = [
  "Medição",
  "Corte",
  "Dobra",
  "Pintura",
  "Agendamento",
  "Instalação",
  "Pós-venda",
];

const STEPS_ESQUADRIAS = [
  "Medição",
  "Projeto",
  "Corte",
  "Usinagem",
  "Montagem",
  "Solda",
  "Acabamento",
  "Pintura",
  "Controle de Qualidade",
];

// Fases do pos-pedido, na ordem em que o trabalho anda.
const PHASES = [
  { key: "novo", title: "A iniciar", hint: "Pedido fechado, produção ainda não começou" },
  { key: "fabricacao", title: "Em fabricação", hint: "Corte, dobra, pintura e montagem" },
  { key: "agendar", title: "Agendar instalação", hint: "Pronto: combinar a data com o cliente" },
  { key: "instalar", title: "Para instalar", hint: "Marque quando a instalação terminar" },
  { key: "posvenda", title: "Pós-venda", hint: "Instalado: conferir satisfação e pendências" },
  { key: "concluido", title: "Concluídos", hint: "Toque para ver" },
] as const;

function phaseOf(o: { flow_type: string; current_step: number; status: string }) {
  const total = o.flow_type === "esquadrias" ? STEPS_ESQUADRIAS.length : STEPS_CALHAS.length;
  if (o.current_step > total || o.status === "finalizado") return "concluido";
  if (o.current_step === 1 && o.status === "aguardando_material") return "novo";
  if (o.flow_type === "esquadrias") return "fabricacao";
  return o.current_step <= 4 ? "fabricacao" : o.current_step === 5 ? "agendar" : o.current_step === 6 ? "instalar" : "posvenda";
}

function stepList(flowType: string) {
  return flowType === "esquadrias" ? STEPS_ESQUADRIAS : STEPS_CALHAS;
}

type Order = {
  id: string;
  production_number: string;
  flow_type: string;
  current_step: number;
  status: string;
  planned_end: string | null;
  responsible: { full_name: string } | null;
  order: { id?: string; order_number: string; sale_id?: string | null; client?: { name: string; phone?: string | null; neighborhood?: string | null; city?: string | null } } | null;
};

type StepLog = {
  id: string;
  step_number: number;
  step_name: string;
  completed_at: string | null;
  notes: string | null;
  responsible: { full_name: string } | null;
};

export async function ProductionFlowPage({
  id,
  filter,
  error,
  search,
  aviso,
}: {
  id?: string;
  filter?: string;
  error?: string;
  search?: string;
  aviso?: string;
}) {
  const db = await createClient();

  if (id) {
    const [orderRes, logsRes, profilesRes] = await Promise.all([
      db
        .from("production_orders")
        .select(
          "id,production_number,flow_type,current_step,status,planned_start,planned_end,notes," +
            "responsible:profiles!production_orders_responsible_id_fkey(full_name)," +
            "order:orders(order_number,client:clients(name))"
        )
        .eq("id", id)
        .single(),
      db
        .from("production_step_logs")
        .select(
          "id,step_number,step_name,started_at,completed_at,notes," +
            "responsible:profiles!production_step_logs_responsible_id_fkey(full_name)"
        )
        .eq("production_order_id", id)
        .order("step_number"),
      db.from("profiles").select("id,full_name").eq("status", "ativo").order("full_name"),
    ]);

    const order = orderRes.data as unknown as Order & {
      planned_start: string | null;
      notes: string | null;
    };
    if (!order) {
      return <p className="card p-8">Ordem não encontrada</p>;
    }

    const logs = (logsRes.data ?? []) as unknown as StepLog[];
    const profiles = profilesRes.data ?? [];
    const steps = stepList(order.flow_type);
    const isFinished = order.current_step > steps.length;

    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/producao" className="text-sm font-bold text-ink/50 hover:text-ink">
            ← Produção
          </Link>
          <span className="text-ink/25">/</span>
          <span className="text-sm font-bold">{order.production_number}</span>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        {aviso && (
          <div role="status" className={`mb-4 rounded-xl p-3 text-sm ${aviso === "sent" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
            {aviso === "sent" ? "Cliente avisado pelo WhatsApp de que a instalação foi concluída." : "Etapa concluída, mas o aviso ao cliente não foi enviado (já avisado, sem telefone ou WhatsApp indisponível)."}
          </div>
        )}

        <div className="card mb-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-forest">
                {order.flow_type === "esquadrias" ? "Esquadrias" : "Calhas"}
              </p>
              <h1 className="mt-1 text-2xl font-black">{order.production_number}</h1>
              {order.order && (
                <p className="mt-1 text-sm text-ink/55">
                  Pedido {(order.order as { order_number: string }).order_number}
                  {(order.order as { client?: { name: string } }).client?.name &&
                    ` — ${(order.order as { client: { name: string } }).client.name}`}
                </p>
              )}
            </div>
            <span
              className={`rounded-xl px-3 py-1 text-xs font-bold ${
                isFinished
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {isFinished ? "Concluído" : `Etapa ${order.current_step}/${steps.length}`}
            </span>
          </div>
        </div>

        {/* Barra de progresso das etapas */}
        <div className="card mb-6 overflow-hidden">
          <div className="border-b p-4">
            <h2 className="font-bold">Fluxo de Produção</h2>
          </div>
          <div className="divide-y">
            {steps.map((stepName, i) => {
              const stepNum = i + 1;
              const log = logs.find((l) => l.step_number === stepNum);
              const isDone = stepNum < order.current_step || isFinished;
              const isCurrent = stepNum === order.current_step && !isFinished;

              return (
                <div
                  key={stepNum}
                  className={`flex items-center gap-4 p-4 ${isCurrent ? "bg-brand-strong/10" : ""}`}
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isDone
                        ? "bg-emerald-500 text-white"
                        : isCurrent
                        ? "bg-brand-strong text-white"
                        : "bg-sand text-ink/40"
                    }`}
                  >
                    {isDone ? "✓" : stepNum}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${!isDone && !isCurrent ? "text-ink/40" : ""}`}>
                      {stepName}
                    </p>
                    {log?.responsible && (
                      <p className="text-xs text-ink/50">
                        {log.responsible.full_name}
                        {log.completed_at &&
                          ` — ${new Date(log.completed_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`}
                      </p>
                    )}
                    {log?.notes && (
                      <p className="mt-0.5 text-xs text-ink/40">{log.notes}</p>
                    )}
                  </div>
                  {isCurrent && (
                    <span className="rounded-lg bg-brand-strong px-2 py-1 text-xs font-bold text-white">
                      Em andamento
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Avançar etapa */}
        {!isFinished && (
          <div className="card p-6">
            <h2 className="mb-4 font-bold">
              Concluir etapa {order.current_step}: {steps[order.current_step - 1]}
            </h2>
            <form action={advanceProductionStep} className="space-y-4">
              <input type="hidden" name="production_order_id" value={id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Responsável pela etapa</label>
                  <select name="responsible_id" className="field">
                    <option value="">Selecionar responsável</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Observações (opcional)</label>
                  <input
                    type="text"
                    name="notes"
                    className="field"
                    placeholder="Detalhe algum ponto..."
                  />
                </div>
              </div>
              <button type="submit" className="button">
                ✓ Concluir etapa e avançar
              </button>
            </form>
          </div>
        )}
        {isFinished && (
          <div className="card border-emerald-200 bg-emerald-50 p-6 text-center">
            <p className="text-lg font-black text-emerald-700">
              ✓ Produção concluída em {steps.length} etapas
            </p>
          </div>
        )}
      </div>
    );
  }

  // Lista: todos os pedidos fechados, organizados pela fase em que estao.
  const q = db
    .from("production_orders")
    .select(
      "id,production_number,flow_type,current_step,status,planned_end,created_at," +
        "responsible:profiles!production_orders_responsible_id_fkey(full_name)," +
        "order:orders(id,order_number,sale_id,client:clients(name,phone,neighborhood,city))"
    )
    .neq("status", "cancelado")
    .order("created_at", { ascending: false })
    .limit(150);

  const { data: orders } = filter ? await q.eq("flow_type", filter) : await q;
  const term = (search ?? "").trim().toLowerCase();
  const all = ((orders ?? []) as unknown as Order[]).filter((o) => !term
    || o.production_number.toLowerCase().includes(term)
    || (o.order?.order_number ?? "").toLowerCase().includes(term)
    || (o.order?.client?.name ?? "").toLowerCase().includes(term));
  const today = todayISO();
  const groups = PHASES.map((phase) => ({ ...phase, items: all.filter((o) => phaseOf(o) === phase.key) }));
  const open = all.filter((o) => phaseOf(o) !== "concluido");
  const late = open.filter((o) => o.planned_end && o.planned_end < today).length;
  const tabs: Array<[string, string]> = [["", "Todas"], ["calhas", "Calhas"], ["esquadrias", "Esquadrias"]];
  const notice = aviso === "sent" ? "Cliente avisado pelo WhatsApp de que a instalação foi concluída."
    : aviso === "failed" ? "Etapa concluída, mas o aviso ao cliente não foi enviado. Confira o WhatsApp no Atendimento."
    : aviso === "skipped" ? "Etapa concluída. O aviso ao cliente não foi enviado (já avisado, sem telefone ou WhatsApp não configurado)." : "";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-forest">Produção</p>
          <h1 className="mt-2 text-3xl font-black">Pedidos em produção</h1>
          <p className="mt-1 text-sm text-ink/50">Todo pedido fechado entra aqui sozinho e segue até o pós-venda.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map(([key, label]) => (
            <Link key={key} href={key ? `/producao?tipo=${key}` : "/producao"}
              className={`rounded-xl border px-4 py-2 text-sm font-bold ${(filter ?? "") === key ? "border-forest bg-brand-strong text-white" : "border-sand hover:bg-sand/50"}`}>
              {label}
            </Link>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className={`mb-4 rounded-xl p-3 text-sm ${aviso === "sent" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{notice}</p>}

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <div className="card p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Em aberto</p><p className="mt-1 text-2xl font-black">{open.length}</p></div>
        <div className="card p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/45">A iniciar</p><p className="mt-1 text-2xl font-black">{groups[0].items.length}</p></div>
        <div className="card p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Para instalar</p><p className="mt-1 text-2xl font-black">{groups[2].items.length + groups[3].items.length}</p></div>
        <div className={`card p-4 ${late ? "border-red-200" : ""}`}><p className={`text-xs font-bold uppercase tracking-wider ${late ? "text-red-600" : "text-ink/45"}`}>Atrasados</p><p className={`mt-1 text-2xl font-black ${late ? "text-red-700" : ""}`}>{late}</p></div>
      </div>

      <form method="get" className="mb-5 flex flex-wrap gap-2">
        {filter && <input type="hidden" name="tipo" value={filter} />}
        <input className="field max-w-sm" name="q" defaultValue={search ?? ""} placeholder="Buscar por cliente, pedido ou ordem" aria-label="Buscar pedido" />
        <button className="button-ghost">Buscar</button>
        {term && <Link href={filter ? `/producao?tipo=${filter}` : "/producao"} className="self-center text-sm font-bold text-ink/55 underline">Limpar</Link>}
      </form>

      {all.length === 0 && <div className="card p-10 text-center text-sm text-ink/40">Nenhum pedido em produção.</div>}

      <div className="space-y-6">
        {groups.filter((g) => g.items.length).map((group) => {
          const body = (
            <div className="grid gap-3 md:grid-cols-2">
              {group.items.map((order) => {
                const steps = stepList(order.flow_type);
                const finished = order.current_step > steps.length;
                const stepName = finished ? "Concluído" : steps[order.current_step - 1];
                const pct = finished ? 100 : Math.round(((order.current_step - 1) / steps.length) * 100);
                const overdue = !finished && !!order.planned_end && order.planned_end < today;
                const client = order.order?.client;
                const place = [client?.neighborhood, client?.city].filter(Boolean).join(" · ");
                const installing = order.flow_type !== "esquadrias" && order.current_step === 6;
                return (
                  <div key={order.id} className={`card p-4 ${overdue ? "border-red-200 bg-red-50/30" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-black">{client?.name ?? "Cliente não informado"}</p>
                        <p className="mt-0.5 text-xs text-ink/55">
                          {order.order?.order_number ? `Pedido ${order.order.order_number} · ` : ""}{order.production_number}{place ? ` · ${place}` : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-bold ${order.flow_type === "esquadrias" ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"}`}>
                        {order.flow_type === "esquadrias" ? "Esquadrias" : "Calhas"}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-bold">{finished ? "✓ Concluído" : `Etapa ${order.current_step}/${steps.length}: ${stepName}`}</p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sand">
                      <div className={`h-full rounded-full ${finished ? "bg-emerald-500" : overdue ? "bg-red-500" : "bg-brand-strong"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-2 text-xs text-ink/55">
                      {order.planned_end ? <span className={overdue ? "font-bold text-red-700" : ""}>Prazo {shortDate(order.planned_end)}{overdue ? " · atrasado" : ""}</span> : "Sem prazo definido"}
                      {order.responsible?.full_name ? ` · ${order.responsible.full_name}` : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {!finished && (
                        <form action={advanceProductionStep}>
                          <input type="hidden" name="production_order_id" value={order.id} />
                          <input type="hidden" name="_list" value="1" />
                          <SubmitButton className="button" pendingText="Salvando…">{installing ? "✓ Já foi instalado" : `✓ Concluir ${stepName}`}</SubmitButton>
                        </form>
                      )}
                      <Link href={`/producao/${order.id}`} className="button-ghost">Detalhes</Link>
                      {order.order?.sale_id && <Link href={`/vendas/${order.order.sale_id}`} className="button-ghost">Venda</Link>}
                    </div>
                    {installing && <p className="mt-2 text-xs text-ink/55">Ao marcar como instalado, o cliente recebe um aviso pelo WhatsApp.</p>}
                  </div>
                );
              })}
            </div>
          );
          const title = (
            <span className="flex items-center gap-2">
              <span className="text-lg font-black">{group.title}</span>
              <span className="rounded-full bg-sand px-2 py-0.5 text-xs font-bold">{group.items.length}</span>
              <span className="text-xs font-normal text-ink/50">{group.hint}</span>
            </span>
          );
          return group.key === "concluido"
            ? <details key={group.key}><summary className="mb-3 cursor-pointer list-none">{title}</summary>{body}</details>
            : <section key={group.key}><h2 className="mb-3">{title}</h2>{body}</section>;
        })}
      </div>
    </div>
  );
}
