import {beforeEach,expect,test,vi} from 'vitest';
const {rpc,revalidate}=vi.hoisted(()=>({rpc:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc})}));
vi.mock('next/cache',()=>({revalidatePath:revalidate}));
import {applyInstallationSuggestions,saveQuoteInstallationDuration} from '@/app/(crm)/installation-planning-actions';
import {saveWorkPlanning} from '@/app/(crm)/work-planning-actions';
const id='00000000-0000-4000-8000-00000000d001';
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:1,error:null});revalidate.mockClear();});
test('salva tempo interno pela RPC autenticada sem alterar documentos ou financeiro',async()=>{
 expect(await saveQuoteInstallationDuration(id,90)).toEqual({ok:true});expect(rpc).toHaveBeenCalledWith('set_quote_installation_duration',{p_quote:id,p_minutes:90});
 expect(await saveQuoteInstallationDuration(id,0)).toHaveProperty('error');expect(rpc).toHaveBeenCalledTimes(1);
});
test('sugestão só chega à RPC com IDs, data e tempos válidos e revalida a tela',async()=>{
 const assignment={day_id:id,source:'installations',source_id:id,title:'Serviço',duration_minutes:120,starts_at:'2026-12-01T08:00:00-03:00'};
 expect(await applyInstallationSuggestions('2026-12-01',[assignment])).toEqual({ok:true,count:1});expect(rpc).toHaveBeenCalledWith('work_apply_suggestions',{p_date:'2026-12-01',p_assignments:[expect.not.objectContaining({title:'Serviço'})]});
 await applyInstallationSuggestions('2026-12-01',[{...assignment,day_id:'bad'}]);expect(rpc).toHaveBeenCalledTimes(1);
});
test('jornada de 8 horas é convertida para 480 minutos com reserva explícita',async()=>{
 const f=new FormData();for(const [k,v]of Object.entries({action:'day_time',id,work_hours:'8',reserved_minutes:'60'}))f.set(k,v);
 expect(await saveWorkPlanning(f)).toContain('salvo=');expect(rpc).toHaveBeenCalledWith('work_planning_time',{p_action:'day_time',p_payload:{id,work_minutes:480,reserved_minutes:60}});
 f.set('reserved_minutes','600');expect(await saveWorkPlanning(f)).toContain('Confira');expect(rpc).toHaveBeenCalledTimes(1);
});
