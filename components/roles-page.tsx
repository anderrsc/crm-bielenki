import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { savePermission } from "@/app/(crm)/actions";
import { createClient } from "@/lib/supabase/server";

type Permission = { id: string; role: string; resource: string; can_view: boolean; can_create: boolean; can_update: boolean; can_delete: boolean };

const ALL_ROLES = ["administrador","gerente","vendedor","compras","producao","estoque","instalador","financeiro","atendente"];
const ROLE_LABELS: Record<string, string> = { administrador:"Administrador", gerente:"Gerente", vendedor:"Vendedor", compras:"Compras", producao:"Produção", estoque:"Estoque", instalador:"Instalador", financeiro:"Financeiro", atendente:"Atendente" };

export async function RolesPage({ error, saved }: { error?: string; saved?: boolean }) {
  let permissions: Permission[] = []; let loadError = ""; let canManage = false;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await createClient();
    const [perm, result] = await Promise.all([
      db.rpc("has_table_access", { resource: "permissions", action: "update" }),
      db.from("permissions").select("id,role,resource,can_view,can_create,can_update,can_delete").order("resource").order("role"),
    ]);
    canManage = Boolean(perm.data);
    permissions = (result.data as Permission[]) ?? [];
    loadError = result.error?.message ?? "";
  }

  const resources = [...new Set(permissions.map(p => p.resource))].sort();
  const permMap: Record<string, Record<string, Permission>> = {};
  for (const p of permissions) {
    if (!permMap[p.resource]) permMap[p.resource] = {};
    permMap[p.resource][p.role] = p;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/configuracoes" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft className="h-4 w-4" />Voltar</Link>
      <div className="mb-7">
        <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Pessoas</p>
        <h1 className="mt-2 text-3xl font-black">Cargos e Permissões</h1>
        <p className="mt-1 text-sm text-ink/50">Defina o que cada cargo pode ver, criar, editar e excluir.</p>
      </div>
      {(error || loadError) && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error || loadError}</p>}
      {saved && <p className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Permissão salva.</p>}
      {!permissions.length && (
        <div className="card p-8 text-center text-sm text-ink/45">Nenhuma permissão cadastrada. Execute a migração inicial para popular a tabela de permissões.</div>
      )}
      {resources.map(resource => (
        <details key={resource} className="card mb-3">
          <summary className="flex cursor-pointer list-none items-center justify-between p-4 font-bold">
            <span className="capitalize">{resource.replaceAll("_", " ")}</span>
            <span className="text-xs font-normal text-ink/40">{ALL_ROLES.filter(r => permMap[resource]?.[r]).length} cargos configurados</span>
          </summary>
          <div className="border-t overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-xs text-ink/45"><th className="p-3 text-left">Cargo</th><th className="p-3 text-center">Visualizar</th><th className="p-3 text-center">Criar</th><th className="p-3 text-center">Editar</th><th className="p-3 text-center">Excluir</th>{canManage && <th className="p-3" />}</tr></thead>
              <tbody>
                {ALL_ROLES.map(role => {
                  const p = permMap[resource]?.[role];
                  if (!p) return null;
                  return (
                    <tr key={role} className="border-b last:border-0 hover:bg-ink/[.02]">
                      <td className="p-3 font-medium">{ROLE_LABELS[role]}</td>
                      {canManage ? (
                        <form action={savePermission} className="contents">
                          <input type="hidden" name="id" value={p.id} />
                          <td className="p-3 text-center"><input type="checkbox" name="can_view" defaultChecked={p.can_view} /></td>
                          <td className="p-3 text-center"><input type="checkbox" name="can_create" defaultChecked={p.can_create} /></td>
                          <td className="p-3 text-center"><input type="checkbox" name="can_update" defaultChecked={p.can_update} /></td>
                          <td className="p-3 text-center"><input type="checkbox" name="can_delete" defaultChecked={p.can_delete} /></td>
                          <td className="p-3"><button className="button-ghost p-1.5"><Save className="h-3.5 w-3.5" /></button></td>
                        </form>
                      ) : (
                        <>
                          <td className="p-3 text-center">{p.can_view ? "✓" : "—"}</td>
                          <td className="p-3 text-center">{p.can_create ? "✓" : "—"}</td>
                          <td className="p-3 text-center">{p.can_update ? "✓" : "—"}</td>
                          <td className="p-3 text-center">{p.can_delete ? "✓" : "—"}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}
