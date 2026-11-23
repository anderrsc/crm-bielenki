import {beforeEach,expect,test,vi} from 'vitest';
const f=vi.hoisted(()=>({allowed:true,upload:vi.fn(),rpc:vi.fn()}));
const company='00000000-0000-4000-8000-000000000aa1',production='00000000-0000-4000-8000-000000000aa2';
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw new Error(`REDIRECT ${url}`);}}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})},from:(table:string)=>{
  const result=table==='profiles'?{company_id:company}:table==='production_orders'?{id:production,company_id:company,current_step:2,flow_type:'calhas',status:'em_producao',order_id:'order'}:null;
  const q:any={select:()=>q,eq:()=>q,limit:()=>q,single:async()=>({data:result}),maybeSingle:async()=>({data:result})};return q;
},rpc:async(name:string,args:unknown)=>{f.rpc(name,args);return name==='has_table_access'?{data:f.allowed}:{error:null};},storage:{from:()=>({upload:f.upload})}})}));
import {uploadProductionStepPhoto} from '@/app/(crm)/production-photo-actions';
const form=(contents:Uint8Array|string=new Uint8Array([255,216,255,0]))=>{const data=new FormData();data.set('production_order_id',production);data.set('step_number','2');data.set('photo',new File([contents as BlobPart],'foto.jpg',{type:'image/jpeg'}));return data;};
beforeEach(()=>{f.allowed=true;f.upload.mockReset().mockResolvedValue({error:null});f.rpc.mockReset();});
test('upload autorizado grava referência privada, sem URL pública',async()=>{
  await expect(uploadProductionStepPhoto(form())).rejects.toThrow(/Foto\+adicionada/);
  const path=f.upload.mock.calls[0][0];
  expect(path).toMatch(new RegExp(`^${company}/production/${production}/step-2/[a-f0-9-]+\\.jpg$`));
  expect(f.rpc).toHaveBeenCalledWith('add_production_step_photo',expect.objectContaining({p_photo_url:path,p_step_number:2}));
});
test('sem permissão não envia arquivo; HTML disfarçado de foto também não',async()=>{
  f.allowed=false;
  await expect(uploadProductionStepPhoto(form())).rejects.toThrow(/permissão/);
  expect(f.upload).not.toHaveBeenCalled();
  f.allowed=true;
  await expect(uploadProductionStepPhoto(form('<html>fake photo</html>'))).rejects.toThrow(/válida/);
  expect(f.upload).not.toHaveBeenCalled();
});
test('etapa futura não recebe upload',async()=>{
  const data=form();data.set('step_number','3');
  await expect(uploadProductionStepPhoto(data)).rejects.toThrow(/não\+iniciada/);
  expect(f.upload).not.toHaveBeenCalled();
});
