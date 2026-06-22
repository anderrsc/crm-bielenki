"use server";

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { advanceProductionStep } from "@/app/(crm)/actions";

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
  order: { order_number: string; client?: { name: string } } | null;
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
}: {
  id?: string;
  filter?: string;
  error?: string;
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
                  className={`flex items-center gap-4 p-4 ${isCurrent ? "bg-lime/10" : ""}`}
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isDone
                        ? "bg-emerald-500 text-white"
                        : isCurrent
                        ? "bg-forest text-white"
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
                          ` — ${new Date(log.completed_at).toLocaleDateString("pt-BR")}`}
                      </p>
                    )}
                    {log?.notes && (
                      <p className="mt-0.5 text-xs text-ink/40">{log.notes}</p>
                    )}
                  </div>
                  {isCurrent && (
                    <span className="rounded-lg bg-forest px-2 py-1 text-xs font-bold text-white">
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

  // Lista de ordens de produção
  const q = db
    .from("production_orders")
    .select(
      "id,production_number,flow_type,current_step,status,planned_end," +
        "responsible:profiles!production_orders_responsible_id_fkey(full_name)," +
        "order:orders(order_number,client:clients(name))"
    )
    .neq("status", "cancelado")
    .order("created_at", { ascending: false })
    .limit(60);

  const { data: orders } = filter
    ? await q.eq("flow_type", filter)
    : await q;

  const list = (orders ?? []) as unknown as Order[];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-forest">Produção</p>
          <h1 className="mt-2 text-3xl font-black">Fluxo de Produção</h1>
          <p className="mt-1 text-sm text-ink/50">
            Ordens de calhas (7 etapas) e esquadrias (9 etapas)
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/producao"
            className={`rounded-xl border px-4 py-2 text-sm font-bold ${
              !filter ? "border-forest bg-forest text-white" : "border-sand hover:bg-sand/50"
            }`}
          >
            Todas
          </Link>
          <Link
            href="/producao?tipo=calhas"
            className={`rounded-xl border px-4 py-2 text-sm font-bold ${
              filter === "calhas" ? "border-forest bg-forest text-white" : "border-sand hover:bg-sand/50"
            }`}
          >
            Calhas
          </Link>
          <Link
            href="/producao?tipo=esquadrias"
            className={`rounded-xl border px-4 py-2 text-sm font-bold ${
              filter === "esquadrias"
                ? "border-forest bg-forest text-white"
                : "border-sand hover:bg-sand/50"
            }`}
          >
            Esquadrias
          </Link>
        </div>
      </div>

      <div className="space-y-3">
        {list.length === 0 && (
          <div className="card p-10 text-center text-sm text-ink/40">
            Nenhuma ordem de produção ativa.
          </div>
        )}
        {list.map((order) => {
          const steps = stepList(order.flow_type);
          const isFinished = order.current_step > steps.length;
          const pct = isFinished
            ? 100
            : Math.round(((order.current_step - 1) / steps.length) * 100);
          const currentStepName = isFinished
            ? "Concluído"
            : steps[order.current_step - 1];
          const isOverdue =
            order.planned_end &&
            !isFinished &&
            new Date(order.planned_end) < new Date();

          return (
            <Link
              key={order.id}
              href={`/producao/${order.id}`}
              className={`card flex items-center gap-4 p-4 transition hover:shadow-soft ${
                isOverdue ? "border-red-200 bg-red-50/30" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{order.production_number}</span>
                  <span
                    className={`rounded-lg px-2 py-0.5 text-xs font-bold ${
                      order.flow_type === "esquadrias"
                        ? "bg-violet-50 text-violet-700"
                        : "bg-blue-50 text-blue-700"
                    }`}
                  >
                    {order.flow_type === "esquadrias" ? "Esquadrias" : "Calhas"}
                  </span>
                  {isOverdue && (
                    <span className="rounded-lg bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">
                      Atrasado
                    </span>
                  )}
                </div>
                {order.order && (
                  <p className="mt-0.5 text-xs text-ink/50">
                    Pedido {(order.order as { order_number: string }).order_number}
                    {(order.order as { client?: { name: string } }).client?.name &&
                      ` — ${(order.order as { client: { name: string } }).client.name}`}
                  </p>
                )}
                <p className="mt-1 text-xs font-medium text-ink/60">
                  {isFinished ? "✓ Concluído" : `Etapa ${order.current_step}/${steps.length}: ${currentStepName}`}
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sand">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isFinished ? "bg-emerald-500" : isOverdue ? "bg-red-500" : "bg-forest"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div className="text-right text-xs text-ink/40">
                {order.planned_end
                  ? new Date(order.planned_end).toLocaleDateString("pt-BR")
                  : "—"}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
