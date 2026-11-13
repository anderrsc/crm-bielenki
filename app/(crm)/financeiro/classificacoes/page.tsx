import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getRequestClient } from "@/lib/supabase/server";
import { loadFinancialClassifications } from "@/lib/financial-classification";
import { money, shortDate } from "@/lib/utils";
import { DRE_GROUP_LABEL, DRE_GROUPS_BY_TYPE } from "@/lib/financial-dre";
import { FinancialClassificationFields } from "@/components/financial-classification-fields";
import { classifyFinancialEntry, saveFinancialDefinition, seedFinancialDefinitions } from "@/app/(crm)/financial-classification-actions";

export default async function FinancialClassificationPage({ searchParams }: { searchParams: Promise<{ lancamento?: string; erro?: string; salvo?: string }> }) {
  const search = await searchParams;
  const db = await getRequestClient();
  const { data: allowed, error: permissionError } = await db.rpc("has_table_access", { resource: "financial_entries", action: "update" });
  if (permissionError) return <p role="alert">Não foi possível verificar suas permissões. Atualize a página.</p>;
  let definitions;
  try { definitions = await loadFinancialClassifications(db); }
  catch { return <p role="alert">Não foi possível carregar as classificações. Atualize a página.</p>; }
  const { categories, centers } = definitions;
  let entry: { id: string; description: string; entry_type: "pagar" | "receber"; total_amount: number; category_id: string | null; cost_center_id: string | null; competence_date: string | null; created_at: string } | null = null;
  if (search.lancamento) {
    if (!z.uuid().safeParse(search.lancamento).success) notFound();
    const result = await db.from("financial_entries").select("id,description,entry_type,total_amount,category_id,cost_center_id,competence_date,created_at").eq("id", search.lancamento).maybeSingle();
    if (result.error) return <p role="alert">Não foi possível carregar a conta. Atualize a página.</p>;
    if (!result.data) notFound();
    entry = result.data;
  }
  return <div className="mx-auto max-w-5xl space-y-5">
    <Link href="/financeiro" className="text-sm font-bold text-forest underline">Voltar ao financeiro</Link>
    <h1 className="text-3xl font-black">{entry ? "Classificar conta" : "Categorias e centros de custos"}</h1>
    {search.erro && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{search.erro.slice(0, 250)}</p>}
    {search.salvo === "1" && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">Classificação salva.</p>}
    {entry ? <section className="card space-y-4 p-5">
      <h2 className="text-xl font-bold">{entry.description}</h2><p>Conta a {entry.entry_type} · {money(entry.total_amount)}</p>
      {allowed === true ? <form action={classifyFinancialEntry} className="space-y-4"><input type="hidden" name="id" value={entry.id} /><FinancialClassificationFields {...definitions} type={entry.entry_type} categoryId={entry.category_id} centerId={entry.cost_center_id} /><label className="block max-w-xs"><span className="label">Competência (mês a que a conta pertence)</span><input type="date" name="competence_date" className="field" defaultValue={entry.competence_date ?? ""} /><span className="mt-1 block text-xs text-ink/55">Em branco, a DRE usa a data de cadastro ({shortDate(entry.created_at)}).</span></label><button className="button">Salvar classificação</button></form> : <p>Você tem acesso de consulta. Não pode alterar esta conta.</p>}
      <Link href="/financeiro/classificacoes" className="inline-block text-sm font-bold text-forest underline">Gerenciar categorias e centros de custos</Link>
    </section> : <>
      <p className="text-sm text-ink/65">Desative os cadastros que deixarem de ser usados. Contas já classificadas mantêm o vínculo e o histórico.</p>
      {allowed === true && <form action={seedFinancialDefinitions}><button className="button-ghost">Cadastrar sugestões iniciais</button><p className="mt-2 text-xs text-ink/60">Adiciona categorias de receitas/despesas e centros de custos. Cadastros existentes são preservados.</p></form>}
      {(["category", "center"] as const).map(kind => <section key={kind} className="card space-y-4 p-5">
        <h2 className="text-xl font-bold">{kind === "category" ? "Categorias financeiras" : "Centros de custos"}</h2>
        {allowed === true && <DefinitionForm kind={kind} />}
        {(kind === "category" ? categories : centers).length === 0 && <p className="text-sm text-ink/60">Nenhum cadastro. {allowed === true ? "Cadastre acima ou use as sugestões iniciais." : "Solicite o cadastro ao responsável pelo financeiro."}</p>}
        {(kind === "category" ? categories : centers).map(item => allowed === true ? <DefinitionForm key={item.id} kind={kind} item={item} /> : <p key={item.id}>{item.name}{"entry_type" in item ? ` · ${item.entry_type === "pagar" ? "Despesa" : "Receita"}` : ""}{item.active ? "" : " · Inativo"}</p>)}
      </section>)}
    </>}
  </div>;
}

function DefinitionForm({ kind, item }: { kind: "category" | "center"; item?: { id: string; name: string; active: boolean; entry_type?: string; dre_group?: string | null } }) {
  const groups = item?.entry_type === "receber" ? DRE_GROUPS_BY_TYPE.receber : item ? DRE_GROUPS_BY_TYPE.pagar : [...DRE_GROUPS_BY_TYPE.pagar, "receita" as const];
  return <form action={saveFinancialDefinition} className={`grid items-end gap-3 rounded-xl border border-sand p-3 ${kind === "category" ? "sm:grid-cols-[2fr_1fr_1.5fr_auto_auto]" : "sm:grid-cols-[2fr_1fr_auto_auto]"}`}>
    <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={item?.id ?? ""} />
    <label><span className="label">{item ? "Nome" : "Novo cadastro"}</span><input name="name" className="field" defaultValue={item?.name} maxLength={80} required /></label>
    {kind === "category" ? <label><span className="label">Tipo</span><select name="entry_type" className="field" defaultValue={item?.entry_type ?? "pagar"}><option value="pagar">Despesa</option><option value="receber">Receita</option></select></label> : <span />}
    {kind === "category" && <label><span className="label">Linha da DRE</span><select name="dre_group" className="field" defaultValue={item?.dre_group ?? ""}><option value="">Padrão do tipo</option>{groups.map(g => <option key={g} value={g}>{DRE_GROUP_LABEL[g]}</option>)}</select></label>}
    <label className="flex min-h-10 items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked={item?.active ?? true} />Ativo</label>
    <button className="button">{item ? "Salvar" : "Cadastrar"}</button>
  </form>;
}
