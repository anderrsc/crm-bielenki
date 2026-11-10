// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PipelineBoard, type Stage, type Lead } from '@/components/pipeline-board';
vi.mock('@/app/(crm)/actions', () => ({ moveLeadStage: vi.fn() }));
afterEach(cleanup);
const stages: Stage[] = ['Novo lead','Contato realizado','Orçamento enviado','Negociação','Ganho','Perdido'].map((name,i) => ({id:String(i),name,color:null,sort_order:i,is_won:i===4,is_lost:i===5}));
const lead: Lead = {id:'lead1',name:'Cliente com nome completo muito longo para conferir sem cortes',phone:null,source:'Indicação de cliente',stage_id:'1',estimated_value:200,next_action:'Retornar para confirmar as medidas e o orçamento',next_action_date:'2026-11-01',status:'aberto',owner_id:'owner1',stage_changed_at:'2026-10-25',owner:{full_name:'Atendente com nome completo'},client:{neighborhood:'Ilha da Figueira',city:'Jaraguá do Sul'}};
const board = (leads = [lead]) => <PipelineBoard initialStages={stages} initialLeads={leads} currentUserId="owner1" nowIso="2026-11-10T12:00:00Z" today="2026-11-10"/>;
test('todas as etapas aparecem por padrão e nomes completos permanecem legíveis', () => {
  render(board());
  expect(screen.getAllByRole('region')).toHaveLength(6);
  expect(screen.getByText(lead.name).className).not.toContain('truncate');
  expect(screen.getByText('Ilha da Figueira · Jaraguá do Sul').className).not.toContain('truncate');
  fireEvent.click(screen.getByRole('checkbox', {name:'Mostrar perdidas'}));
  expect(screen.getAllByRole('region')).toHaveLength(5);
});
test('oportunidade atrasada e parada conta uma única vez no indicador de atenção', () => {
  render(board());
  const card = screen.getByText('Precisam de atenção').closest('.card');
  expect(card?.querySelector('.display-font')?.textContent).toBe('1');
});
test('busca e filtros continuam encontrando dados do cartão e deixam a etapa visível', () => {
  render(board([lead,{...lead,id:'lost',name:'Cliente perdido',stage_id:'5',status:'perdido'}]));
  fireEvent.change(screen.getByRole('textbox',{name:'Buscar oportunidade'}),{target:{value:'Ilha da Figueira'}});
  expect(screen.getByText(lead.name)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Follow-up atrasado/}));
  expect(screen.queryByText('Cliente perdido')).toBeNull();
  expect(screen.getAllByRole('region')).toHaveLength(6);
});
