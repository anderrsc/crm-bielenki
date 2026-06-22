import { createClient } from "@/lib/supabase/server";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  INSERT: { label: "Criado", color: "bg-emerald-50 text-emerald-700" },
  UPDATE: { label: "Atualizado", color: "bg-blue-50 text-blue-700" },
  DELETE: { label: "Removido", color: "bg-red-50 text-red-700" },
};

const TABLE_LABELS: Record<string, string> = {
  quotes: "Orçamentos",
  orders: "Pedidos",
  clients: "Clientes",
  financial_entries: "Financeiro",
  payments: "Pagamentos",
  production_orders: "Produção",
  installations: "Instalações",
  gutter_prices: "Tabela de calhas",
  pricing_commercial_tables: "Tabelas comerciais",
  profiles: "Usuários",
  companies: "Empresa",
};

type LogEntry = {
  id: number;
  table_name: string;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  profile: { full_name: string } | null;
};

export async function AuditLogPage({
  tableFilter,
}: {
  tableFilter?: string;
}) {
  const db = await createClient();

  const q = db
    .from("audit_logs")
    .select(
      "id,table_name,action,old_data,new_data,created_at," +
        "profile:profiles!audit_logs_profile_id_fkey(full_name)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const { data, error } = tableFilter ? await q.eq("table_name", tableFilter) : await q;

  const logs = (data ?? []) as unknown as LogEntry[];
  const tables = [...new Set(logs.map((l) => l.table_name))].sort();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <p className="text-xs font-bold uppercase tracking-widest text-forest">Gestão</p>
        <h1 className="mt-2 text-3xl font-black">Log de Auditoria</h1>
        <p className="mt-1 text-sm text-ink/50">
          Todas as alterações registradas no sistema.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {/* Filtros por tabela */}
      <div className="mb-4 flex flex-wrap gap-2">
        <a
          href="/auditoria"
          className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
            !tableFilter
              ? "border-forest bg-forest text-white"
              : "border-sand hover:bg-sand/50"
          }`}
        >
          Todos
        </a>
        {tables.map((t) => (
          <a
            key={t}
            href={`/auditoria?tabela=${t}`}
            className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
              tableFilter === t
                ? "border-forest bg-forest text-white"
                : "border-sand hover:bg-sand/50"
            }`}
          >
            {TABLE_LABELS[t] ?? t}
          </a>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-cream/50">
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-ink/40">
                Data/Hora
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-ink/40">
                Usuário
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-ink/40">
                Módulo
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-ink/40">
                Ação
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-ink/40">
                Detalhe
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-ink/40">
                  Nenhum log encontrado.
                </td>
              </tr>
            )}
            {logs.map((log) => {
              const act = ACTION_LABELS[log.action] ?? {
                label: log.action,
                color: "bg-sand text-ink/60",
              };
              const changedFields =
                log.action === "UPDATE" && log.old_data && log.new_data
                  ? Object.keys(log.new_data).filter(
                      (k) =>
                        JSON.stringify(log.old_data![k]) !==
                        JSON.stringify(log.new_data![k])
                    )
                  : [];

              return (
                <tr key={log.id} className="hover:bg-cream/30">
                  <td className="px-4 py-3 text-xs text-ink/50">
                    {new Date(log.created_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {log.profile?.full_name ?? "Sistema"}
                  </td>
                  <td className="px-4 py-3 text-ink/60">
                    {TABLE_LABELS[log.table_name] ?? log.table_name}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-lg px-2 py-0.5 text-xs font-bold ${act.color}`}
                    >
                      {act.label}
                    </span>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-xs text-ink/50">
                    {changedFields.length > 0
                      ? `Campos: ${changedFields.join(", ")}`
                      : log.action === "INSERT"
                      ? (log.new_data as { description?: string; name?: string; quote_number?: string })
                          ?.description ??
                        (log.new_data as { name?: string })?.name ??
                        (log.new_data as { quote_number?: string })?.quote_number ??
                        "—"
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
