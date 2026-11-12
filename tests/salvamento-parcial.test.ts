// Salvamento parcial do orcamento de calhas: se os itens complementares
// (condutores, acessorios, pintura) nao gravarem, o usuario e avisado e o
// subtotal volta a contar so as calhas (o PDF nunca mostra total maior que a soma).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const QUOTE='00000000-0000-4000-8000-000000000020';
const state=vi.hoisted(()=>({rpc:vi.fn(),inserts:[] as any[],updates:[] as any[],deletes:[] as string[],failInsertOn:'' as string,failDeleteOn:'' as string,user:{id:'00000000-0000-4000-8000-000000000001'} as any}));
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw new Error(`REDIRECT:${path}`)}}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('next/server',()=>({after:vi.fn()}));
vi.mock('next/headers',()=>({headers:async()=>({get:()=>null})}));
vi.mock('@/lib/generate-quote-pdf',()=>({generateQuotePdfBuffer:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>{
  const from=(table:string)=>{
    let result:any={data:table==='quote_items'?[{id:'old-item'}]:{id:QUOTE,company_id:'company'},error:null};
    const q:any={then:(r:any,j:any)=>Promise.resolve(result).then(r,j),single:async()=>result,maybeSingle:async()=>result};
    for(const m of ['select','eq','neq','order','limit','in'])q[m]=()=>q;
    q.insert=(v:any)=>{state.inserts.push({table,v});if(state.failInsertOn===table)result={data:null,error:{message:'falha simulada'}};return q};
    q.update=(v:any)=>{state.updates.push({table,v});return q};
    q.delete=()=>{state.deletes.push(table);if(state.failDeleteOn===table)result={data:null,error:{message:'falha simulada'}};return q};
    return q;
  };
  const createClient=async()=>({rpc:state.rpc,from,auth:{getUser:async()=>({data:{user:state.user},error:null})}});
  return {createClient,getRequestClient:createClient,getAuthUser:async()=>state.user};
});
import { saveGutterQuote, updateGutterQuote } from '@/app/(crm)/actions';

const payload={client_id:'00000000-0000-4000-8000-000000000010',discount:0,freight:0,notes:'',
  items:[{product:'Calha de Beiral',thickness:'0.50 mm',cut:'200',color:'Aluminio Natural',quantity:2,meters:5,unit_price:10}],
  special_items:[{product:'Condutor',item_type:'Condutores',unit:'unidade',quantity:3,unit_price:20}]};
const form=(extra:Record<string,string>={})=>{const f=new FormData();f.set('payload',JSON.stringify(payload));for(const[k,v]of Object.entries(extra))f.set(k,v);return f;};
const subtotalUpdates=()=>state.updates.filter(u=>u.table==='quotes'&&'subtotal'in u.v).map(u=>u.v.subtotal);

beforeEach(()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://test.supabase.co');state.rpc.mockResolvedValue({data:QUOTE,error:null});state.inserts=[];state.updates=[];state.deletes=[];state.failInsertOn='';state.failDeleteOn='';state.user={id:'00000000-0000-4000-8000-000000000001'};});
afterEach(()=>{vi.clearAllMocks();vi.unstubAllEnvs();});

test('novo orcamento: tudo grava e vai para a folha do orcamento',async()=>{
  await expect(saveGutterQuote(form())).rejects.toThrow(`REDIRECT:/orcamentos/${QUOTE}`);
  expect(state.inserts.some(i=>i.table==='quote_items')).toBe(true);
  expect(subtotalUpdates().at(-1)).toBe(160);
});

test('novo orcamento: itens complementares falham → aviso na edicao e subtotal so das calhas',async()=>{
  state.failInsertOn='quote_items';
  await expect(saveGutterQuote(form())).rejects.toThrow(/REDIRECT:\/orcamentos\/.*\/editar\?erro=.*complementares/);
  expect(subtotalUpdates().at(-1)).toBe(100);
});

test('editar orcamento: itens complementares falham → aviso e subtotal so das calhas',async()=>{
  state.failInsertOn='quote_items';
  await expect(updateGutterQuote(form({quote_id:QUOTE}))).rejects.toThrow(/editar\?erro=.*complementares/);
  expect(subtotalUpdates().at(-1)).toBe(100);
  expect(subtotalUpdates()).not.toContain(160);
});

test('editar orcamento: falha ao gravar os itens novos → os antigos nao sao apagados',async()=>{
  state.failInsertOn='quote_items';
  await expect(updateGutterQuote(form({quote_id:QUOTE}))).rejects.toThrow(/editar\?erro=/);
  expect(state.deletes.filter(t=>t==='quote_items')).toHaveLength(0);
});

test('editar orcamento: falha ao limpar os antigos → avisa para salvar de novo',async()=>{
  state.failDeleteOn='quote_items';
  await expect(updateGutterQuote(form({quote_id:QUOTE}))).rejects.toThrow(/editar\?erro=/);
});

test('sessao expirada no meio do salvamento: aviso claro, sem quebrar',async()=>{
  state.user=null;
  await expect(saveGutterQuote(form())).rejects.toThrow(/REDIRECT/);
});

test('editar com id invalido nao chega no banco',async()=>{
  await expect(updateGutterQuote(form({quote_id:'nao-e-uuid'}))).rejects.toThrow('REDIRECT:/orcamentos?erro=');
  expect(state.rpc).not.toHaveBeenCalled();
});
