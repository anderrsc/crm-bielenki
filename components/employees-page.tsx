import Link from "next/link";
import { ArrowLeft, KeyRound, Plus, Save, UserCheck, UserX } from "lucide-react";
import { inviteUser, saveEmployee, saveUserRoles, resetUserPassword } from "@/app/(crm)/actions";
import { createClient } from "@/lib/supabase/server";

type Profile = { id: string; full_name: string; phone: string | null; email: string | null; status: string };
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
  let profiles: Profile[] = [];
  let userRoles: UserRole[] = [];
  let loadError = "";
  let canManage = false;
  let novoEmail = "";

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await createClient();
    const [perm, profResult, rolesResult] = await Promise.all([
      db.rpc("has_table_access", { resource: "profiles", action: "update" }),
      db.from("profiles").select("id,full_name,phone,email,status").order("full_name"),
      db.from("user_roles").select("profile_id,role"),
    ]);
    canManage = Boolean(perm.data);
    profiles = (profResult.data as Profile[]) ?? [];
    userRoles = (rolesResult.data as UserRole[]) ?? [];
    loadError = profResult.error?.message ?? "";
  }

  // Extrai e-mail do novo usuário criado (passado via query param)
  // Nota: searchParams não está disponível aqui, mas o redirect traz ?novo=email
  // O componente recebe isso via prop error/saved — apenas mostramos a mensagem saved

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/configuracoes" className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-ink/55">
            <ArrowLeft className="h-4 w-4" />Voltar
          </Link>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Pessoas</p>
          <h1 className="mt-1 text-3xl font-black">Funcionários & Usuários</h1>
          <p className="mt-1 text-sm text-ink/50">{profiles.length} membro{profiles.length !== 1 ? "s" : ""} da equipe</p>
        </div>
      </div>

      {(error || loadError) && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error || loadError}</div>
      )}
      {saved && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-700">
          ✓ Usuário criado com sucesso. Informe a senha definida ao novo usuário — o acesso já está liberado.
        </div>
      )}

      {/* ─── CONVIDAR NOVO USUÁRIO ─── */}
      {canManage && (
        <div className="card p-6">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-forest text-white">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-bold">Adicionar novo usuário</h2>
              <p className="text-xs text-ink/50">O usuário receberá acesso imediato ao sistema</p>
            </div>
          </div>
          <form action={inviteUser} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Nome completo *</label>
                <input className="field" name="full_name" placeholder="Ex: João da Silva" required />
              </div>
              <div>
                <label className="label">E-mail *</label>
                <input className="field" name="email" type="email" placeholder="joao@exemplo.com" required />
              </div>
              <div>
                <label className="label">Senha inicial * <span className="normal-case font-normal text-ink/40">(mín. 6 caracteres)</span></label>
                <input className="field" name="password" type="password" placeholder="Senha de acesso" minLength={6} required />
              </div>
              <div className="flex items-end">
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 w-full">
                  <KeyRound className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>Informe a senha ao usuário. O acesso é imediato — sem envio de e-mail.</span>
                </div>
              </div>
            </div>
            <div>
              <label className="label mb-2 block">Cargos / Acessos</label>
              <div className="flex flex-wrap gap-3">
                {ALL_ROLES.map(r => (
                  <label key={r.value} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink/10 px-3 py-2 text-sm font-medium hover:border-forest hover:bg-lime/10 has-[:checked]:border-forest has-[:checked]:bg-lime/20">
                    <input type="checkbox" name="roles" value={r.value} className="accent-forest" />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>
            <button type="submit" className="button flex items-center gap-2">
              <Plus className="h-4 w-4" /> Criar usuário
            </button>
          </form>
        </div>
      )}

      {/* ─── LISTA DE FUNCIONÁRIOS ─── */}
      <div className="space-y-2">
        <h2 className="font-bold text-sm uppercase tracking-widest text-ink/40">Equipe atual</h2>
        {profiles.map(p => {
          const myRoles = userRoles.filter(r => r.profile_id === p.id).map(r => r.role);
          return (
            <details key={p.id} className="card">
              <summary className="flex cursor-pointer list-none items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  {p.status === "ativo"
                    ? <UserCheck className="h-5 w-5 text-forest" />
                    : <UserX className="h-5 w-5 text-ink/30" />}
                  <div>
                    <p className="font-bold">{p.full_name}</p>
                    <p className="text-xs text-ink/50">
                      {myRoles.map(r => ALL_ROLES.find(x => x.value === r)?.label ?? r).join(", ") || "Sem cargo"}
                    </p>
                    {p.email && <p className="text-xs text-ink/40">{p.email}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`hidden rounded-full px-2 py-0.5 text-xs font-bold sm:inline ${p.status === "ativo" ? "bg-lime/30 text-forest" : "bg-ink/10 text-ink/40"}`}>
                    {p.status === "ativo" ? "Ativo" : "Inativo"}
                  </span>
                  <span className="text-xs text-ink/40">{p.phone || ""}</span>
                </div>
              </summary>
              <div className="border-t p-4 space-y-4">
                <form action={saveEmployee} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="id" value={p.id} />
                  <div>
                    <label className="label">Nome completo</label>
                    <input className="field" name="full_name" defaultValue={p.full_name} disabled={!canManage} required />
                  </div>
                  <div>
                    <label className="label">Telefone</label>
                    <input className="field" name="phone" defaultValue={p.phone ?? ""} disabled={!canManage} />
                  </div>
                  <div className="flex items-center gap-4 self-end">
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <input type="checkbox" name="status_ativo" defaultChecked={p.status === "ativo"} disabled={!canManage} />
                      Usuário ativo
                    </label>
                  </div>
                  {canManage && (
                    <button className="button self-end flex items-center gap-2">
                      <Save className="h-4 w-4" /> Salvar dados
                    </button>
                  )}
                </form>
                {canManage && (
                  <form action={resetUserPassword} className="border-t pt-4 flex items-center gap-3">
                    <input type="hidden" name="profile_id" value={p.id} />
                    <p className="text-xs text-ink/50 flex-1">Enviar e-mail de redefinição de senha para este usuário</p>
                    <button className="button-ghost flex items-center gap-2 text-xs">
                      <KeyRound className="h-3.5 w-3.5" /> Redefinir senha
                    </button>
                  </form>
                )}
                {canManage && (
                  <form action={saveUserRoles} className="border-t pt-4">
                    <input type="hidden" name="profile_id" value={p.id} />
                    <p className="label mb-3">Cargos / Acessos</p>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {ALL_ROLES.map(r => (
                        <label key={r.value} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink/10 px-3 py-2 text-sm font-medium hover:border-forest hover:bg-lime/10 has-[:checked]:border-forest has-[:checked]:bg-lime/20">
                          <input type="checkbox" name="roles" value={r.value} defaultChecked={myRoles.includes(r.value)} className="accent-forest" />
                          {r.label}
                        </label>
                      ))}
                    </div>
                    <button className="button-ghost flex items-center gap-2 text-sm">
                      <Save className="h-4 w-4" /> Salvar cargos
                    </button>
                  </form>
                )}
              </div>
            </details>
          );
        })}
        {!profiles.length && (
          <div className="card p-8 text-center text-sm text-ink/45">
            Nenhum funcionário encontrado. Adicione o primeiro usuário acima.
          </div>
        )}
      </div>
    </div>
  );
}
