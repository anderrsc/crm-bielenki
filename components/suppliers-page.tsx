import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { saveSupplier, deleteSupplier } from "@/app/(crm)/actions";
import { createClient } from "@/lib/supabase/server";

type Supplier = { id: string; name: string; tax_id: string | null; phone: string | null; whatsapp: string | null; email: string | null; city: string | null; state: string | null; payment_terms: string | null; notes: string | null; status: string };
const states = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

export async function SuppliersPage({ error, saved }: { error?: string; saved?: boolean }) {
  let suppliers: Supplier[] = []; let loadError = ""; let canManage = false;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await createClient();
    const [perm, result] = await Promise.all([
      db.rpc("has_table_access", { resource: "suppliers", action: "update" }),
      db.from("suppliers").select("id,name,tax_id,phone,whatsapp,email,city,state,payment_terms,notes,status").order("name"),
    ]);
    canManage = Boolean(perm.data);
    suppliers = (result.data as Supplier[]) ?? [];
    loadError = result.error?.message ?? "";
  }
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/configuracoes" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft className="h-4 w-4" />Voltar</Link>
      <div className="mb-7">
        <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Operação</p>
        <h1 className="mt-2 text-3xl font-black">Fornecedores</h1>
        <p className="mt-1 text-sm text-ink/50">Cadastro de fornecedores e dados de contato.</p>
      </div>
      {(error || loadError) && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error || loadError}</p>}
      {saved && <p className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Fornecedor salvo.</p>}
      {canManage && (
        <details className="card mb-5">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-5 font-black"><Plus className="h-4 w-4" />Novo fornecedor</summary>
          <SupplierForm states={states} />
        </details>
      )}
      <div className="space-y-3">
        {suppliers.map(s => (
          <details key={s.id} className="card">
            <summary className="flex cursor-pointer list-none items-center justify-between p-4">
              <div>
                <p className="font-bold">{s.name}</p>
                <p className="text-xs text-ink/50">{[s.city, s.state].filter(Boolean).join(" – ") || "Sem localização"} · {s.status === "ativo" ? "Ativo" : "Inativo"}</p>
              </div>
              <span className="text-xs text-ink/40">{s.phone || s.email || ""}</span>
            </summary>
            <form action={saveSupplier} className="grid gap-3 border-t p-4 sm:grid-cols-2 lg:grid-cols-3">
              <input type="hidden" name="id" value={s.id} />
              <div className="sm:col-span-2 lg:col-span-3"><label className="label">Razão social / Nome</label><input className="field" name="name" defaultValue={s.name} disabled={!canManage} required /></div>
              <div><label className="label">CNPJ / CPF</label><input className="field" name="tax_id" defaultValue={s.tax_id ?? ""} disabled={!canManage} /></div>
              <div><label className="label">Telefone</label><input className="field" name="phone" defaultValue={s.phone ?? ""} disabled={!canManage} /></div>
              <div><label className="label">WhatsApp</label><input className="field" name="whatsapp" defaultValue={s.whatsapp ?? ""} disabled={!canManage} /></div>
              <div><label className="label">E-mail</label><input className="field" type="email" name="email" defaultValue={s.email ?? ""} disabled={!canManage} /></div>
              <div><label className="label">Cidade</label><input className="field" name="city" defaultValue={s.city ?? ""} disabled={!canManage} /></div>
              <div><label className="label">Estado</label><select className="field" name="state" defaultValue={s.state ?? ""} disabled={!canManage}><option value="">—</option>{states.map(st => <option key={st}>{st}</option>)}</select></div>
              <div><label className="label">Condição de pagamento</label><input className="field" name="payment_terms" defaultValue={s.payment_terms ?? ""} disabled={!canManage} placeholder="Ex.: 30/60 dias" /></div>
              <div className="sm:col-span-2"><label className="label">Observações</label><input className="field" name="notes" defaultValue={s.notes ?? ""} disabled={!canManage} /></div>
              <div className="flex items-center gap-4 self-end">
                <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" name="status_ativo" defaultChecked={s.status === "ativo"} disabled={!canManage} />Ativo</label>
              </div>
              {canManage && (
                <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
                  <button className="button gap-2"><Save className="h-4 w-4" />Salvar</button>
                  <button formAction={deleteSupplier} className="button-ghost gap-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" />Excluir</button>
                </div>
              )}
            </form>
          </details>
        ))}
        {!suppliers.length && <div className="card p-8 text-center text-sm text-ink/45">Nenhum fornecedor cadastrado ainda.</div>}
      </div>
    </div>
  );
}

function SupplierForm({ states }: { states: string[] }) {
  return (
    <form action={saveSupplier} className="grid gap-3 border-t p-5 sm:grid-cols-2 lg:grid-cols-3">
      <div className="sm:col-span-2 lg:col-span-3"><label className="label">Razão social / Nome *</label><input className="field" name="name" required placeholder="Ex.: Aço Center Ltda" /></div>
      <div><label className="label">CNPJ / CPF</label><input className="field" name="tax_id" placeholder="00.000.000/0001-00" /></div>
      <div><label className="label">Telefone</label><input className="field" name="phone" /></div>
      <div><label className="label">WhatsApp</label><input className="field" name="whatsapp" /></div>
      <div><label className="label">E-mail</label><input className="field" type="email" name="email" /></div>
      <div><label className="label">Cidade</label><input className="field" name="city" /></div>
      <div><label className="label">Estado</label><select className="field" name="state"><option value="">—</option>{states.map(st => <option key={st}>{st}</option>)}</select></div>
      <div><label className="label">Condição de pagamento</label><input className="field" name="payment_terms" placeholder="Ex.: 30/60 dias" /></div>
      <div className="sm:col-span-2"><label className="label">Observações</label><input className="field" name="notes" /></div>
      <label className="flex items-center gap-2 self-end pb-3 text-sm font-bold"><input type="checkbox" name="status_ativo" defaultChecked />Ativo</label>
      <button className="button sm:col-span-2 lg:col-span-3"><Save className="h-4 w-4" />Salvar fornecedor</button>
    </form>
  );
}
