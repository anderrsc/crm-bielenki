import {buildDre,monthsBetween,type DreLine} from '@/lib/financial-dre';
import {currentBalance,projectScenario,weeklyProjection,SCENARIOS,type CashOverview,type ScenarioKey} from '@/lib/cash-flow';
import {validIsoDate} from '@/lib/valid-date';
export const REPORTS={executivo:'Resumo financeiro executivo',mensal:'Resultado mensal',dre:'DRE gerencial',caixa:'Fluxo de caixa',vencidos:'Contas vencidas',fornecedores:'Contas por fornecedor',clientes:'Recebimentos por cliente',obras:'Resultado por obra',setores:'Resultado por setor',fabricacao:'Custos de fabricação',instalacao:'Custos de instalação',veiculos:'Despesas com veículos',materiais:'Evolução do custo dos materiais',extraordinarias:'Despesas extraordinárias',orcado_realizado:'Contratado x custos lançados'} as const;
export type ReportKind=keyof typeof REPORTS;
export type ReportFilters={kind:ReportKind;from:string;to:string;saleType:string;days:number;scenario:ScenarioKey};
export type ReportColumn={key:string;label:string;format?:'money'|'number'|'date'|'unitcost'};
export type FinancialReport={title:string;criteria:string;generatedAt:string;warnings:string[];columns:ReportColumn[];rows:Record<string,unknown>[]};
export function parseReportFilters(search:URLSearchParams,today:string):ReportFilters{
 const kind=(search.get('relatorio')||'executivo') as ReportKind;if(!Object.hasOwn(REPORTS,kind))throw new Error('Selecione um relatório válido.');
 const from=search.get('de')||`${today.slice(0,4)}-01-01`,to=search.get('ate')||today;
 if(!validIsoDate(from)||!validIsoDate(to)||to<from)throw new Error('Confira o período.');
 const distance=(Number(to.slice(0,4))-Number(from.slice(0,4)))*12+Number(to.slice(5,7))-Number(from.slice(5,7));
 if(distance>35)throw new Error('Selecione até 36 meses por relatório.');
 const saleType=search.get('tipo')||'';if(saleType&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saleType))throw new Error('Tipo de venda inválido.');
 const days=Number(search.get('dias')||30);if(!Number.isInteger(days)||days<1||days>366)throw new Error('A projeção aceita de 1 a 366 dias.');
 const scenario=(search.get('cenario')||'provavel') as ScenarioKey;if(!Object.hasOwn(SCENARIOS,scenario))throw new Error('Cenário inválido.');
 return {kind,from,to,saleType,days,scenario};
}
const col=(key:string,label:string,format?:ReportColumn['format']):ReportColumn=>({key,label,format});
const moneyCol=(key:string,label:string)=>col(key,label,'money');
const num=(v:unknown)=>{const n=Number(v??0);if(!Number.isFinite(n))throw new Error('Valor financeiro inválido no relatório.');return n;};
export function buildFinancialReport(f:ReportFilters,data:any,generatedAt=new Date().toISOString(),saleTypeName='Todos'):FinancialReport{
 const report:FinancialReport={title:REPORTS[f.kind],criteria:`Período: ${f.from} a ${f.to}. Tipo de venda: ${saleTypeName}.`,generatedAt,warnings:[],columns:[],rows:[]};
 if(f.kind==='dre'||f.kind==='mensal'){
  const months=monthsBetween(f.from,f.to),rows=buildDre(data as DreLine[],months);
  report.criteria+=' Regime de competência; contas canceladas excluídas.';
  report.warnings.push('DRE gerencial: não substitui demonstração contábil. Contas sem categoria podem alterar a classificação do resultado.');
  if(f.kind==='mensal'){
   report.columns=[col('month','Competência'),moneyCol('revenue','Receita bruta'),moneyCol('cost','Custos'),moneyCol('operating','Operacional'),moneyCol('result','Resultado')];
   report.rows=months.map((month,i)=>({month:month.slice(0,7),revenue:rows[0].values[i],cost:rows[3].values[i],operating:rows[8].values[i],result:rows[10].values[i]}));
  }else{
   report.columns=[col('month','Competência'),col('line','Linha'),col('category','Categoria'),moneyCol('value','Valor')];
   report.rows=months.flatMap((month,i)=>rows.flatMap(r=>[{month:month.slice(0,7),line:r.label,category:'Total da linha',value:r.values[i]},...(r.details??[]).filter(d=>d.values[i]!==0).map(d=>({month:month.slice(0,7),line:r.label,category:d.category,value:d.values[i]}))]));
   report.warnings.push('Totais de linhas e detalhes são apresentados separadamente. Não some todas as linhas da planilha: há subtotais.');
  }
 }else if(f.kind==='caixa'){
  const cash=data as CashOverview,scenario=projectScenario(cash,f.scenario);
  report.criteria=`Base: ${cash.today}. Horizonte: ${cash.days} dias. Cenário: ${SCENARIOS[f.scenario].label}. Todas as contas autorizadas; o filtro por tipo de venda não se aplica ao saldo bancário.`;
  report.columns=[col('start','Início','date'),col('end','Fim','date'),moneyCol('receivable','A receber'),moneyCol('payable','A pagar'),moneyCol('balance','Saldo final')];
  report.rows=weeklyProjection(cash,f.scenario);
  report.warnings.push(`Saldo atual: ${formatMoney(currentBalance(cash))}. Saldo final projetado: ${formatMoney(scenario.final)}. Projeções são estimativas, não pagamentos.`);
  if(cash.forecast_sources&&(!cash.forecast_sources.recurrences||!cash.forecast_sources.payroll||!cash.forecast_sources.purchases))report.warnings.push('Projeção parcial: fontes sem permissão não são incluídas.');
 }else if(f.kind==='executivo'){
  report.criteria+=' Critério de vencimento igual ao painel financeiro.';
  report.columns=[col('metric','Indicador'),moneyCol('value','Valor')];
  report.rows=[['A receber','receivable_total'],['A pagar','payable_total'],['Em aberto','pending_total'],['Vencido','overdue_total']].map(([metric,key])=>({metric,value:num(data[key])}));
 }else if(f.kind==='vencidos'){
  report.criteria+=' Vencimento no período, anterior à geração; saldo em aberto, sem cancelados.';
  report.columns=[col('description','Descrição'),col('pessoa','Cliente / fornecedor'),col('tipo','Tipo'),col('due_date','Vencimento','date'),moneyCol('total','Total'),moneyCol('pago','Pago'),moneyCol('aberto','Em aberto')];report.rows=data;
 }else if(f.kind==='fornecedores'){
  report.criteria+=' Contas a pagar por vencimento, sem cancelados. Quantidade de contas, sem duplicar baixas.';
  report.columns=[col('fornecedor','Fornecedor'),col('quantidade','Contas','number'),moneyCol('total','Total'),moneyCol('pago','Pago'),moneyCol('aberto','Em aberto')];report.rows=data;
 }else if(f.kind==='clientes'){
  report.criteria+=' Data efetiva da baixa; estornos excluídos.';report.columns=[col('cliente','Cliente'),col('baixas','Baixas','number'),moneyCol('recebido','Recebido')];report.rows=data;
 }else if(['obras','setores','orcado_realizado'].includes(f.kind)){
  report.criteria+=' Obras cadastradas no período; valores acumulados da obra até a geração.';
  report.warnings.push('Margem parcial: inclui somente contas vinculadas à venda ou rateadas. Materiais consumidos, mão de obra, instalações e outros custos ainda sem lançamento não estão incluídos.');
  const works:Record<string,unknown>[]=(data as Record<string,unknown>[]).map(r=>({...r,revenue:num(r.contracted)+num(r.extra_revenue),received:num(r.received_total??r.received),receivable:num(r.receivable_total??r.receivable)}));
  if(f.kind==='setores'){
   const groups=new Map<string,Record<string,unknown>>();
   for(const r of works){const name=String(r.setor??'Sem setor');const group=groups.get(name)??{setor:name,revenue:0,received:0,cost_total:0,margin:0};for(const k of ['revenue','received','cost_total','margin'])group[k]=(Math.round(num(group[k])*100)+Math.round(num(r[k])*100))/100;groups.set(name,group);}
   report.rows=[...groups.values()];report.columns=[col('setor','Setor'),moneyCol('revenue','Contratado + extras'),moneyCol('received','Recebido'),moneyCol('cost_total','Custos lançados'),moneyCol('margin','Margem parcial')];
  }else{report.rows=works;report.columns=[col('order_number','Obra'),col('client_name','Cliente'),moneyCol('revenue','Contratado + extras'),moneyCol('received','Recebido'),moneyCol('cost_total','Custos lançados'),moneyCol('margin','Margem parcial')];}
  if(f.kind==='orcado_realizado')report.warnings.push('Compara receita contratada com custos já lançados. O orçamento completo de custos ainda precisa ser cadastrado para comparar previsto e realizado.');
 }else if(f.kind==='materiais'){
  report.criteria+=' Data da compra (ou cadastro quando ausente), por material e unidade; custo médio ponderado pela quantidade comprada.';
  report.columns=[col('mes','Mês','date'),col('material','Material'),col('unidade','Unidade'),col('quantidade','Quantidade','number'),moneyCol('custo','Custo total'),col('custo_medio','Custo unitário médio','unitcost')];report.rows=data;
 }else{
  report.criteria+=' Competência; somente despesas classificadas explicitamente no grupo do relatório, sem cancelados.';
  report.warnings.push('Despesas sem grupo de relatório ficam fora. Configure os grupos em Categorias e centros de custos.');
  report.columns=[col('description','Descrição'),col('categoria','Categoria'),col('centro','Centro de custos'),col('competencia','Competência','date'),moneyCol('total','Total'),moneyCol('pago','Pago'),moneyCol('aberto','Em aberto')];report.rows=data;
 }
 return report;
}
export const formatMoney=(value:unknown)=>num(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function reportCell(value:unknown,column:ReportColumn):string{
 if(value===null||value===undefined)return '—';
 if(column.format==='money')return formatMoney(value);
 if(column.format==='number'||column.format==='unitcost')return num(value).toLocaleString('pt-BR',{maximumFractionDigits:column.format==='unitcost'?4:3});
 if(column.format==='date'){const s=String(value).slice(0,10);return validIsoDate(s)?`${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`:String(value);}
 return String(value);
}
function csvText(value:string){value=value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');const safe=/^[\s]*[=+@\-\t\r]/.test(value)?`'${value}`:value;return `"${safe.replaceAll('"','""')}"`;}
export function financialReportCsv(report:FinancialReport):string{
 const lines=[[report.title],[report.criteria],[`Gerado em: ${new Date(report.generatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}`],...report.warnings.map(w=>[w]),[],report.columns.map(c=>c.label)].map(row=>row.map(csvText).join(';'));
 for(const row of report.rows)lines.push(report.columns.map(c=>{const value=row[c.key];return c.format&&c.format!=='date'&&value!==null&&value!==undefined?num(value).toLocaleString('pt-BR',{useGrouping:false,maximumFractionDigits:c.format==='unitcost'?4:c.format==='number'?3:2,minimumFractionDigits:c.format==='money'?2:0}):csvText(reportCell(value,c));}).join(';'));
 return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
