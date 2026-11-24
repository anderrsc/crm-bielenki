// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
const {apply,refresh}=vi.hoisted(()=>({apply:vi.fn().mockResolvedValue({ok:true,count:1}),refresh:vi.fn()}));
vi.mock('@/app/(crm)/installation-planning-actions',()=>({applyInstallationSuggestions:apply}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh})}));
import {DailyInstallationSuggestions} from '@/components/daily-installation-suggestions';
import {InstallationDurationInput} from '@/components/installation-duration-input';
afterEach(()=>{cleanup();vi.clearAllMocks();});
test('sugestão exige seleção e clique explícito, sem gravar ao abrir a página',async()=>{
 render(<DailyInstallationSuggestions date="2026-12-01" days={[{id:'day',team_name:'Equipe A',status:'planejada',crew_review_required:false}]} jobs={[]} options={[{id:'install',source:'installations',event_type:'instalacao',title:'Pedido teste',starts_at:'2026-12-01T08:00:00-03:00',duration_minutes:90}]}/>);
 expect(screen.getByText(/08:00 · 1 h 30 min · Equipe A/)).toBeTruthy();expect(apply).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('checkbox'));expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button'));
 await waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));expect(apply).toHaveBeenCalledWith('2026-12-01',[expect.objectContaining({day_id:'day',source_id:'install',duration_minutes:90})]);expect(refresh).toHaveBeenCalled();
});
test('horas fracionadas viram minutos e o campo vazio permanece sem estimativa',()=>{
 const change=vi.fn();const {rerender}=render(<InstallationDurationInput value={null} onChange={change}/>);const field=screen.getByRole('spinbutton');
 fireEvent.change(field,{target:{value:'1.5'}});expect(change).toHaveBeenLastCalledWith(90);rerender(<InstallationDurationInput value={90} onChange={change}/>);fireEvent.change(field,{target:{value:''}});expect(change).toHaveBeenLastCalledWith(null);
});
