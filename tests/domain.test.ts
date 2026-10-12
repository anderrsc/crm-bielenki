import { afterEach, describe, expect, test, vi } from 'vitest';
import { summarizePending, type PendingItem } from '@/lib/pending';
import { agendaStatus, agendaTimestamp } from '@/lib/agenda';
import { pageNumber, searchFilter } from '@/lib/query';
import { money, shortDate, localISODate, proxyLogoUrl } from '@/lib/utils';
import { encryptSecret, decryptSecret, maskSecret } from '@/lib/encrypt';
import { gutterCategoryForProduct, gutterItemTypeForCategory, isFabricationCategory, normalizeGutterThickness, normalizeGutterColor } from '@/lib/gutters';

afterEach(() => vi.unstubAllEnvs());
const item = (category: string, priority = 'low', due_date: string | null = null): PendingItem => ({record_id:'same-record',category,priority,due_date,title:'Registro',subtitle:'',link:'/financeiro',days_late:null,amount:null,client_name:null});

describe('pending center daily filters', () => {
  test('financial count combines receivable and payable', () => {
    const result = summarizePending([item('financeiro_receber'),item('financeiro_pagar'),item('compra')], 'financeiro');
    expect(result.counts.financeiro).toBe(2); expect(result.filtered).toHaveLength(2);
  });
  test('urgent banner reflects the selected category', () => expect(summarizePending([item('compra','high'),item('medicao')], 'medicao').totalHigh).toBe(0));
  test('does not match arbitrary category prefixes', () => expect(summarizePending([item('compra_extra')], 'compra').filtered).toHaveLength(0));
  test('sorts urgent items first, then due dates, without changing input', () => {
    const input = [item('compra'),item('medicao','high','2026-10-12'),item('producao','high','2026-10-10')];
    expect(summarizePending(input).filtered.map(x=>x.category)).toEqual(['producao','medicao','compra']); expect(input[0].category).toBe('compra');
  });
  test('empty categories have no urgent items', () => expect(summarizePending([])).toEqual({counts:{},filtered:[],totalHigh:0}));
});

describe('agenda dates and status', () => {
  test('08:00 in Brazil is 11:00 UTC', () => expect(new Date(agendaTimestamp('2026-10-12','08:00')).toISOString()).toBe('2026-10-12T11:00:00.000Z'));
  test('accepts leap-day on leap years', () => expect(agendaTimestamp('2028-02-29','23:59')).toContain('-03:00'));
  test.each([['2026-02-29','08:00'],['2026-04-31','08:00'],['2026-10-12','24:00'],['2026-10-12','08:60'],['invalid','08:00'],['2026-10-12','']])('rejects invalid date/time %s %s',(d,t)=>expect(()=>agendaTimestamp(d,t)).toThrow());
  test.each([['measurements','concluido','medicao_concluida'],['measurements','em_andamento','em_medicao'],['installations','concluido','concluida'],['installations','agendado','agendada'],['tasks','concluido','concluido'],['operational_events','cancelado','cancelado']] as const)('maps %s %s to domain state %s',(source,status,expected)=>expect(agendaStatus(source,status)).toBe(expected));
  test('rejects unknown statuses',()=>expect(()=>agendaStatus('tasks','paid')).toThrow());
});

describe('pagination and search', () => {
  test.each(['NaN','Infinity','-2','0','1.5','9007199254740992','bad',''])('invalid page %s falls back to page one',p=>expect(pageNumber(p)).toBe(1));
  test.each(['1','2','50'])('valid page %s',p=>expect(pageNumber(p)).toBe(Number(p)));
  test('quotes PostgREST input with separators',()=>expect(searchFilter(['name','phone'],'João, (Rau)')).toBe('name.ilike."%João, (Rau)%",phone.ilike."%João, (Rau)%"'));
  test('escapes wildcard and quotes',()=>expect(searchFilter(['name'],'10%_"')).toBe('name.ilike."%10\\%\\_\\"%"'));
});

describe('quote catalog',()=>{
  test.each([['Calha de Beiral','Calhas'],['Rufo de Acabamento','Rufos'],['Pingadeira','Pingadeiras'],['Condutor de PVC Redondo 75mm','Condutores'],['Tubo Vedante PU MS40','Acessórios'],['Mão de Obra de Manutenção','Serviços'],['Chaminé em Alumínio Ø300mm','Itens Especiais']])('classifies %s', (p,c)=>expect(gutterCategoryForProduct(p)).toBe(c));
  test.each([['Serviços','servico'],['Condutores','condutor'],['Acessórios','item_especial'],['Itens Especiais','item_especial'],['Calhas','fabricacao']])('uses item type for %s',(c,t)=>expect(gutterItemTypeForCategory(c)).toBe(t));
  test.each(['Serviços','Acessórios','Itens Especiais','Condutores'])('%s does not require fabricated dimensions',c=>expect(isFabricationCategory(c)).toBe(false));
  test.each([['0,5mm','0.50 mm'],['0.60 mm','0.60 mm'],['1mm','1.00 mm']])('normalizes thickness %s',(v,e)=>expect(normalizeGutterThickness(v)).toBe(e));
  test.each([['Natural','Aluminio Natural'],['branco','Pintura Branco'],['Preto','Pintura Preto']])('normalizes color %s',(v,e)=>expect(normalizeGutterColor(v)).toBe(e));
});

describe('money, dates and secrets',()=>{
  test('BRL decimal formatting',()=>expect(money(1234.5)).toMatch(/1\.234,50/));
  test.each([null,undefined])('missing amount is zero',v=>expect(money(v)).toMatch(/0,00/));
  test('date-only does not shift to the previous day',()=>expect(shortDate('2026-10-12')).toBe('12/10/2026'));
  test('invalid date has safe placeholder',()=>expect(shortDate('invalid')).toBe('Sem data'));
  test('logo proxy encodes URL',()=>expect(proxyLogoUrl('https://example.com/a?x=1&y=2')).toContain('%26y%3D2'));
  test('local ISO date preserves date',()=>expect(localISODate(new Date(2026,9,12,23))).toBe('2026-10-12'));
  test('encrypt/decrypt roundtrip with randomized IV',()=>{vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));const a=encryptSecret('test-secret');expect(decryptSecret(a)).toBe('test-secret');expect(encryptSecret('test-secret')).not.toBe(a);expect(maskSecret(a)).toBe('test***cret');});
  test('tampered ciphertext is not returned',()=>{vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));expect(decryptSecret('enc:invalid')).toBe('');});
  test('invalid key is rejected',()=>{vi.stubEnv('ENCRYPTION_KEY','bad');expect(()=>encryptSecret('secret')).toThrow();});
  test('short secrets are fully masked',()=>expect(maskSecret('abc')).toBe('***'));
});
