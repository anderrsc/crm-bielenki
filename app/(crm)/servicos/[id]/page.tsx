import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, MessageCircle, Phone } from "lucide-react";
import { getRequestClient } from "@/lib/supabase/server";
import { money, shortDate, todayISO } from "@/lib/utils";
import { friendlyError } from "@/lib/friendly-error";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { ServiceFields } from "@/components/service-fields";
import { SERVICE_CLASSIFICATIONS, SERVICE_KINDS, SERVICE_MANUAL_STATUS, SERVICE_PRIORITY, SERVICE_STATUS, isMaintenance, mapsLink, serviceOpen } from "@/lib/service-orders";
import { addServicePhotos, completeService, removeServicePhoto, scheduleService, setServiceStatus, updateService } from "@/app/(crm)/service-actions";

const when = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
const MOMENT: Record<string, string> = { antes: "Antes", depois: "Depois", geral: "Outras" };

export default async function ServiceDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const search = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getRequestClient();
  const [service, photos, people, canUpdate, logs] = await Promise.all([
    db.from("service_orders").select("*,client:clients(id,name,phone,whatsapp,address,neighborhood,city),order:orders(id,order_number,sale_id,created_at),responsible:profiles!service_orders_responsible_id_fkey(full_name),entry:financial_entries(id,total_amount,paid_amount,open_amount,status,due_date)").eq("id", id).maybeSingle(),
    db.from("service_photos").select("id,moment,original_name,created_at").eq("service_id", id).order("created_at"),
    db.from("profiles").select("id,full_name").eq("status", "ativo").order("full_name"),
    db.rpc("has_table_access", { resource: "service_orders", action: "update" }),
    db.from("audit_logs").select("action,created_at,new_data,profile:profiles(full_name)").eq("table_name", "service_orders").eq("record_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (service.error) return <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">Não foi possível carregar o serviço. Atualize a página.</p>;
  if (!service.data) notFound();
  type Client = { id: string; name: string; phone: string | null; whatsapp: string | null; address: string | null; neighborhood: string | null; city: string | null };
  const s = service.data as Record<string, any>;
  const client = s.client as Client | null;
  const order = s.order as { id: string; order_number: string; sale_id: string | null; created_at: string } | null;
  const entry = s.entry as { id: string; total_amount: number; paid_amount: number; open_amount: number; status: string; due_date: string | null } | null;
  const phone = (s.phone || client?.whatsapp || client?.phone || "") as string;
  const digits = phone.replace(/\D/g, "");
  const address = [s.address || client?.address, s.neighborhood || client?.neighborhood, s.city || client?.city];
  const map = mapsLink(address, s.location_url);
  const open = serviceOpen(s.status);
  const can = canUpdate.data === true;
  const peopleList = (people.data ?? []) as { id: string; full_name: string }[];
  const hidden = <input type="hidden" name="service_id" value={id} />;
  const photoList = (photos.data ?? []) as { id: string; moment: string; original_name: string }[];
  const history = (logs.data ?? []) as unknown as { action: string; created_at: string; new_data: Record<string, unknown> | null; profile: { full_name?: string } | null }[];

  return <div className="mx-auto max-w-4xl space-y-5">
    <Link href="/servicos" className="text-sm font-semibold text-forest underline">Voltar aos serviços</Link>
    {search.erro && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{friendlyError(search.erro)?.slice(0, 250)}</p>}
    {search.ok && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{search.ok.slice(0, 200)}</p>}

    <section className={`card p-5 sm:p-7 ${s.priority === "urgente" && open ? "border-red-300" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-xs font-semibold text-forest">{s.service_number} · {SERVICE_KINDS[s.kind] ?? s.kind}</p>
          <h1 className="mt-1 text-2xl font-semibold">{client?.name ?? "Cliente"}</h1></div>
        <span className={`rounded-lg px-3 py-1 text-sm font-semibold ${s.status === "concluido" ? "bg-emerald-50 text-emerald-700" : s.status === "cancelado" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-800"}`}>{SERVICE_STATUS[s.status] ?? s.status}</span>
      </div>
      <p className="mt-3 whitespace-pre-line text-sm">{s.description}</p>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink/65">
        <span>Prioridade <strong className={s.priority === "urgente" ? "text-red-700" : ""}>{SERVICE_PRIORITY[s.priority]}</strong></span>
        {s.classification && <span>{SERVICE_CLASSIFICATIONS[s.classification]}</span>}
        <span>Aberto em {shortDate(s.opened_at)}</span>
        {s.scheduled_at ? <span>Visita <strong>{when(s.scheduled_at)}</strong></span> : s.expected_date ? <span>Previsto {shortDate(s.expected_date)}</span> : <span>Sem data definida</span>}
        {(s.responsible?.full_name || s.team) && <span>{[s.responsible?.full_name, s.team].filter(Boolean).join(" · ")}</span>}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {digits && <a className="button-ghost" href={`tel:${digits}`}><Phone className="h-4 w-4" /> {phone}</a>}
        {digits.length >= 10 && <a className="button-ghost" target="_blank" rel="noreferrer" href={`https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`}><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
        {map && <a className="button-ghost" target="_blank" rel="noreferrer" href={map}><MapPin className="h-4 w-4" /> {address.filter(Boolean).join(", ") || "Abrir localização"}</a>}
        {client && <Link className="button-ghost" href={`/clientes/${client.id}`}>Cliente</Link>}
        {order?.sale_id && <Link className="button-ghost" href={`/vendas/${order.sale_id}`}>Pedido {order.order_number}</Link>}
      </div>
      {isMaintenance(s.kind) && order && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Ligado ao pedido {order.order_number}, de {shortDate(order.created_at)}. Isso não garante cobertura: confira as condições de garantia do contrato e defina a classificação {s.classification ? `(atual: ${SERVICE_CLASSIFICATIONS[s.classification]})` : "em “Editar dados”"}.</p>}
      {s.internal_notes && <p className="mt-3 text-sm"><strong>Observações internas:</strong> {s.internal_notes}</p>}
    </section>

    {s.status === "concluido" && <section className="card border-emerald-200 p-5 sm:p-7">
      <h2 className="text-xl font-semibold">Serviço concluído</h2>
      <p className="mt-2 text-sm">{s.completed_at ? `Concluído em ${when(s.completed_at)}.` : ""} {s.completion_notes}</p>
      {s.materials_used && <p className="mt-2 text-sm"><strong>Materiais:</strong> {s.materials_used}</p>}
      <p className="mt-2 text-sm">{s.billing === "gratuito" ? "Serviço gratuito: sem cobrança." : <>Valor final <strong>{money(s.final_amount ?? 0)}</strong>{Number(s.extra_expenses) > 0 ? ` · despesas ${money(s.extra_expenses)}` : ""}.</>}</p>
      {entry && <p className="mt-2 text-sm">Conta a receber: {money(entry.total_amount)} · recebido {money(entry.paid_amount)} · em aberto {money(entry.open_amount)}{entry.due_date ? ` · vence ${shortDate(entry.due_date)}` : ""}. <Link className="font-semibold underline" href={`/financeiro/receber?q=${encodeURIComponent(`Serviço ${s.service_number}`)}`}>Ver no financeiro</Link></p>}
    </section>}

    {can && open && <section className="card space-y-5 p-5 sm:p-7">
      <h2 className="text-xl font-semibold">Atualizar andamento</h2>
      <form action={setServiceStatus} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">{hidden}
        <label><span className="label">Nova situação</span><select name="status" className="field" required defaultValue=""><option value="" disabled>Escolha…</option>{SERVICE_MANUAL_STATUS.filter((k) => k !== s.status).map((k) => <option key={k} value={k}>{SERVICE_STATUS[k]}</option>)}</select></label>
        <label><span className="label">Observação (opcional)</span><input name="notes" className="field" maxLength={500} /></label>
        <SubmitButton className="button self-end">Salvar</SubmitButton>
      </form>
      <details open={!s.scheduled_at && ["aguardando_agendamento", "solicitacao_recebida", "necessita_retorno"].includes(s.status)}><summary className="cursor-pointer text-sm font-semibold">{s.scheduled_at ? "Reagendar visita" : "Agendar visita"}</summary>
        <form action={scheduleService} className="mt-3 grid gap-3 sm:grid-cols-2">{hidden}
          <label><span className="label">Data</span><input type="date" name="date" className="field" required min={todayISO()} /></label>
          <label><span className="label">Horário</span><input type="time" name="time" className="field" defaultValue="08:00" required /></label>
          <label><span className="label">Responsável</span><select name="responsible_id" className="field" defaultValue={s.responsible_id ?? ""}><option value="">Não definido</option>{peopleList.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
          <label><span className="label">Equipe</span><input name="team" className="field" maxLength={120} defaultValue={s.team ?? ""} /></label>
          <label className="sm:col-span-2"><span className="label">Observações</span><input name="notes" className="field" maxLength={500} /></label>
          <SubmitButton className="button sm:col-span-2">Salvar agendamento</SubmitButton>
        </form>
      </details>
      <details><summary className="cursor-pointer text-sm font-semibold">Concluir serviço</summary>
        <form action={completeService} className="mt-3 grid gap-3 sm:grid-cols-2">{hidden}
          <label className="sm:col-span-2"><span className="label">O que foi executado</span><textarea name="done" className="field min-h-20" required maxLength={2000} /></label>
          <label className="sm:col-span-2"><span className="label">Materiais utilizados</span><input name="materials_used" className="field" maxLength={2000} defaultValue={s.materials_used ?? ""} /></label>
          <label><span className="label">Despesas adicionais</span><input name="extra_expenses" className="field" inputMode="decimal" placeholder="0,00" /></label>
          {s.billing === "cobrado" ? <>
            <label><span className="label">Valor final a cobrar</span><input name="final_amount" className="field" inputMode="decimal" placeholder="0,00" defaultValue={s.expected_amount === null ? "" : Number(s.expected_amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} /></label>
            <label><span className="label">Vencimento da cobrança</span><input type="date" name="due_date" className="field" defaultValue={todayISO()} /></label>
            <p className="self-end text-xs text-ink/55">Com valor maior que zero, é criada uma conta a receber no Financeiro (uma só por serviço).</p>
          </> : <p className="text-xs text-ink/55 sm:col-span-2">Serviço gratuito: nenhuma cobrança será criada.</p>}
          <ConfirmButton formAction={completeService} className="button sm:col-span-2" message="Confirmar a conclusão deste serviço?">Confirmar conclusão</ConfirmButton>
        </form>
      </details>
    </section>}

    <section id="fotos" className="card scroll-mt-28 space-y-4 p-5 sm:p-7">
      <h2 className="text-xl font-semibold">Fotos <span className="rounded-full bg-sand px-2 py-0.5 text-xs">{photoList.length}</span></h2>
      {(["antes", "depois", "geral"] as const).map((m) => { const list = photoList.filter((p) => p.moment === m); return list.length ? <div key={m}><p className="mb-2 text-sm font-semibold">{MOMENT[m]}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{list.map((p) => <div key={p.id} className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <a href={`/api/servicos/foto/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/servicos/foto/${p.id}`} alt={`Foto ${MOMENT[m].toLowerCase()} do serviço`} loading="lazy" className="aspect-square w-full rounded-xl object-cover" /></a>
          {can && <form><input type="hidden" name="service_id" value={id} /><input type="hidden" name="photo_id" value={p.id} /><ConfirmButton formAction={removeServicePhoto} className="text-xs font-semibold text-red-700 underline" message="Remover esta foto?">Remover</ConfirmButton></form>}
        </div>)}</div></div> : null; })}
      {!photoList.length && <p className="text-sm text-ink/55">Nenhuma foto ainda.</p>}
      {can && <form action={addServicePhotos} className="flex flex-wrap items-end gap-3 border-t pt-4">{hidden}
        <label><span className="label">Momento</span><select name="moment" className="field" defaultValue={s.status === "concluido" ? "depois" : "antes"}><option value="antes">Antes</option><option value="depois">Depois</option><option value="geral">Outras</option></select></label>
        <label><span className="label">Fotos (até 6)</span><input type="file" name="photos" accept="image/*" multiple className="field" required /></label>
        <SubmitButton className="button-ghost" pendingText="Enviando…">Enviar fotos</SubmitButton>
      </form>}
    </section>

    {can && <details className="card p-5 sm:p-7"><summary className="cursor-pointer text-lg font-semibold">Editar dados</summary>
      <form action={updateService} className="mt-4 space-y-6">{hidden}
        <ServiceFields people={peopleList} value={s} />
        <SubmitButton className="button">Salvar dados</SubmitButton>
      </form>
    </details>}

    {history.length > 0 && <details className="card p-5"><summary className="cursor-pointer text-sm font-semibold">Histórico ({history.length})</summary>
      <ul className="mt-3 space-y-2 text-sm">{history.map((h, i) => <li key={i}><strong>{h.action === "AGENDADO" ? "Visita agendada" : h.action === "CONCLUIDO" ? "Serviço concluído" : `Situação: ${SERVICE_STATUS[String(h.new_data?.status)] ?? "atualizada"}`}</strong>{h.new_data?.observacoes ? `: ${String(h.new_data.observacoes)}` : ""}<span className="text-ink/55"> · {h.profile?.full_name ?? "Usuário"} · {when(h.created_at)}</span></li>)}</ul>
    </details>}
  </div>;
}
