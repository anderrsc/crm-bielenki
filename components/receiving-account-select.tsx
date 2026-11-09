"use client";
// Escolha da conta onde o dinheiro caiu (Pix/banco/caixa), com cadastro rápido de conta nova.
import { useEffect, useState } from "react";
import { listReceivingAccounts, saveReceivingAccount, type ReceivingAccount } from "@/app/(crm)/receiving-accounts-actions";

const NEW = "__nova";

export function ReceivingAccountSelect({ name = "receiving_account_id", value, onChange, className = "field w-full" }: {
  name?: string; value?: string; onChange?: (id: string) => void; className?: string;
}) {
  const [accounts, setAccounts] = useState<ReceivingAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [own, setOwn] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", details: "" });
  const selected = value ?? own;

  useEffect(() => { listReceivingAccounts().then((r) => (r.ok ? setAccounts(r.accounts) : setError(r.error))); }, []);
  const pick = (id: string) => { setOwn(id); onChange?.(id); };

  async function create() {
    const r = await saveReceivingAccount(draft);
    if (!r.ok) return setError(r.error);
    setError(null); setCreating(false); setDraft({ name: "", details: "" });
    setAccounts((a) => [...(a ?? []), r.account].sort((x, y) => x.name.localeCompare(y.name, "pt-BR")));
    pick(r.account.id);
  }

  return (
    <div className="space-y-1.5">
      <input type="hidden" name={name} value={selected} />
      <select className={className} value={selected} onChange={(e) => (e.target.value === NEW ? setCreating(true) : pick(e.target.value))}>
        <option value="">{accounts === null && !error ? "Carregando contas…" : "Conta não informada"}</option>
        {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.details ? ` · ${a.details}` : ""}</option>)}
        <option value={NEW}>+ Cadastrar nova conta…</option>
      </select>
      {creating && (
        <div className="space-y-1.5 rounded-lg bg-cream/70 p-2">
          <input className="field w-full" placeholder="Nome (ex.: Pix Sicoob CNPJ)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="field w-full" placeholder="Chave Pix ou agência/conta (opcional)" value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} />
          <div className="flex justify-end gap-2 text-xs">
            <button type="button" className="px-2 font-bold text-ink/60" onClick={() => setCreating(false)}>Cancelar</button>
            <button type="button" className="rounded-lg bg-forest px-3 py-1.5 font-bold text-white" onClick={create}>Salvar conta</button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
