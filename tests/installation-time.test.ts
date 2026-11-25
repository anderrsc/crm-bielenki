import {expect,test} from 'vitest';
import {durationLabel,suggestDailyInstallations,type TimeDay,type TimeOption} from '@/lib/installation-time';
const day=(id:string):TimeDay=>({id,team_name:id,status:'planejada',crew_review_required:false,work_minutes:480,reserved_minutes:0});
const job=(id:string,hour:number,minutes:number|null):TimeOption=>({id,source:'installations',title:id,event_type:'instalacao',duration_minutes:minutes,starts_at:`2026-11-25T${String(hour).padStart(2,'0')}:00:00-03:00`});
test('formata duração interna sem transformar ausência em zero',()=>{expect(durationLabel(null)).toBe('A informar');expect(durationLabel(90)).toBe('1 h 30 min');expect(durationLabel(480)).toBe('8 h');});
test('distribui instalações por tempo livre e respeita horários simultâneos',()=>{
 const p=suggestDailyInstallations([day('a'),day('b')],[],[job('1',8,120),job('2',8,180),job('3',11,120)]);
 expect(p.assignments.map(a=>a.day_id)).toEqual(['a','b','a']);expect(p.skipped).toEqual([]);
});
test('reserva e jornada impedem sobrecarga; duração ausente e serviço longo ficam para revisão',()=>{
 const d={...day('a'),reserved_minutes:120};const p=suggestDailyInstallations([d],[],[job('1',8,360),job('2',15,60),job('3',17,null),job('4',18,960)]);
 expect(p.assignments.map(a=>a.source_id)).toEqual(['1']);expect(p.skipped).toHaveLength(3);
 expect(p.skipped[1].reason).toContain('duração');expect(p.skipped[2].reason).toContain('ultrapassa');
});
test('visitas existentes sem tempo ou aguardando revisão impedem sugestão naquela saída',()=>{
 for(const visit of [{duration_minutes:null,needs_review:false},{duration_minutes:60,needs_review:true}]){
  const p=suggestDailyInstallations([day('a')],[{day_id:'a',active:true,scheduled_at:job('x',7,60).starts_at,...visit}],[job('1',10,60)]);expect(p.assignments).toEqual([]);
 }
});
test('ignora já alocadas e repetidas; não presume duração de medição nem muda horários',()=>{
 const a=job('1',8,60);const p=suggestDailyInstallations([day('a')],[],[a,a,{...job('2',10,60),allocated:true},{...job('3',11,60),event_type:'medicao'}]);
 expect(p.assignments).toHaveLength(1);expect(p.assignments[0].starts_at).toBe(a.starts_at);
});
