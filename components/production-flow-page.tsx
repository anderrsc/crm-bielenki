"use server";

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { advanceProductionStep } from "@/app/(crm)/actions";
import { productionStepBack } from "@/app/(crm)/undo-actions";
import { ConfirmButton } from "@/components/confirm-button";
import { SubmitButton } from "@/components/submit-button";
import { shortDate, todayISO } from "@/lib/utils";
import { OP_STAGE_LABEL } from "@/components/order-operation-card";
import { ProductionStepPhotos } from "@/components/production-step-photos";
import { loadProductionStepPhotos } from "@/lib/production-photos";
import { NOBODY, isLate, matchesProduction, type ProductionItem } from "@/lib/service-board";

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
  { key: "medidas", title: "Medidas e liberação para corte", hint: "Falta conferir medidas ou confirmar o envio para corte" },
  { key: "novo", title: "A iniciar", hint: "Pedido fechado, produção ainda não começou" },
  { key: "fabricacao", title: "Em fabricação", hint: "Corte, dobra, pintura e montagem" },
  { key: "agendar", title: "Agendar instalação", hint: "Pronto: combinar a data com o cliente" },
  { key: "instalar", title: "Para instalar", hint: "Marque quando a instalação terminar" },
  { key: "posvenda", title: "Pós-venda", hint: "Instalado: conferir satisfação e pendências" },
  { key: "concluido", title: "Concluídos", hint: "Toque para ver" },
] as const;

function phaseOf(o: { flow_type: string; current_step: number; status: string; order?: { op_stage?: string | null } | null }) {
  const total = o.flow_type === "esquadrias" ? STEPS_ESQUADRIAS.length : STEPS_CALHAS.length;
  if (o.current_step > total || o.status === "finalizado") return "concluido";
  // Pedido novo ainda sem liberacao para corte: a producao espera.
  if (o.order?.op_stage && o.order.op_stage !== "liberado_corte") return "medidas";
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
  order: { id?: string; order_number: string; sale_id?: string | null; op_stage?: string | null; client?: { name: string; phone?: string | null; neighborhood?: string | null; city?: string | null } } | null;
};

type StepLog = {
  id: string;
  step_number: number;
  step_name: string;
  completed_at: string | null;
  notes: string | null;
  responsible: { full_name: string } | null;
};

const PHASE_COLOR: Record<string, string> = {
  medidas: "bg-amber-600", novo: "bg-gray-600", fabricacao: "bg-orange-600", agendar: "bg-blue-600",
  instalar: "bg-green-600", posvenda: "bg-teal-600", concluido: "bg-emerald-600",
};

export async function ProductionFlowPage({
  id,
  filter,
  error,
  search,
  aviso,
  person,
  from,
  to,
  late: onlyLate,
}: {
  id?: string;
  filter?: string;
  error?: string;
  search?: string;
  aviso?: string;
  person?: string;
  from?: string;
  to?: string;
  late?: boolean;
}) {
  const db = await createClient();

  if (id) {
    const [orderRes, logsRes, profilesRes, photos, photoPermission] = await Promise.all([
      db
        .from("production_orders")
        .select(
          "id,production_number,flow_type,current_step,status,planned_start,planned_end,notes," +
            "responsible:profiles!production_orders_responsible_id_fkey(full_name)," +
            "order:orders(order_number,sale_id,op_stage,client:clients(name))"
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
      loadProductionStepPhotos(db,id),
      db.rpc("has_table_access",{resource:"production_orders",action:"update"}),
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
    // Pedido novo ainda sem liberacao para corte: a producao espera a etapa de medidas.
    const waitingCut = !isFinished && !!order.order?.op_stage && order.order.op_stage !== "liberado_corte";

    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/producao" className="text-sm font-semibold text-ink/50 hover:text-ink">
            ← Produção
          </Link>
          <span className="text-ink/25">/</span>
          <span className="text-sm font-semibold">{order.production_number}</span>
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
              <p className="text-xs font-semibold text-forest">
                {order.flow_type === "esquadrias" ? "Esquadrias" : "Calhas"}
              </p>
              <h1 className="mt-1 text-2xl font-semibold">{order.production_number}</h1>
              {order.order && (
                <p className="mt-1 text-sm text-ink/55">
                  Pedido {(order.order as { order_number: string }).order_number}
                  {(order.order as { client?: { name: string } }).client?.name &&
                    ` — ${(order.order as { client: { name: string } }).client.name}`}
                </p>
              )}
            </div>
            <span
              className={`rounded-xl px-3 py-1 text-xs font-semibold ${
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
            <h2 className="font-semibold">Fluxo de Produção</h2>
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
                  className={`flex flex-wrap items-center gap-4 p-4 ${isCurrent ? "bg-brand-strong/10" : ""}`}
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
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
                    <span className="rounded-lg bg-brand-strong px-2 py-1 text-xs font-semibold text-white">
                      Em andamento
                    </span>
                  )}
                  {(log || isCurrent || photos.some(p=>p.step_number===stepNum)) && <div className="w-full">
                    <ProductionStepPhotos productionOrderId={id} orderId={order.order?.id??''} stepNumber={stepNum} stepName={stepName}
                      photos={photos} canEdit={photoPermission.data===true && order.status!=='cancelado' && !waitingCut && !!(log||isCurrent)} back={`/producao/${id}`} />
                  </div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Avançar etapa */}
        {waitingCut && (
          <div className="card border-amber-300 bg-amber-50/60 p-6">
            <p className="font-semibold">{OP_STAGE_LABEL[order.order?.op_stage ?? ""] ?? "Aguardando medidas"}</p>
            <p className="mt-1 text-sm">A produção começa depois que as medidas forem confirmadas e o pedido for liberado para corte.</p>
            {order.order?.sale_id && <Link href={`/vendas/${order.order.sale_id}#etapa-operacional`} className="button mt-4 inline-flex">Resolver etapa do pedido</Link>}
          </div>
        )}
        {!isFinished && !waitingCut && (
          <div className="card p-6">
            <h2 className="mb-4 font-semibold">
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
        {order.current_step > 1 && order.status !== "cancelado" && (
          <details className="card p-5">
            <summary className="cursor-pointer text-sm font-semibold text-ink/70">Concluiu etapa por engano? Voltar para a etapa {order.current_step - 1}: {steps[order.current_step - 2]}</summary>
            <form action={productionStepBack} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={id} />
              <input className="field flex-1" name="reason" aria-label="Motivo para voltar a etapa" placeholder="Motivo (ex.: corte precisa ser refeito)" required minLength={3} maxLength={500} />
              <ConfirmButton formAction={productionStepBack} className="button-ghost border border-sand" message={`Voltar a produção para a etapa ${order.current_step - 1}?`}>Voltar etapa</ConfirmButton>
            </form>
          </details>
        )}
        {isFinished && (
          <div className="card border-emerald-200 bg-emerald-50 p-6 text-center">
            <p className="text-lg font-semibold text-emerald-700">
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
        "order:orders(id,order_number,sale_id,op_stage,client:clients(name,phone,neighborhood,city))"
    )
    .neq("status", "cancelado")
    .order("created_at", { ascending: false })
    .limit(150);

  const { data: orders } = filter ? await q.eq("flow_type", filter) : await q;
  const rows = (orders ?? []) as unknown as Order[];
  // Quem trabalhou em cada ordem: o responsável dela e os responsáveis das etapas.
  const stepPeople = rows.length
    ? await db
        .from("production_step_logs")
        .select("production_order_id,responsible:profiles!production_step_logs_responsible_id_fkey(full_name)")
        .in("production_order_id", rows.map((o) => o.id))
        .not("responsible_id", "is", null)
    : null;
  const workers = new Map<string, string[]>();
  for (const log of (stepPeople?.data ?? []) as unknown as { production_order_id: string; responsible: { full_name: string } | null }[]) {
    if (log.responsible) workers.set(log.production_order_id, [...(workers.get(log.production_order_id) ?? []), log.responsible.full_name]);
  }
  const today = todayISO();
  const items = rows.map((order) => {
    const item: ProductionItem = {
      number: order.production_number,
      orderNumber: order.order?.order_number ?? "",
      client: order.order?.client?.name ?? "",
      people: [...new Set([order.responsible?.full_name, ...(workers.get(order.id) ?? [])].filter((n): n is string => !!n))],
      deadline: order.planned_end,
      finished: phaseOf(order) === "concluido",
    };
    return { order, item };
  });
  const peopleOptions = [...new Set(items.flatMap((i) => i.item.people))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const term = (search ?? "").trim();
  const filters = { search: term, person, from, to, late: onlyLate };
  const filtering = !!(term || person || from || to || onlyLate);
  const shown = items.filter((i) => matchesProduction(i.item, filters, today));
  const groups = PHASES.map((phase) => ({ ...phase, items: shown.filter((i) => phaseOf(i.order) === phase.key) }));
  const open = shown.filter((i) => !i.item.finished);
  const late = open.filter((i) => isLate(i.item, today)).length;
  const tabs: Array<[string, string]> = [["", "Todas"], ["calhas", "Calhas"], ["esquadrias", "Esquadrias"]];
  // Trocar de aba mantém os demais filtros.
  const tabHref = (tipo: string) => {
    const query = new URLSearchParams(Object.entries({ tipo, q: term, funcionario: person ?? "", de: from ?? "", ate: to ?? "", atrasados: onlyLate ? "1" : "" }).filter(([, v]) => v)).toString();
    return query ? `/producao?${query}` : "/producao";
  };
  const notice = aviso === "sent" ? "Cliente avisado pelo WhatsApp de que a instalação foi concluída."
    : aviso === "failed" ? "Etapa concluída, mas o aviso ao cliente não foi enviado. Confira o WhatsApp no Atendimento."
    : aviso === "skipped" ? "Etapa concluída. O aviso ao cliente não foi enviado (já avisado, sem telefone ou WhatsApp não configurado)." : "";

  return (
    <div className="mx-auto w-full">
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold text-forest">Produção</p>
          <h1 className="mt-2 text-3xl font-semibold">Pedidos em produção</h1>
          <p className="mt-1 text-sm text-ink/50">Todo pedido fechado entra aqui sozinho e anda de uma coluna para a outra até o pós-venda.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map(([key, label]) => (
            <Link key={key} href={tabHref(key)}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold ${(filter ?? "") === key ? "border-forest bg-brand-strong text-white" : "border-sand hover:bg-sand/50"}`}>
              {label}
            </Link>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className={`mb-4 rounded-xl p-3 text-sm ${aviso === "sent" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{notice}</p>}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4"><p className="text-xs font-semibold text-ink/45">Em aberto</p><p className="mt-1 text-2xl font-semibold">{open.length}</p></div>
        <div className="card p-4"><p className="text-xs font-semibold text-ink/45">Aguardando medidas ou corte</p><p className="mt-1 text-2xl font-semibold">{groups[0].items.length}</p></div>
        <div className="card p-4"><p className="text-xs font-semibold text-ink/45">Para instalar</p><p className="mt-1 text-2xl font-semibold">{groups[3].items.length + groups[4].items.length}</p></div>
        <div className={`card p-4 ${late ? "border-red-200" : ""}`}><p className={`text-xs font-semibold ${late ? "text-red-600" : "text-ink/45"}`}>Atrasados</p><p className={`mt-1 text-2xl font-semibold ${late ? "text-red-700" : ""}`}>{late}</p></div>
      </div>

      <form method="get" aria-label="Filtros da produção" key={[term, person, from, to, onlyLate].join("|")} className="card mb-5 grid items-end gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_1fr_1fr_auto]">
        {filter && <input type="hidden" name="tipo" value={filter} />}
        <label className="block"><span className="label">Buscar</span><input className="field" name="q" defaultValue={term} placeholder="Cliente, pedido ou ordem" aria-label="Buscar pedido" /></label>
        <label className="block"><span className="label">Funcionário</span>
          <select className="field" name="funcionario" defaultValue={person ?? ""}>
            <option value="">Todos os funcionários</option>
            {peopleOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            <option value={NOBODY}>Sem funcionário definido</option>
          </select>
        </label>
        <label className="block"><span className="label">Prazo de</span><input className="field" type="date" name="de" defaultValue={from ?? ""} /></label>
        <label className="block"><span className="label">Prazo até</span><input className="field" type="date" name="ate" defaultValue={to ?? ""} /></label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="atrasados" value="1" defaultChecked={!!onlyLate} /> Só atrasados</label>
          <button className="button">Filtrar</button>
          {filtering && <Link href={filter ? `/producao?tipo=${filter}` : "/producao"} className="text-sm font-semibold text-ink/55 underline">Limpar</Link>}
        </div>
      </form>

      {shown.length === 0 && <div className="card p-10 text-center text-sm text-ink/40">{filtering ? "Nenhum pedido com esses filtros." : "Nenhum pedido em produção."}</div>}

      {shown.length > 0 && <div data-testid="production-board" className="flex flex-col gap-3 md:flex-row md:items-start md:overflow-x-auto md:pb-3">
        {groups.map((group) => {
          const header = (
            <span className="block">
              <span className="flex items-center gap-2">
                <i aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${PHASE_COLOR[group.key]}`} />
                <span className="text-sm font-semibold">{group.title}</span>
                <span className="ml-auto rounded-full bg-sand px-2 py-0.5 text-xs font-semibold">{group.items.length}</span>
              </span>
              <span className="mt-1 block text-xs font-normal text-ink/50">{group.hint}</span>
            </span>
          );
          const body = (
            <div className="space-y-2 p-2 md:max-h-[70vh] md:overflow-y-auto">
              {group.items.map(({ order, item }) => <ProductionCard key={order.id} order={order} people={item.people} overdue={isLate(item, today)} waiting={group.key === "medidas"} />)}
              {!group.items.length && <p className="py-4 text-center text-xs text-ink/35">Vazio</p>}
            </div>
          );
          // No celular as colunas empilham, então as vazias somem.
          const box = `min-w-0 flex-1 rounded-2xl border bg-cream/40 md:min-w-[210px] ${group.items.length ? "" : "hidden md:block"}`;
          return group.key === "concluido"
            ? <details key={group.key} className={box}><summary className="cursor-pointer list-none rounded-t-2xl bg-surface p-3">{header}</summary>{body}</details>
            : <section key={group.key} aria-label={group.title} className={box}><h2 className="rounded-t-2xl border-b bg-surface p-3">{header}</h2>{body}</section>;
        })}
      </div>}
    </div>
  );
}

function ProductionCard({ order, people, overdue, waiting }: { order: Order; people: string[]; overdue: boolean; waiting: boolean }) {
  const steps = stepList(order.flow_type);
  const finished = order.current_step > steps.length;
  const stepName = finished ? "Concluído" : steps[order.current_step - 1];
  const pct = finished ? 100 : Math.round(((order.current_step - 1) / steps.length) * 100);
  const client = order.order?.client;
  const place = [client?.neighborhood, client?.city].filter(Boolean).join(" · ");
  const installing = order.flow_type !== "esquadrias" && order.current_step === 6;
  return (
    <article className={`rounded-xl border bg-surface p-3 shadow-sm ${overdue ? "border-red-400" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-semibold leading-snug">{client?.name ?? "Cliente não informado"}</p>
        <span className={`shrink-0 rounded-lg px-1.5 py-0.5 text-[11px] font-semibold ${order.flow_type === "esquadrias" ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"}`}>
          {order.flow_type === "esquadrias" ? "Esquadrias" : "Calhas"}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink/55">
        {order.order?.order_number ? `Pedido ${order.order.order_number} · ` : ""}{order.production_number}{place ? ` · ${place}` : ""}
      </p>
      <p className="mt-2 text-xs font-semibold">{waiting ? OP_STAGE_LABEL[order.order?.op_stage ?? ""] ?? "Aguardando medidas" : finished ? "✓ Concluído" : `Etapa ${order.current_step}/${steps.length}: ${stepName}`}</p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sand">
        <div className={`h-full rounded-full ${finished ? "bg-emerald-600" : overdue ? "bg-red-500" : "bg-brand-strong"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`mt-2 text-xs ${overdue ? "font-semibold text-red-700" : "text-ink/55"}`}>
        {order.planned_end ? `Prazo ${shortDate(order.planned_end)}${overdue ? " · atrasado" : ""}` : "Sem prazo definido"}
      </p>
      <p className={`mt-0.5 text-xs text-ink/55 ${people.length ? "" : "italic"}`}>{people.join(", ") || "Sem funcionário"}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {waiting && order.order?.sale_id && <Link href={`/vendas/${order.order.sale_id}#etapa-operacional`} className="button w-full justify-center">Resolver etapa</Link>}
        {!finished && !waiting && (
          <form action={advanceProductionStep} className="w-full">
            <input type="hidden" name="production_order_id" value={order.id} />
            <input type="hidden" name="_list" value="1" />
            <SubmitButton className="button w-full justify-center" pendingText="Salvando…">{installing ? "✓ Já foi instalado" : `✓ Concluir ${stepName}`}</SubmitButton>
          </form>
        )}
        <Link href={`/producao/${order.id}`} className="text-xs font-semibold text-forest underline">Detalhes</Link>
        {order.order?.sale_id && <Link href={`/vendas/${order.order.sale_id}`} className="text-xs font-semibold text-forest underline">Venda</Link>}
      </div>
      {installing && <p className="mt-2 text-xs text-ink/55">Ao marcar como instalado, o cliente recebe um aviso pelo WhatsApp.</p>}
    </article>
  );
}
