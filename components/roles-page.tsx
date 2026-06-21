import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { savePermission } from "@/app/(crm)/actions";
import { createClient } from "@/lib/supabase/server";

type Permission = { id: string; role: string; resource: string; can_view: boolean; can_create: boolean; can_update: boolean; can_delete: boolean };

const ALL_ROLES = ["administrador","gerente","vendedor","compras","producao","estoque","instalador","financeiro","atendente"];
const ROLE_LABELS: Record<string, string> = { administrador:"Administrador", gerente:"Gerente", vendedor:"Vendedor", compras:"Compras", producao:"Produção", estoque:"Estoque", instalador:"Instalador", financeiro:"Financeiro", atendente:"Atendente" };
const RESOURCE_LABELS: Record<string, string> = {
  activities: "Atividades",
  clients: "Clientes",
  conversations: "Conversas",
  files: "Arquivos",
  financial_entries: "Financeiro",
  followups: "Follow-ups",
  gutter_prices: "Preços de calhas",
  installation_checklists: "Checklists de instalação",
  installations: "Instalações",
  lead_sources: "Origens de lead",
  leads: "Leads / Pipeline",
  materials: "Materiais",
  orders: "Pedidos",
  permissions: "Permissões",
  production_orders: "Ordens de produção",
  profiles: "Funcionários",
  purchase_orders: "Compras",
  quotes: "Orçamentos",
  sales: "Vendas",
  suppliers: "Fornecedores",
  tasks: "Tarefas",
  user_roles: "Cargos de usuários",
  messages: "Mensagens",
  notifications: "Notificações",
  order_checklist_items: "Itens de checklist",
  payments: "Pagamentos",
  commissions: "Comissões",
  campaigns: "Campanhas",
  stock_movements: "Movimentações de estoque",
  checklist_templates: "Templates de checklist",
};

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
    <div className="mx-auto max-w-5xl">
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
      {resources.map(resource => {
        const label = RESOURCE_LABELS[resource] ?? resource.replaceAll("_", " ");
        const count = ALL_ROLES.filter(r => permMap[resource]?.[r]).length;
        return (
          <details key={resource} className="card mb-3">
            <summary className="flex cursor-pointer list-none items-center justify-between p-4 font-bold">
              <span>{label}</span>
              <span className="text-xs font-normal text-ink/40">{count} cargos configurados</span>
            </summary>
            <div className="border-t">
              {/* cabeçalho */}
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_40px] gap-2 border-b px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/40">
                <span>Cargo</span>
                <span className="text-center">Visualizar</span>
                <span className="text-center">Criar</span>
                <span className="text-center">Editar</span>
                <span className="text-center">Excluir</span>
                <span />
              </div>
              {ALL_ROLES.map(role => {
                const p = permMap[resource]?.[role];
                if (!p) return null;
                return canManage ? (
                  <form key={role} action={savePermission}
                    className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_40px] items-center gap-2 border-b px-4 py-3 last:border-0 hover:bg-ink/[.02]">
                    <input type="hidden" name="id" value={p.id} />
                    <span className="text-sm font-medium">{ROLE_LABELS[role] ?? role}</span>
                    <div className="flex justify-center"><input type="checkbox" name="can_view" defaultChecked={p.can_view} className="h-4 w-4 cursor-pointer" /></div>
                    <div className="flex justify-center"><input type="checkbox" name="can_create" defaultChecked={p.can_create} className="h-4 w-4 cursor-pointer" /></div>
                    <div className="flex justify-center"><input type="checkbox" name="can_update" defaultChecked={p.can_update} className="h-4 w-4 cursor-pointer" /></div>
                    <div className="flex justify-center"><input type="checkbox" name="can_delete" defaultChecked={p.can_delete} className="h-4 w-4 cursor-pointer" /></div>
                    <button type="submit" className="button-ghost p-1.5" title="Salvar"><Save className="h-3.5 w-3.5" /></button>
                  </form>
                ) : (
                  <div key={role} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_40px] items-center gap-2 border-b px-4 py-3 last:border-0 text-sm">
                    <span className="font-medium">{ROLE_LABELS[role] ?? role}</span>
                    <span className="text-center">{p.can_view ? "✓" : "—"}</span>
                    <span className="text-center">{p.can_create ? "✓" : "—"}</span>
                    <span className="text-center">{p.can_update ? "✓" : "—"}</span>
                    <span className="text-center">{p.can_delete ? "✓" : "—"}</span>
                    <span />
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
