import { statusLabel } from "@/lib/status-label";
import Link from "next/link";
import { ArrowLeft, Check, Circle, Clock3, ClipboardPenLine } from "lucide-react";
import { deactivateClient, deleteClientRecord, toggleChecklistItem } from "@/app/(crm)/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { ModuleConfig } from "@/lib/modules";
import { getRequestClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";
import { OrderProductionPhotos } from "./order-production-photos";

export async function DetailPage({ config, id, error: actionError, base }: { config: ModuleConfig; id: string; subpage?: string; error?: string; base?: string }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <Missing />;
  const db = await getRequestClient();
  const [{ data, error }, checklistResult] = await Promise.all([
    db.from(config.table).select(config.table === "clients" ? `${config.select},address,neighborhood,postal_code` : config.select).eq("id", id).single(),
    config.table === "v_order_overview"
      ? db.from("order_checklist_items").select("id,title,status,due_date,completed_at,notes,responsible:profiles(full_name),sort_order").eq("order_id", id).order("sort_order")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (error || !data) return <Missing message={error?.message} />;
  const record = data as unknown as Record<string, unknown>;
  const checklist = (checklistResult.data as unknown as Record<string, unknown>[]) ?? [];
  const title = String(record.name ?? record.order_number ?? record.sale_number ?? record.quote_number ?? config.singular);

  const postalCode = typeof record.postal_code === "string" ? record.postal_code.replace(/^(\d{5})(\d{3})$/, "$1-$2") : "";
  const clientAddress = config.table === "clients"
    ? [record.address, record.neighborhood, [record.city, record.state].filter(Boolean).join(" / "), postalCode].filter(Boolean).join(" · ")
    : "";

  return <div className="mx-auto max-w-6xl">
    <Link href={`/${base ?? config.title.toLowerCase()}`} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-ink/55"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
    {actionError && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
    <div className="mh-hero is-simple detail-hero">
      <div className="mh-hero-main"><p className="detail-kind">{config.singular}</p><h1 className="mh-greeting">{title}</h1></div>
      {config.table === "clients" && <div className="no-print detail-actions"><Link href={`/clientes/${id}/editar`} className="button-ghost">Editar cliente</Link><Link href={`/clientes/${id}/ficha-visita`} className="button"><ClipboardPenLine className="h-4 w-4" /> Emitir ficha de visita</Link><form><input type="hidden" name="id" value={id}/><ConfirmButton formAction={deactivateClient} message="Desativar este cliente?" className="button-ghost text-red-700">Desativar</ConfirmButton></form><form><input type="hidden" name="id" value={id}/><ConfirmButton formAction={deleteClientRecord} message="Apagar este cliente de vez? Esta ação não pode ser desfeita. Clientes com orçamento, venda ou lançamento no financeiro não podem ser apagados (use Desativar)." className="button-ghost text-red-700">Apagar cliente</ConfirmButton></form></div>}
    </div>
    <div className="detail-grid">{config.columns.slice(0, 8).map((column) => <div className="detail-tile" key={column.key}><p className="detail-label">{column.label}</p><p className="detail-value">{format(get(record, column.key), column.kind)}</p></div>)}
      {clientAddress && <div className="detail-tile detail-wide"><p className="detail-label">Endereço</p><p className="detail-value">{clientAddress}</p></div>}
    </div>
    {config.table === "v_order_overview" && <OrderAluminumCost orderId={id} />}
    {config.table === "v_order_overview" && <OrderProductionPhotos orderId={id} />}
    {config.table === "v_order_overview" && <div id="checklist-operacional" className="card mt-5 scroll-mt-28 overflow-hidden">
      <div className="border-b p-5"><h2 className="font-semibold">Checklist operacional</h2><p className="text-xs text-ink/45">{checklist.filter((x) => x.status === "concluido").length} de {checklist.length} etapas concluídas</p></div>
      <div className="divide-y">{checklist.length ? checklist.map((item) => <form action={toggleChecklistItem} className="flex items-center gap-4 p-4" key={String(item.id)}>
        <input type="hidden" name="id" value={String(item.id)} /><input type="hidden" name="order_id" value={id} /><input type="hidden" name="status" value={String(item.status)} />
        <button className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${item.status === "concluido" ? "bg-brand-strong text-white" : "border bg-surface"}`}>{item.status === "concluido" ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4 text-ink/25" />}</button>
        <div className="min-w-0 flex-1"><p className="font-semibold">{String(item.title)}</p><p className="text-xs text-ink/40">{String((item.responsible as { full_name?: string })?.full_name ?? "Sem responsável")}</p></div>
        <span className="flex items-center gap-1 text-xs text-ink/45"><Clock3 className="h-3.5 w-3.5" />{shortDate(item.due_date as string)}</span>
      </form>) : <p className="p-8 text-center text-sm text-ink/45">Checklist ainda não gerado.</p>}</div>
    </div>}
  </div>;
}

const get = (row: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, row);
const format = (value: unknown, kind?: string) => kind === "money" ? money(value as number) : kind === "date" ? shortDate(value as string) : kind === "status" ? statusLabel(String(value ?? "-")) : String(value ?? "-").replaceAll("_", " ");
function Missing({ message }: { message?: string }) { return <div className="card mx-auto max-w-2xl p-8"><h1 className="text-2xl font-semibold">Registro não encontrado</h1><p className="mt-2 text-sm text-ink/50">{message ?? "Configure o Supabase e execute as migrações para consultar este registro."}</p></div>; }
import { OrderAluminumCost } from "./aluminum-cost-summary";
