import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
vi.mock('@/app/(crm)/work-planning-actions',()=>({saveWorkPlanning:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({getRequestClient:vi.fn()}));
import {WorkPlanningView} from '@/components/work-planning-page';
import {planningDate, type loadWorkPlanning} from '@/lib/work-planning';
import {todayISO} from '@/lib/utils';
type Data=Awaited<ReturnType<typeof loadWorkPlanning>>;
const empty:Data={date:'2026-11-23',viewerId:'driver',manager:false,addLoad:false,days:[],teams:[],vehicles:[],jobs:[],members:[],people:[],roster:[],options:[],items:[],logs:[]};
test('operador só vê sua lista; cadastro e planejamento são da gerência',()=>{
 const html=renderToStaticMarkup(<WorkPlanningView data={empty}/>);
 expect(html).toContain('Nenhuma saída disponível para você');expect(html).not.toContain('Criar equipe');expect(html).not.toContain('Criar saída');
 const manager=renderToStaticMarkup(<WorkPlanningView data={{...empty,manager:true,addLoad:true}}/>);
 expect(manager).toContain('Criar equipe');expect(manager).toContain('Criar saída');expect(manager).toContain('name="members" multiple');
});
test('revisão bloqueia carregamento, mas permite conferir retorno de itens já carregados',()=>{
 const data:Data={...empty,days:[{id:'day',work_date:empty.date,team_id:'team',vehicle_id:'car',driver_id:'driver',team_name:'Equipe A',vehicle_name:'Van',driver_name:'Ana',notes:null,status:'planejada',crew_review_required:true}],jobs:[{id:'job',day_id:'day',event_id:'event',measurement_id:null,installation_id:null,order_id:null,title:'Medição',address:'Rua A',scheduled_at:'2026-11-23T12:00:00Z',position:1,active:true,needs_review:false}],members:[{id:'member',day_id:'day',profile_id:'driver',profile_name:'Ana',duty:'Motorista',released_at:null}],items:[{id:'item',job_id:'job',description:'Escada',kind:'ferramenta',quantity:1,unit:'un',state:'carregado',returned_quantity:null,active:true},{id:'item2',job_id:'job',description:'Vidro',kind:'item',quantity:1,unit:'un',state:'pendente',returned_quantity:null,active:true}]};
 const html=renderToStaticMarkup(<WorkPlanningView data={data}/>);
 expect(html).toContain('gerência precisa revisar');expect(html).toContain('Conferir retorno');expect(html).not.toContain('Marcar separado');expect(html).not.toContain('Incluir itens no carregamento');
 const removed=renderToStaticMarkup(<WorkPlanningView data={{...data,members:data.members.map(m=>({...m,released_at:'2026-11-23T10:00:00Z'}))}}/>);
 expect(removed).not.toContain('Conferir retorno');expect(removed).toContain('Escada');
});
test('dia inválido volta para hoje e data válida permanece',()=>{
 expect(planningDate('2026-02-30')).toBe(todayISO());expect(planningDate('invalido')).toBe(todayISO());expect(planningDate('2026-11-23')).toBe('2026-11-23');
});
