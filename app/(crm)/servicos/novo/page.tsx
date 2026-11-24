import Link from "next/link";
import { getRequestClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/friendly-error";
import { SubmitButton } from "@/components/submit-button";
import { FormMemory } from "@/components/form-memory";
import { ServiceFields } from "@/components/service-fields";
import { createService } from "@/app/(crm)/service-actions";

export default async function NewServicePage({ searchParams }: { searchParams: Promise<{ pedido?: string; cliente?: string; erro?: string }> }) {
  const search = await searchParams;
  const db = await getRequestClient();
  const uuid = /^[0-9a-f-]{36}$/i;
  const [clients, orders, people, allowed] = await Promise.all([
    db.from("clients").select("id,name").order("name").limit(2000),
    db.from("orders").select("id,order_number,client:clients(name)").order("created_at", { ascending: false }).limit(300),
    db.from("profiles").select("id,full_name").eq("status", "ativo").order("full_name"),
    db.rpc("has_table_access", { resource: "service_orders", action: "insert" }),
  ]);
  const orderId = search.pedido && uuid.test(search.pedido) ? search.pedido : "";
  const clientId = search.cliente && uuid.test(search.cliente) ? search.cliente : "";
  const orderList = (orders.data ?? []) as unknown as { id: string; order_number: string; client: { name?: string } | null }[];

  return <div className="mx-auto max-w-4xl space-y-5">
    <Link href="/servicos" className="text-sm font-semibold text-forest underline">Voltar aos serviços</Link>
    <h1 className="text-3xl font-semibold">Novo serviço</h1>
    {search.erro && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{friendlyError(search.erro)?.slice(0, 250)}</p>}
    {allowed.data !== true ? <p role="status" className="card p-6">Seu acesso não permite criar serviços.</p> :
      <form action={createService} className="card space-y-6 p-5 sm:p-7"><FormMemory id="servico-novo" />
        <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-sm font-semibold">Este serviço está relacionado a uma instalação realizada anteriormente pela empresa?</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="related" value="sim" defaultChecked={!!orderId} /> Sim, de um pedido anterior</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="related" value="nao" defaultChecked={!orderId} /> Não, é um serviço independente</label>
          <label><span className="label">Pedido anterior (se houver)</span><select name="order_id" className="field" defaultValue={orderId}><option value="">Nenhum</option>{orderList.map((o) => <option key={o.id} value={o.id}>{o.order_number}{o.client?.name ? ` · ${o.client.name}` : ""}</option>)}</select></label>
          <label><span className="label">Cliente</span><select name="client_id" className="field" defaultValue={clientId}><option value="">Escolha… (ou use o do pedido)</option>{(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <p className="text-xs text-ink/55 sm:col-span-2">Com um pedido escolhido, o cliente e o orçamento vêm dele. Estar ligado a um pedido não significa garantia: escolha a classificação abaixo. Cliente novo? <Link className="underline" href="/clientes/novo">Cadastre primeiro</Link>.</p>
        </fieldset>
        <ServiceFields people={(people.data ?? []) as { id: string; full_name: string }[]} />
        <SubmitButton className="button">Criar serviço</SubmitButton>
      </form>}
  </div>;
}
