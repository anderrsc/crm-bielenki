import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createFinancialEntry } from "@/app/(crm)/financial-actions";
import { getRequestClient } from "@/lib/supabase/server";
import { q } from "@/lib/back-url";

export async function FinancialEntryForm({ type, error }: { type: "pagar" | "receber"; error?: string }) {
  const db = await getRequestClient();
  const back = `/financeiro/${type}`;
  const payable = type === "pagar";
  const { data: canCreate } = await db.rpc("has_table_access", { resource: "financial_entries", action: "insert" });
  if (canCreate !== true) redirect(`${q(back)}erro=Você+não+tem+permissão+para+cadastrar+contas`);

  const { data: parties } = await db.from(payable ? "suppliers" : "clients").select("id,name").order("name");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-5 text-3xl font-black tracking-tight">Nova conta a {type}</h1>
      {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <form action={createFinancialEntry} className="card space-y-4 p-5 sm:p-6">
        <input type="hidden" name="id" value={randomUUID()} />
        <input type="hidden" name="entry_type" value={type} />
        <label className="block">
          <span className="label">Descrição</span>
          <input className="field" name="description" maxLength={200} required
            placeholder={payable ? "Ex. aluguel da oficina" : "Ex. saldo de instalação"} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">Valor (R$)</span>
            <input className="field" name="total_amount" inputMode="decimal" placeholder="0,00" maxLength={15} required />
          </label>
          <label className="block">
            <span className="label">Vencimento</span>
            <input className="field" type="date" name="due_date" required />
          </label>
        </div>
        <label className="block">
          <span className="label">{payable ? "Fornecedor" : "Cliente"} (opcional)</span>
          <select className="field" name="party_id">
            <option value="">Sem vínculo</option>
            {parties?.map(party => <option key={party.id} value={party.id}>{party.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Observações (opcional)</span>
          <textarea className="field" name="notes" rows={3} maxLength={2000} />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Link className="button-ghost" href={back}>Cancelar</Link>
          <button type="submit" className="button">Salvar conta</button>
        </div>
      </form>
    </div>
  );
}
