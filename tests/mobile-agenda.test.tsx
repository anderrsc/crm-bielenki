// @vitest-environment jsdom
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MobileAgenda,MobileEventSheet} from '@/components/mobile-agenda';
import {AgendaPage,type AgendaEvent} from '@/components/agenda-page';
import {agendaContactLinks,agendaMapLinks} from '@/lib/agenda-location';
const actions=vi.hoisted(()=>({getAgendaEventDetails:vi.fn(),getAgendaEvents:vi.fn(),updateAgendaEventStatus:vi.fn(),createAgendaEvent:vi.fn()}));
vi.mock('@/app/(crm)/agenda-actions',()=>actions);
const mobile=vi.hoisted(()=>({value:true}));vi.mock('@/lib/use-mobile',()=>({useMobile:()=>mobile.value}));
vi.mock('next/link',()=>({default:({children,...props}:any)=><a {...props}>{children}</a>}));
const event:AgendaEvent={id:'00000000-0000-4000-8000-000000000123',source:'measurements',type:'medicao',title:'Medição de portas e janelas da obra do cliente',client_name:'Cliente da medição',responsible_name:'Rose',starts_at:'2026-11-09T12:00:00-03:00',status:'agendado',description:'Ligar antes de chegar'};
const details={address:'Rua Teste, 123, Rau, Jaraguá do Sul, SC',phone:'(47) 99999-9999',clientId:'00000000-0000-4000-8000-000000000321',clientName:'Cliente da medição',notes:'Ligar antes de chegar',relatedHref:'/medicoes/'+event.id,relatedLabel:'Abrir medição'};
beforeEach(()=>{mobile.value=true;actions.getAgendaEventDetails.mockResolvedValue(details);window.history.replaceState({},'','/agenda')});
afterEach(()=>{cleanup();vi.clearAllMocks();document.body.style.overflow=''});
test('month days select a readable day list, and appointments open their own details',()=>{
 const cursor=vi.fn(),select=vi.fn();render(<MobileAgenda cursor={new Date('2026-11-09T12:00:00')} events={[event]} view="mes" loading={false} onCursor={cursor} onView={vi.fn()} onNew={vi.fn()} onSelect={select} onReload={vi.fn()}/>);
 const button=screen.getByRole('button',{name:`Abrir compromisso: ${event.title}`});expect(button.textContent).toContain(event.title);fireEvent.click(button);expect(select).toHaveBeenCalledWith(event);
 fireEvent.click(screen.getByRole('button',{name:/terça-feira, 10 de novembro, 0 compromissos/}));expect(cursor).toHaveBeenCalled();
});
test('completed appointments remain available in Todos and Concluídos',()=>{
 render(<MobileAgenda cursor={new Date('2026-11-09T12:00:00')} events={[{...event,status:'medicao_concluida'}]} view="dia" loading={false} onCursor={vi.fn()} onView={vi.fn()} onNew={vi.fn()} onSelect={vi.fn()} onReload={vi.fn()}/>);
 expect(screen.queryByRole('button',{name:`Abrir compromisso: ${event.title}`})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Concluídos'}));expect(screen.getByRole('button',{name:`Abrir compromisso: ${event.title}`})).toBeTruthy();
});
test('detail sheet loads the authorized record, map destinations, contacts and notes',async()=>{
 const close=vi.fn();render(<MobileEventSheet event={event} onClose={close} onStatusChange={vi.fn()}/>);
 await waitFor(()=>expect(screen.getByText(details.address)).toBeTruthy());expect(actions.getAgendaEventDetails).toHaveBeenCalledWith(event.id,'measurements');
 expect(screen.getByRole('link',{name:'Google Maps'}).getAttribute('href')).toContain(encodeURIComponent(details.address));
 expect(screen.getByRole('link',{name:'Waze'}).getAttribute('href')).toContain('navigate=yes');expect(screen.getByRole('link',{name:'WhatsApp'}).getAttribute('href')).toBe('https://wa.me/5547999999999');
 expect(screen.getByText('Ligar antes de chegar')).toBeTruthy();expect(screen.getByRole('link',{name:'Abrir medição'}).getAttribute('href')).toBe('/medicoes/'+event.id);
 expect(document.body.style.overflow).toBe('hidden');fireEvent.keyDown(document,{key:'Escape'});expect(close).toHaveBeenCalled();
});
test('missing location does not invent a route and loading failures can be retried',async()=>{
 actions.getAgendaEventDetails.mockRejectedValueOnce(new Error('Conexão interrompida')).mockResolvedValueOnce({...details,address:null,phone:null});
 render(<MobileEventSheet event={event} onClose={vi.fn()} onStatusChange={vi.fn()}/>);await screen.findByText('Conexão interrompida');fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await screen.findByText('Endereço não informado');expect(screen.queryByRole('link',{name:'Google Maps'})).toBeNull();
});
test('mobile agenda deep link opens the selected appointment while desktop keeps the month grid',async()=>{
 window.history.replaceState({},'',`/agenda?evento=${event.id}&origem=measurements`);
 const {unmount}=render(<AgendaPage initialEvents={[event]}/>);await screen.findByRole('dialog',{name:event.title});unmount();mobile.value=false;
 render(<AgendaPage initialEvents={[event]}/>);await screen.findByRole('button',{name:'Novo evento'});expect(screen.queryByTestId('mobile-agenda')).toBeNull();expect(screen.queryByRole('dialog')).toBeNull();
});
test('location links encode arbitrary addresses and contacts use validated phone digits',()=>{
 expect(agendaMapLinks(null)).toBeNull();expect(agendaMapLinks('  ')).toBeNull();expect(agendaMapLinks('Rua A & B #3')?.google).toContain('Rua%20A%20%26%20B%20%233');
 expect(agendaContactLinks('123')).toBeNull();expect(agendaContactLinks('(47) 99999-9999')?.call).toBe('tel:+5547999999999');
});
