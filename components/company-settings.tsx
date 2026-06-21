import { updateCompanyIdentity } from "@/app/(crm)/actions";
import { createClient } from "@/lib/supabase/server";
import { Building2, ImagePlus, Megaphone, Ruler, Save } from "lucide-react";
import Link from "next/link";

const PAYMENT_METHOD_OPTIONS = [
  { value: "pix", label: "PIX" },
  { value: "cartao", label: "Cartão" },
  { value: "cheque", label: "Cheque" },
  { value: "dinheiro", label: "Dinheiro" },
];

export async function CompanySettings({ error, saved }: { error?: string; saved?: boolean }) {
let company: Record<string, string | null> = {};
if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
const db = await createClient();
const { data: profile } = await db.from("profiles").select("company_id").single();
if (profile?.company_id) { const result = await db.from("companies").select("*").eq("id", profile.company_id).single(); company = (result.data as Record<string,string|null>) ?? {}; }
}
const selectedPayments: string[] = Array.isArray(company.payment_methods_available)
  ? (company.payment_methods_available as unknown as string[])
  : (() => { try { return JSON.parse(String(company.payment_methods_available ?? "[]")); } catch { return ["pix", "cartao", "cheque", "dinheiro"]; } })();
return <div className="mx-auto max-w-5xl"><div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-forest text-white"><Building2 className="h-5 w-5" /></div><h1 className="text-3xl font-black">Identidade da empresa</h1><p className="mt-1 text-sm text-ink/50">Estes dados aparecem nos orçamentos e fichas de visita.</p></div><div className="flex flex-wrap gap-2"><Link href="/configuracoes/origens-lead" className="button-ghost"><Megaphone className="h-4 w-4"/>Origens de lead</Link><Link href="/configuracoes/tabela-calhas" className="button-ghost"><Ruler className="h-4 w-4"/>Tabela de preços</Link></div></div>
{error && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}{saved && <p className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Identidade atualizada com sucesso.</p>}
<form action={updateCompanyIdentity} className="card grid gap-5 p-6 sm:grid-cols-2 lg:p-8" encType="multipart/form-data">
<div className="sm:col-span-2"><label className="label">Logo da empresa</label><div className="flex items-center gap-4">{company.logo_url ? <img src={company.logo_url} alt="Logo atual" className="h-20 w-32 rounded-xl border bg-white object-contain p-2" /> : <div className="flex h-20 w-32 items-center justify-center rounded-xl border border-dashed bg-cream"><ImagePlus className="text-ink/35" /></div>}<input className="field max-w-md" type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" /></div><p className="mt-1 text-xs text-ink/40">PNG, JPG, WebP ou SVG. Máximo de 2 MB.</p></div>
<Field name="trade_name" label="Nome de destaque" value={company.trade_name ?? "Marquinhos Calhas e Esquadrias"} required /><Field name="name" label="Razão social" value={company.name} required /><Field name="tax_id" label="CNPJ" value={company.tax_id} /><Field name="whatsapp" label="WhatsApp" value={company.whatsapp} /><Field name="whatsapp_phone_number_id" label="ID do número no WhatsApp Cloud" value={company.whatsapp_phone_number_id} /><Field name="phone" label="Telefone" value={company.phone} /><Field name="email" label="E-mail" value={company.email} type="email" /><Field name="address" label="Endereço" value={company.address} /><Field name="neighborhood" label="Bairro" value={company.neighborhood} /><Field name="city" label="Cidade" value={company.city} /><Field name="state" label="Estado" value={company.state} maxLength={2} /><Field name="website" label="Site / Instagram" value={company.website} />
<div className="grid grid-cols-2 gap-4"><Color name="primary_color" label="Cor principal" value={company.primary_color ?? "#234d3c"} /><Color name="secondary_color" label="Cor secundária" value={company.secondary_color ?? "#111111"} /></div>
<div className="sm:col-span-2 grid gap-4 rounded-xl border border-sand/80 p-4 sm:grid-cols-2">
  <p className="sm:col-span-2 text-xs font-bold uppercase tracking-wider text-ink/55">QR Code do orçamento</p>
  <Field name="qr_code_url" label="Link de destino (portfólio, site, Instagram, WhatsApp ou catálogo)" value={company.qr_code_url} />
  <Field name="qr_code_label" label="Legenda sob o QR Code" value={company.qr_code_label ?? "Acesse nosso portfólio completo"} />
  <p className="sm:col-span-2 text-xs text-ink/40">Deixe o link em branco para manter o espaço reservado no orçamento sem quebrar o layout.</p>
</div>
<Field name="default_validity_days" label="Validade padrão dos orçamentos (dias)" value={company.default_validity_days ?? "15"} type="number" />
<div>
  <label className="label">Formas de pagamento aceitas</label>
  <div className="flex flex-wrap gap-3 rounded-xl border bg-white px-3.5 py-2.5">
    {PAYMENT_METHOD_OPTIONS.map((method) => (
      <label key={method.value} className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          name="payment_methods_available"
          value={method.value}
          defaultChecked={selectedPayments.includes(method.value)}
          className="accent-forest"
        />
        {method.label}
      </label>
    ))}
  </div>
  <p className="mt-1 text-xs text-ink/40">Somente as formas marcadas aqui ficam disponíveis para seleção em cada orçamento.</p>
</div>
<div className="sm:col-span-2"><label className="label">Rodapé dos orçamentos</label><textarea className="field min-h-24" name="quote_footer" defaultValue={company.quote_footer ?? ""} placeholder="Condições, garantia, prazo de execução ou mensagem comercial." /></div>
<div className="sm:col-span-2"><label className="label">Observações padrão dos orçamentos</label><textarea className="field min-h-28" name="quote_observations_default" defaultValue={company.quote_observations_default ?? ""} placeholder={"Uma observação por linha. Exemplo:\nInstalação inclusa.\nGarantia de 6 meses para calhas e acessórios."} /><p className="mt-1 text-xs text-ink/40">Uma observação por linha — aparecem automaticamente em novos orçamentos e podem ser editadas individualmente em cada um.</p></div>
<div className="flex justify-end sm:col-span-2"><button className="button"><Save className="h-4 w-4" /> Salvar identidade</button></div>
</form>
</div>;
}
function Field({ name,label,value,type="text",required,maxLength }:{name:string;label:string;value?:string|null;type?:string;required?:boolean;maxLength?:number}) { return <div><label className="label">{label}</label><input className="field" name={name} type={type} defaultValue={value ?? ""} required={required} maxLength={maxLength} /></div>; }
function Color({name,label,value}:{name:string;label:string;value:string}) { return <div><label className="label">{label}</label><input className="h-11 w-full cursor-pointer rounded-xl border bg-white p-1" type="color" name={name} defaultValue={value} /></div>; }
