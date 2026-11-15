import { SERVICE_CLASSIFICATIONS, SERVICE_KINDS, SERVICE_PRIORITY } from "@/lib/service-orders";

export type ServiceValues = {
  kind?: string; classification?: string | null; description?: string; priority?: string; expected_date?: string | null; responsible_id?: string | null; team?: string | null;
  phone?: string | null; address?: string | null; neighborhood?: string | null; city?: string | null; location_url?: string | null; internal_notes?: string | null;
  billing?: string; expected_amount?: number | null; materials_used?: string | null; extra_expenses?: number | null;
};
const br = (n?: number | null) => (n === null || n === undefined ? "" : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));

/** Campos do servico, usados no cadastro e na edicao. */
export function ServiceFields({ value = {}, people }: { value?: ServiceValues; people: { id: string; full_name: string }[] }) {
  return <>
    <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-sm font-black">Serviço</legend>
      <label><span className="label">Tipo de serviço</span><select name="kind" className="field" required defaultValue={value.kind ?? ""}><option value="" disabled>Escolha…</option>{Object.entries(SERVICE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label><span className="label">Classificação (manutenções)</span><select name="classification" className="field" defaultValue={value.classification ?? ""}><option value="">Não se aplica</option>{Object.entries(SERVICE_CLASSIFICATIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="sm:col-span-2"><span className="label">Descrição do problema ou da atividade</span><textarea name="description" className="field min-h-24" required maxLength={2000} defaultValue={value.description ?? ""} placeholder="Ex.: calha dos fundos vazando na emenda" /></label>
      <label><span className="label">Prioridade</span><select name="priority" className="field" defaultValue={value.priority ?? "normal"}>{Object.entries(SERVICE_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label><span className="label">Data prevista</span><input type="date" name="expected_date" className="field" defaultValue={value.expected_date ?? ""} /></label>
      <label><span className="label">Responsável</span><select name="responsible_id" className="field" defaultValue={value.responsible_id ?? ""}><option value="">Não definido</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
      <label><span className="label">Equipe designada</span><input name="team" className="field" maxLength={120} defaultValue={value.team ?? ""} placeholder="Ex.: João e Pedro" /></label>
    </fieldset>
    <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-sm font-black">Local do atendimento <span className="font-normal text-ink/55">(em branco, usa o cadastro do cliente)</span></legend>
      <label><span className="label">Telefone / WhatsApp</span><input name="phone" className="field" inputMode="tel" maxLength={40} defaultValue={value.phone ?? ""} /></label>
      <label><span className="label">Endereço</span><input name="address" className="field" maxLength={200} defaultValue={value.address ?? ""} /></label>
      <label><span className="label">Bairro</span><input name="neighborhood" className="field" maxLength={120} defaultValue={value.neighborhood ?? ""} /></label>
      <label><span className="label">Cidade</span><input name="city" className="field" maxLength={120} defaultValue={value.city ?? ""} /></label>
      <label className="sm:col-span-2"><span className="label">Link da localização</span><input name="location_url" className="field" inputMode="url" maxLength={500} defaultValue={value.location_url ?? ""} placeholder="https://maps.app.goo.gl/…" /></label>
    </fieldset>
    <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-sm font-black">Cobrança</legend>
      <label><span className="label">Este serviço é</span><select name="billing" className="field" defaultValue={value.billing ?? "cobrado"}><option value="cobrado">Cobrado</option><option value="gratuito">Gratuito (garantia ou cortesia)</option></select></label>
      <label><span className="label">Valor previsto</span><input name="expected_amount" className="field" inputMode="decimal" placeholder="0,00" defaultValue={br(value.expected_amount)} /></label>
      <label><span className="label">Materiais utilizados</span><input name="materials_used" className="field" maxLength={2000} defaultValue={value.materials_used ?? ""} placeholder="Ex.: 2 m de calha, rebites, silicone" /></label>
      <label><span className="label">Despesas adicionais</span><input name="extra_expenses" className="field" inputMode="decimal" placeholder="0,00" defaultValue={br(value.extra_expenses || null)} /></label>
      <label className="sm:col-span-2"><span className="label">Observações internas</span><textarea name="internal_notes" className="field min-h-20" maxLength={2000} defaultValue={value.internal_notes ?? ""} /></label>
    </fieldset>
  </>;
}
