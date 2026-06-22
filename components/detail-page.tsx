import Link from "next/link";
import { ArrowLeft, Check, Circle, Clock3, ClipboardPenLine } from "lucide-react";
import { deactivateClient, toggleChecklistItem } from "@/app/(crm)/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { ModuleConfig } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";

export async function DetailPage({ config, id }: { config: ModuleConfig; id: string; subpage?: string }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <Missing />;
  const db = await createClient();
  const { data, error } = await db.from(config.table).select(config.select).eq("id", id).single();
  if (error || !data) return <Missing message={error?.message} />;

  const record = data as unknown as Record<string, unknown>;
  let checklist: Record<string, unknown>[] = [];
  if (config.table === "v_order_overview") {
    const result = await db.from("order_checklist_items")
      .select("id,title,status,due_date,completed_at,notes,responsible:profiles(full_name),sort_order")
      .eq("order_id", id).order("sort_order");
    checklist = (result.data as unknown as Record<string, unknown>[]) ?? [];
  }
  const title = String(record.name ?? record.order_number ?? record.sale_number ?? record.quote_number ?? config.singular);

  return <div className="mx-auto max-w-6xl">
    <Link href={`/${config.title.toLowerCase()}`} className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
    <div className="card p-6 lg:p-8">
      {config.table === "clients" && <div className="no-print mb-5 flex flex-wrap justify-end gap-2"><Link href={`/clientes/${id}/editar`} className="button-ghost">Editar cliente</Link><Link href={`/clientes/${id}/ficha-visita`} className="button"><ClipboardPenLine className="h-4 w-4" /> Emitir ficha de visita</Link><form><input type="hidden" name="id" value={id}/><ConfirmButton formAction={deactivateClient} message="Desativar este cliente?" className="button-ghost text-red-700">Desativar</ConfirmButton></form></div>}
      <p className="text-xs font-bold uppercase tracking-widest text-forest">{config.singular}</p><h1 className="mt-2 text-3xl font-black">{title}</h1>
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{config.columns.slice(0, 8).map((column) => <div className="rounded-xl bg-cream/70 p-4" key={column.key}><p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">{column.label}</p><p className="mt-1 font-bold">{format(get(record, column.key), column.kind)}</p></div>)}</div>
    </div>
    {config.table === "v_order_overview" && <div className="card mt-5 overflow-hidden">
      <div className="border-b p-5"><h2 className="font-black">Checklist operacional</h2><p className="text-xs text-ink/45">{checklist.filter((x) => x.status === "concluido").length} de {checklist.length} etapas concluídas</p></div>
      <div className="divide-y">{checklist.length ? checklist.map((item) => <form action={toggleChecklistItem} className="flex items-center gap-4 p-4" key={String(item.id)}>
        <input type="hidden" name="id" value={String(item.id)} /><input type="hidden" name="order_id" value={id} /><input type="hidden" name="status" value={String(item.status)} />
        <button className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${item.status === "concluido" ? "bg-forest text-white" : "border bg-white"}`}>{item.status === "concluido" ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4 text-ink/25" />}</button>
        <div className="min-w-0 flex-1"><p className="font-semibold">{String(item.title)}</p><p className="text-xs text-ink/40">{String((item.responsible as { full_name?: string })?.full_name ?? "Sem responsável")}</p></div>
        <span className="flex items-center gap-1 text-xs text-ink/45"><Clock3 className="h-3.5 w-3.5" />{shortDate(item.due_date as string)}</span>
      </form>) : <p className="p-8 text-center text-sm text-ink/45">Checklist ainda não gerado.</p>}</div>
    </div>}
  </div>;
}

const get = (row: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, row);
const format = (value: unknown, kind?: string) => kind === "money" ? money(value as number) : kind === "date" ? shortDate(value as string) : String(value ?? "-").replaceAll("_", " ");
function Missing({ message }: { message?: string }) { return <div className="card mx-auto max-w-2xl p-8"><h1 className="text-2xl font-black">Registro não encontrado</h1><p className="mt-2 text-sm text-ink/50">{message ?? "Configure o Supabase e execute as migrações para consultar este registro."}</p></div>; }
