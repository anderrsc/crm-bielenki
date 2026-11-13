import {expect,test} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {parseReportFilters,buildFinancialReport,financialReportCsv,type FinancialReport} from '@/lib/financial-report';
import {financialReportPdf} from '@/lib/financial-report-pdf';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
test('reports reject invalid filters and periods that would silently lose DRE months',()=>{
 const parse=(s:string)=>parseReportFilters(new URLSearchParams(s),'2026-11-13');
 expect(()=>parse('de=2023-01-01&ate=2026-01-01')).toThrow(/36 meses/);
 expect(()=>parse('de=2026-02-30')).toThrow(/período/);
 expect(()=>parse('tipo=invalid')).toThrow(/inválido/);
 expect(()=>parse('dias=367')).toThrow(/366/);
 expect(parse('relatorio=dre&de=2024-01-01&ate=2026-12-31').kind).toBe('dre');
});
test('CSV protects text formulas without turning negative financial amounts into text',()=>{
 const report:FinancialReport={title:'Teste',criteria:'Critério',generatedAt:'2026-11-13T12:00:00Z',warnings:[],columns:[{key:'name',label:'Nome'},{key:'value',label:'Valor',format:'money'}],rows:[{name:'\0=HYPERLINK("bad")',value:-12.34},{name:' +SUM(1;2)',value:1}]};
 const csv=financialReportCsv(report);expect(csv).toContain('"\'=HYPERLINK(""bad"")";-12,34');expect(csv).toContain('"\' +SUM(1;2)";1,00');expect(csv.startsWith('\uFEFF')).toBe(true);
});
test('sector totals include extra receipts and clearly indicate incomplete work costs',()=>{
 const f=parseReportFilters(new URLSearchParams('relatorio=setores'),'2026-11-13');
 const report=buildFinancialReport(f,[{setor:'Calhas',contracted:1000,extra_revenue:100,received:50,received_total:75,cost_total:300,margin:800}]);
 expect(report.rows[0]).toMatchObject({revenue:1100,received:75,cost_total:300,margin:800});expect(report.warnings.join(' ')).toMatch(/Margem parcial/);
});
test('PDF repeats the table across A4 pages and accepts long names and unsupported glyphs safely',async()=>{
 const report:FinancialReport={title:'Relatório financeiro',criteria:'Teste de paginação e descrição longa.',generatedAt:'2026-11-13T12:00:00Z',warnings:['Valores de teste.'],columns:[{key:'name',label:'Descrição'},{key:'value',label:'Valor',format:'money'}],rows:Array.from({length:95},(_,i)=>({name:`Fornecedor ${i} - descrição longa com acentuação e emojis 🔧`,value:i+0.01}))};
 const bytes=await financialReportPdf(report),doc=await PDFDocument.load(bytes);expect(doc.getPageCount()).toBeGreaterThan(1);
 for(const page of doc.getPages()){expect(page.getWidth()).toBeCloseTo(595.28);expect(page.getHeight()).toBeCloseTo(841.89);}
 if(process.env.REPORT_PDF_QA){
  const filters=parseReportFilters(new URLSearchParams('relatorio=vencidos'),'2026-11-13');
  const qa=buildFinancialReport(filters,Array.from({length:90},(_,i)=>({description:`Serviço e peças de fabricação e instalação ${i} - conferência da descrição longa`,pessoa:`Fornecedor de peças e materiais ${i}`,tipo:'pagar',due_date:'2026-11-10',total:1234.56,pago:100,aberto:1134.56})),'2026-11-13T12:00:00Z');
  await mkdir(path.dirname(process.env.REPORT_PDF_QA),{recursive:true});await writeFile(process.env.REPORT_PDF_QA,await financialReportPdf(qa));
 }
});
