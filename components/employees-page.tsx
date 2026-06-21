import Link from "next/link";
import { ArrowLeft, Save, UserCheck, UserX } from "lucide-react";
import { saveEmployee, saveUserRoles } from "@/app/(crm)/actions";
import { createClient } from "@/lib/supabase/server";

type Profile = { id: string; full_name: string; phone: string | null; status: string };
type UserRole = { profile_id: string; role: string };

const ALL_ROLES: { value: string; label: string }[] = [
  { value: "administrador", label: "Administrador" },
  { value: "gerente", label: "Gerente" },
  { value: "vendedor", label: "Vendedor" },
  { value: "compras", label: "Compras" },
  { value: "producao", label: "Produção" },
  { value: "estoque", label: "Estoque" },
  { value: "instalador", label: "Instalador" },
  { value: "financeiro", label: "Financeiro" },
  { value: "atendente", label: "Atendente" },
];

export async function EmployeesPage({ error, saved }: { error?: string; saved?: boolean }) {
  let profiles: Profile[] = []; let userRoles: UserRole[] = []; let loadError = ""; let canManage = false;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await createClient();
    const [perm, profResult, rolesResult] = await Promise.all([
      db.rpc("has_table_access", { resource: "profiles", action: "update" }),
      db.from("profiles").select("id,full_name,phone,status").order("full_name"),
      db.from("user_roles").select("profile_id,role"),
    ]);
    canManage = Boolean(perm.data);
    profiles = (profResult.data as Profile[]) ?? [];
    userRoles = (rolesResult.data as UserRole[]) ?? [];
    loadError = profResult.error?.message ?? "";
  }
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/configuracoes" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft className="h-4 w-4" />Voltar</Link>
      <div className="mb-7">
        <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Pessoas</p>
        <h1 className="mt-2 text-3xl font-black">Funcionários</h1>
        <p className="mt-1 text-sm text-ink/50">Dados e situação dos membros da equipe.</p>
      </div>
      {(error || loadError) && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error || loadError}</p>}
      {saved && <p className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Funcionário salvo.</p>}
      <div className="space-y-3">
        {profiles.map(p => {
          const myRoles = userRoles.filter(r => r.profile_id === p.id).map(r => r.role);
          return (
            <details key={p.id} className="card">
              <summary className="flex cursor-pointer list-none items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  {p.status === "ativo" ? <UserCheck className="h-5 w-5 text-forest" /> : <UserX className="h-5 w-5 text-ink/30" />}
                  <div>
                    <p className="font-bold">{p.full_name}</p>
                    <p className="text-xs text-ink/50">{myRoles.map(r => ALL_ROLES.find(x => x.value === r)?.label ?? r).join(", ") || "Sem cargo"}</p>
                  </div>
                </div>
                <span className="text-xs text-ink/40">{p.phone || ""}</span>
              </summary>
              <div className="border-t p-4 space-y-4">
                <form action={saveEmployee} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="id" value={p.id} />
                  <div><label className="label">Nome completo</label><input className="field" name="full_name" defaultValue={p.full_name} disabled={!canManage} required /></div>
                  <div><label className="label">Telefone</label><input className="field" name="phone" defaultValue={p.phone ?? ""} disabled={!canManage} /></div>
                  <div className="flex items-center gap-4 self-end">
                    <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" name="status_ativo" defaultChecked={p.status === "ativo"} disabled={!canManage} />Ativo</label>
                  </div>
                  {canManage && <button className="button self-end"><Save className="h-4 w-4" />Salvar dados</button>}
                </form>
                {canManage && (
                  <form action={saveUserRoles} className="border-t pt-4">
                    <input type="hidden" name="profile_id" value={p.id} />
                    <p className="label mb-2">Cargos / Acessos</p>
                    <div className="flex flex-wrap gap-3 mb-3">
                      {ALL_ROLES.map(r => (
                        <label key={r.value} className="flex items-center gap-1.5 text-sm font-medium cursor-pointer">
                          <input type="checkbox" name="roles" value={r.value} defaultChecked={myRoles.includes(r.value)} />
                          {r.label}
                        </label>
                      ))}
                    </div>
                    <button className="button-ghost text-sm gap-2"><Save className="h-4 w-4" />Salvar cargos</button>
                  </form>
                )}
              </div>
            </details>
          );
        })}
        {!profiles.length && <div className="card p-8 text-center text-sm text-ink/45">Nenhum funcionário encontrado.</div>}
      </div>
    </div>
  );
}
