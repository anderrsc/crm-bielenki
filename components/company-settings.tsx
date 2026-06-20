import { updateCompanyIdentity } from "@/app/(crm)/actions";
import { createClient } from "@/lib/supabase/server";
import { Building2, ImagePlus, Save } from "lucide-react";

export async function CompanySettings({ error, saved }: { error?: string; saved?: boolean }) {
  let company: Record<string, string | null> = {};
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await createClient();
    const { data: profile } = await db.from("profiles").select("company_id").single();
    if (profile?.company_id) { const result = await db.from("companies").select("*").eq("id", profile.company_id).single(); company = (result.data as Record<string,string|null>) ?? {}; }
  }
  return <div className="mx-auto max-w-5xl"><div className="mb-7"><div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-forest text-white"><Building2 className="h-5 w-5" /></div><h1 className="text-3xl font-black">Identidade da empresa</h1><p className="mt-1 text-sm text-ink/50">Estes dados aparecem nos orçamentos e fichas de visita.</p></div>
    {error && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}{saved && <p className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Identidade atualizada com sucesso.</p>}
    <form action={updateCompanyIdentity} className="card grid gap-5 p-6 sm:grid-cols-2 lg:p-8" encType="multipart/form-data">
      <div className="sm:col-span-2"><label className="label">Logo da empresa</label><div className="flex items-center gap-4">{company.logo_url ? <img src={company.logo_url} alt="Logo atual" className="h-20 w-32 rounded-xl border bg-white object-contain p-2" /> : <div className="flex h-20 w-32 items-center justify-center rounded-xl border border-dashed bg-cream"><ImagePlus className="text-ink/35" /></div>}<input className="field max-w-md" type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" /></div><p className="mt-1 text-xs text-ink/40">PNG, JPG, WebP ou SVG. Máximo de 2 MB.</p></div>
      <Field name="trade_name" label="Nome de destaque" value={company.trade_name ?? "Marquinhos Calhas e Esquadrias"} required /><Field name="name" label="Razão social" value={company.name} required /><Field name="tax_id" label="CNPJ" value={company.tax_id} /><Field name="whatsapp" label="WhatsApp" value={company.whatsapp} /><Field name="phone" label="Telefone" value={company.phone} /><Field name="email" label="E-mail" value={company.email} type="email" /><Field name="address" label="Endereço" value={company.address} /><Field name="neighborhood" label="Bairro" value={company.neighborhood} /><Field name="city" label="Cidade" value={company.city} /><Field name="state" label="Estado" value={company.state} maxLength={2} /><Field name="website" label="Site / Instagram" value={company.website} />
      <div className="grid grid-cols-2 gap-4"><Color name="primary_color" label="Cor principal" value={company.primary_color ?? "#234d3c"} /><Color name="accent_color" label="Cor de destaque" value={company.accent_color ?? "#b9d349"} /></div>
      <div className="sm:col-span-2"><label className="label">Rodapé dos orçamentos</label><textarea className="field min-h-24" name="quote_footer" defaultValue={company.quote_footer ?? ""} placeholder="Condições, garantia, prazo de execução ou mensagem comercial." /></div>
      <div className="flex justify-end sm:col-span-2"><button className="button"><Save className="h-4 w-4" /> Salvar identidade</button></div>
    </form>
  </div>;
}
function Field({ name,label,value,type="text",required,maxLength }:{name:string;label:string;value?:string|null;type?:string;required?:boolean;maxLength?:number}) { return <div><label className="label">{label}</label><input className="field" name={name} type={type} defaultValue={value ?? ""} required={required} maxLength={maxLength} /></div>; }
function Color({name,label,value}:{name:string;label:string;value:string}) { return <div><label className="label">{label}</label><input className="h-11 w-full cursor-pointer rounded-xl border bg-white p-1" type="color" name={name} defaultValue={value} /></div>; }
