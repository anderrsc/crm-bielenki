import {beforeEach,expect,test,vi} from 'vitest';
const state=vi.hoisted(()=>({rows:{} as Record<string,any>,calls:[] as {table:string;filters:[string,unknown][]}[]}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/lib/own-profile',()=>({selectOwnProfile:async()=>({data:{company_id:'company-a'}})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({from:(table:string)=>{const call={table,filters:[] as [string,unknown][]};state.calls.push(call);const q:any={select:()=>q,eq:(key:string,value:unknown)=>{call.filters.push([key,value]);return q},single:async()=>({data:state.rows[table]??null,error:state.rows[table]?null:{message:'Denied'}}),maybeSingle:async()=>({data:state.rows[table]??null,error:null})};return q}})}));
import {getAgendaEventDetails} from '@/app/(crm)/agenda-actions';
const id='00000000-0000-4000-8000-000000000123';
beforeEach(()=>{state.rows={};state.calls=[]});
test('event addresses take precedence over the customer address and all reads are tenant scoped',async()=>{
 state.rows.operational_events={id,client_id:'client-a',address:'Rua da Obra 456, Outra Cidade',phone:'47991112222',notes:'Portão azul',quote_id:id};
 state.rows.clients={id:'client-a',name:'Cliente A',address:'Rua da Residência',city:'Jaraguá do Sul',state:'SC',whatsapp:'47998887777'};
 const result=await getAgendaEventDetails(id,'operational_events');expect(result.address).toBe('Rua da Obra 456, Outra Cidade');expect(result.phone).toBe('47991112222');expect(result.relatedHref).toBe('/orcamentos/'+id);
 for(const q of state.calls)expect(q.filters).toContainEqual(['company_id','company-a']);
});
test('measurement reuses the full customer address and preserves visit notes',async()=>{
 state.rows.measurements={id,client_id:'client-a',address:'Rua Teste, 123',notes:'Ligar antes',sketch_notes:'Janela do quarto'};
 state.rows.clients={id:'client-a',name:'Cliente A',address:'Rua Teste, 123',neighborhood:'Rau',city:'Jaraguá do Sul',state:'SC',phone:'47998887777'};
 const r=await getAgendaEventDetails(id,'measurements');expect(r.address).toBe('Rua Teste, 123, Rau, Jaraguá do Sul, SC');expect(r.notes).toContain('Janela do quarto');expect(r.relatedLabel).toBe('Abrir medição');
});
test('unavailable and malformed commitments never leak another source',async()=>{
 await expect(getAgendaEventDetails(id,'installations')).rejects.toThrow('sem permissão');expect(state.calls.map(c=>c.table)).toEqual(['installations']);
 state.calls=[];await expect(getAgendaEventDetails('bad','measurements')).rejects.toThrow('inválido');expect(state.calls).toHaveLength(0);
});
