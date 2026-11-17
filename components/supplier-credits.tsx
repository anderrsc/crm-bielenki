// Crédito com fornecedores: saldo por fornecedor, últimos movimentos e lançamento manual.
import { addSupplierCredit } from "@/app/(crm)/supplier-credit-actions";
import { ReceivingAccountSelect } from "@/components/receiving-account-select";
import { getRequestClient } from "@/lib/supabase/server";
import { localISODate, money, shortDate } from "@/lib/utils";

type Balance = { supplier_id: string; supplier_name: string; balance: number };
type Move = { id: string; supplier_id: string; amount: number; kind: string; moved_at: string; notes: string | null };
const KIND: Record<string, string> = { excedente: "Pago a mais", adiantamento: "Adiantamento", abatimento: "Abatimento/devolução", uso: "Usado em conta", estorno_uso: "Uso estornado", ajuste: "Ajuste" };

export async function SupplierCredits({ canManage, back = "/financeiro/pagar" }: { canManage: boolean; back?: string }) {
  const db = await getRequestClient();
  const [{ data: balances, error }, { data: moves }, { data: suppliers }] = await Promise.all([
    db.from("v_supplier_credit_balance").select("supplier_id,supplier_name,balance").neq("balance", 0).order("supplier_name"),
    db.from("supplier_credits").select("id,supplier_id,amount,kind,moved_at,notes").order("created_at", { ascending: false }).limit(15),
    canManage ? db.from("suppliers").select("id,name").is("deleted_at", null).order("name") : Promise.resolve({ data: [] }),
  ]);
  if (error) return null;
  const list = (balances ?? []) as Balance[];
  const names = new Map(((suppliers ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name]));
  for (const b of list) names.set(b.supplier_id, b.supplier_name);
  const total = list.reduce((s, b) => s + Number(b.balance), 0);
  return (
    <details className="card mb-6 p-4" id="creditos-fornecedores">
      <summary className="cursor-pointer font-bold">Créditos com fornecedores {total > 0 && <span className="ml-2 rounded-lg bg-emerald-50 px-2 py-0.5 text-sm text-emerald-700">{money(total)}</span>}</summary>
      <p className="mt-3 text-sm text-ink/60">Quando você paga a mais, adianta ou o fornecedor dá um abatimento, o valor fica aqui e é usado no &quot;Dar baixa&quot; das próximas contas desse fornecedor.</p>
      {list.length ? <ul className="mt-3 divide-y divide-sand text-sm">{list.map(b => <li key={b.supplier_id} className="flex justify-between py-2"><span>{b.supplier_name}</span><strong className="text-emerald-700">{money(b.balance)}</strong></li>)}</ul>
        : <p className="mt-3 text-sm text-ink/45">Nenhum fornecedor com crédito.</p>}
      {canManage && names.size === 0 && <p className="mt-4 text-sm text-ink/45">Cadastre um fornecedor para lançar crédito.</p>}
      {canManage && names.size > 0 && <form action={addSupplierCredit} className="mt-4 grid gap-3 rounded-xl border border-sand p-3 sm:grid-cols-2">
        <input type="hidden" name="_back" value={back} />
        <p className="font-bold sm:col-span-2">Lançar crédito</p>
        <div><label className="label">Fornecedor</label><select className="field" name="supplier_id" required defaultValue=""><option value="" disabled>Escolha…</option>{[...names].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
        <div><label className="label">Tipo</label><select className="field" name="kind"><option value="abatimento">Abatimento / devolução (sem dinheiro)</option><option value="adiantamento">Adiantamento (saiu dinheiro)</option><option value="ajuste">Ajuste (gerência; negativo reduz)</option></select></div>
        <div><label className="label">Valor</label><input className="field" name="amount" type="number" step="0.01" placeholder="0,00" required /></div>
        <div><label className="label">Data</label><input className="field" name="moved_at" type="date" defaultValue={localISODate()} required /></div>
        <div className="sm:col-span-2"><label className="label">Conta de onde saiu (adiantamento)</label><ReceivingAccountSelect name="account_id" className="field" /></div>
        <div className="sm:col-span-2"><label className="label">Motivo</label><input className="field" name="notes" required minLength={3} maxLength={500} placeholder="Ex.: sinal para pedido de vidro" /></div>
        <button className="button sm:col-span-2">Lançar crédito</button>
      </form>}
      {!!(moves ?? []).length && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><caption className="sr-only">Últimos movimentos de crédito</caption><thead><tr className="text-left text-xs text-ink/50"><th className="py-1">Data</th><th>Fornecedor</th><th>Movimento</th><th className="text-right">Valor</th></tr></thead><tbody>
        {((moves ?? []) as Move[]).map(m => <tr key={m.id} className="border-t border-sand"><td className="py-2">{shortDate(m.moved_at)}</td><td>{names.get(m.supplier_id) ?? "—"}</td><td title={m.notes ?? ""}>{KIND[m.kind] ?? m.kind}</td><td className={`text-right font-bold ${m.amount < 0 ? "text-ink/60" : "text-emerald-700"}`}>{money(m.amount)}</td></tr>)}
      </tbody></table></div>}
    </details>
  );
}
