"use client";
import { ClientSelect } from "./client-select";

import { todayISO } from "@/lib/utils";
import { useErrorDraft } from "@/lib/form-draft";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2, UserRound } from "lucide-react";
import { FormBlock, ItemBadge, Note } from "./form-blocks";
import { createManualSale } from "@/app/(crm)/actions";
import { money } from "@/lib/utils";
import { useMemo, useState } from "react";
import type { ReactElement } from "react";

type Option={id:string;name:string};type Item={product:string;description:string;unit:string;quantity:number;unit_price:number;requires_purchase:boolean;requires_production:boolean};
const blank=():Item=>({product:"",description:"",unit:"un",quantity:1,unit_price:0,requires_purchase:false,requires_production:false});
export function ManualSaleForm({clients,saleTypes,error}:{clients:Option[];saleTypes:Option[];error?:string}){
  const [items,setItems]=useState<Item[]>([blank()]);const [clientId,setClientId]=useState("");const [saleTypeId,setSaleTypeId]=useState("");const [paid,setPaid]=useState(0);const [due,setDue]=useState(todayISO());const [method,setMethod]=useState("Pix");const [notes,setNotes]=useState("");
const rememberDraft=useErrorDraft("draft:venda-manual",{items,clientId,saleTypeId,paid,due,method,notes},(d)=>{setItems(d.items);setClientId(d.clientId);setSaleTypeId(d.saleTypeId);setPaid(d.paid);setDue(d.due);setMethod(d.method);setNotes(d.notes);});  const total=useMemo(()=>items.reduce((sum,x)=>sum+x.quantity*x.unit_price,0),[items]);const payload=JSON.stringify({client_id:clientId,sale_type_id:saleTypeId,paid_amount:paid,due_date:due,paid_at:todayISO(),payment_method:method,notes,items});
  const update=(index:number,key:keyof Item,value:string|boolean)=>setItems(current=>current.map((x,i)=>i===index?{...x,[key]:["quantity","unit_price"].includes(key)?Number(value):value}:x));
  const invalid=!clientId||!saleTypeId||total<=0||paid>total||paid<0||items.some(x=>!x.product.trim()||x.quantity<=0||x.unit_price<0||!globalThis.Number.isFinite(x.quantity*x.unit_price));
  return <div className="mx-auto max-w-6xl"><Link href="/vendas" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-ink/55"><ArrowLeft className="h-4 w-4"/>Voltar</Link><div className="mb-7"><p className="text-xs font-semibold text-forest">Lançamento manual</p><h1 className="mt-2 text-3xl font-semibold">Nova venda avulsa</h1><p className="mt-1 text-sm text-ink/50">Registra venda, itens, saldo e pagamento inicial em uma única operação.</p></div>{error&&<Note tone="error" role="alert" className="mb-5">{error}</Note>}
    <form onSubmit={rememberDraft} action={createManualSale} className="fx-layout fx-layout-wide"><input type="hidden" name="payload" value={payload}/>
      <div className="fx-stack">
        <FormBlock icon={UserRound} title="Cliente e tipo" hint="Quem comprou e o que está sendo vendido.">
          <div className="fx-grid fx-grid-2"><div><label className="label">Cliente</label><ClientSelect items={clients} value={clientId} onChange={setClientId}/></div><Select label="Tipo de venda" value={saleTypeId} onChange={setSaleTypeId} options={saleTypes}/></div>
        </FormBlock>
        {items.map((item,index)=><div className="fx-item" key={index}>
          <div className="fx-item-head"><ItemBadge n={index+1}/><b className="fx-item-title">Item {index+1}</b><button type="button" aria-label="Remover item" disabled={items.length===1} className="fx-remove" onClick={()=>setItems(x=>x.filter((_,i)=>i!==index))}><Trash2 className="h-4 w-4"/></button></div>
          <div className="fx-grid fx-grid-pair fx-grid-item">
            <div className="fx-wide"><Field label="Produto / serviço" value={item.product} onChange={v=>update(index,"product",v)}/></div>
            <Number label="Quantidade" value={item.quantity} onChange={v=>update(index,"quantity",v)}/>
            <Number label="Valor unitário" value={item.unit_price} onChange={v=>update(index,"unit_price",v)}/>
            <div className="fx-wide"><Field required={false} label="Descrição" value={item.description} onChange={v=>update(index,"description",v)}/></div>
            <Field label="Unidade" value={item.unit} onChange={v=>update(index,"unit",v)}/>
          </div>
          <div className="fx-toggles mt-3"><label className="fx-toggle"><input type="checkbox" checked={item.requires_purchase} onChange={e=>update(index,"requires_purchase",e.target.checked)}/>Exige compra</label><label className="fx-toggle"><input type="checkbox" checked={item.requires_production} onChange={e=>update(index,"requires_production",e.target.checked)}/>Exige produção</label></div>
          <p className="fx-item-total"><span>Total do item</span><b>{money(item.quantity*item.unit_price)}</b></p>
        </div>)}
        <button type="button" className="fx-add" onClick={()=>setItems(x=>[...x,blank()])}><Plus className="h-4 w-4"/>Adicionar item</button>
      </div>
      <aside className="fx-summary" aria-label="Resumo financeiro"><div><h2 className="fx-total-label">Financeiro</h2><p className="fx-total">{money(total)}</p>{paid>0&&<p className="fx-total-sub">Recebido {money(paid)} · saldo {money(Math.max(0,total-paid))}</p>}</div><div className="fx-grid"><Number label="Valor já recebido" value={paid} onChange={v=>setPaid(Number(v))}/><div><label className="label">Vencimento do saldo</label><input className="field" type="date" value={due} onChange={e=>setDue(e.target.value)}/></div><div><label className="label">Forma de pagamento</label><select className="field" value={method} onChange={e=>setMethod(e.target.value)}>{["Pix","Dinheiro","Cartão de crédito","Cartão de débito","Boleto","Transferência","Outro"].map(x=><option key={x}>{x}</option>)}</select></div><div><label className="label">Observações</label><textarea className="field min-h-24" value={notes} onChange={e=>setNotes(e.target.value)}/></div></div><button disabled={invalid} className="button fx-submit"><Save className="h-4 w-4"/>Cadastrar venda</button></aside></form>
  </div>;
}
function Select({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:Option[]}){return <div><label className="label">{label}</label><select aria-label={label} className="field" value={value} onChange={e=>onChange(e.target.value)} required><option value="">Selecione</option>{options.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></div>}
function Field({label,value,onChange,required=true}:{label:string;value:string;onChange:(v:string)=>void;required?:boolean}){return <div><label className="label">{label}</label><input aria-label={label} className="field" value={value} onChange={e=>onChange(e.target.value)} required={required}/></div>}
function Number(value:string|boolean):number;
function Number(props:{label:string;value:number;onChange:(v:string)=>void}):ReactElement;
function Number(input:string|boolean|{label:string;value:number;onChange:(v:string)=>void}){if(typeof input!=="object")return globalThis.Number(input);const{label,value,onChange}=input;return <div><label className="label">{label}</label><input aria-label={label} className="field" type="number" min="0" step="0.01" value={value} onChange={e=>onChange(e.target.value)} required/></div>}
