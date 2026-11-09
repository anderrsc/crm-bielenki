"use client";
// Financeiro → "Contas de recebimento": lista, cadastra, edita e desativa.
import { useEffect, useState } from "react";
import { Landmark, Pencil, Plus } from "lucide-react";
import { listReceivingAccounts, saveReceivingAccount, type ReceivingAccount } from "@/app/(crm)/receiving-accounts-actions";

export function ReceivingAccountsManager() {
  const [accounts, setAccounts] = useState<ReceivingAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id?: string; name: string; details: string; pix_key: string; holder_name: string; holder_city: string } | null>(null);
  const load = () => listReceivingAccounts(true).then((r) => (r.ok ? setAccounts(r.accounts) : setError(r.error)));
  useEffect(() => { load(); }, []);

  async function save(values: { id?: string; name: string; details?: string; active?: boolean; pix_key?: string; holder_name?: string; holder_city?: string }) {
    const r = await saveReceivingAccount(values);
    if (!r.ok) return setError(r.error);
    setError(null); setEdit(null); load();
  }

  return (
    <details className="card mb-6 p-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-bold"><Landmark className="h-4 w-4" /> Contas de recebimento <span className="text-xs font-normal text-ink/50">({accounts?.filter((a) => a.active).length ?? "…"} ativas) · onde caem os Pix e depósitos</span></summary>
      <div className="mt-3 space-y-2">
        {error && <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-500">{error}</p>}
        {(accounts ?? []).map((a) => (
          <div key={a.id} className={`flex items-center gap-2 rounded-xl border border-sand/80 p-2 text-sm ${a.active ? "" : "opacity-50"}`}>
            <div className="min-w-0 flex-1"><p className="font-bold">{a.name}</p>{a.details && <p className="truncate text-xs text-ink/60">{a.details}</p>}{a.pix_key && <p className="truncate text-xs text-forest">Pix: {a.pix_key}{a.holder_name ? ` · ${a.holder_name}` : ""}</p>}</div>
            <button type="button" onClick={() => setEdit({ id: a.id, name: a.name, details: a.details ?? "", pix_key: a.pix_key ?? "", holder_name: a.holder_name ?? "", holder_city: a.holder_city ?? "Jaraguá do Sul" })} className="button-ghost p-1.5" aria-label="Editar"><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => save({ id: a.id, name: a.name, details: a.details ?? "", active: !a.active })} className="button-ghost px-2 py-1 text-xs">{a.active ? "Desativar" : "Reativar"}</button>
          </div>
        ))}
        {accounts?.length === 0 && <p className="text-xs text-ink/50">Nenhuma conta ainda. Cadastre os Pix e bancos onde vocês recebem.</p>}
        {edit ? (
          <div className="grid gap-2 rounded-xl bg-cream/70 p-3 sm:grid-cols-2">
            <input className="field" placeholder="Nome da conta (ex.: Pix Sicoob CNPJ)" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <input className="field" placeholder="Banco / agência / conta (opcional)" value={edit.details} onChange={(e) => setEdit({ ...edit, details: e.target.value })} />
            <input className="field" placeholder="Chave Pix (CNPJ, CPF, celular, e-mail ou aleatória)" value={edit.pix_key} onChange={(e) => setEdit({ ...edit, pix_key: e.target.value })} />
            <input className="field" placeholder="Nome do favorecido (como aparece no banco)" value={edit.holder_name} onChange={(e) => setEdit({ ...edit, holder_name: e.target.value })} />
            <input className="field" placeholder="Cidade do favorecido" value={edit.holder_city} onChange={(e) => setEdit({ ...edit, holder_city: e.target.value })} />
            <div className="flex justify-end gap-2"><button type="button" className="button-ghost text-xs" onClick={() => setEdit(null)}>Cancelar</button><button type="button" className="button text-xs" onClick={() => save(edit)}>Salvar</button></div>
          </div>
        ) : (
          <button type="button" onClick={() => setEdit({ name: "", details: "", pix_key: "", holder_name: "", holder_city: "Jaraguá do Sul" })} className="button-ghost flex items-center gap-1 text-xs"><Plus className="h-3.5 w-3.5" /> Nova conta</button>
        )}
      </div>
    </details>
  );
}
