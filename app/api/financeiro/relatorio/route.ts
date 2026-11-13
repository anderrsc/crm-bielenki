import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {todayISO} from '@/lib/utils';
import {parseReportFilters,buildFinancialReport,financialReportCsv} from '@/lib/financial-report';
import {financialReportPdf} from '@/lib/financial-report-pdf';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(request:NextRequest){
 const db=await createClient(),{data:{user}}=await db.auth.getUser();if(!user)return NextResponse.json({error:'Entre novamente.'},{status:401});
 const format=request.nextUrl.searchParams.get('formato')||'pdf';if(format!=='pdf'&&format!=='csv')return NextResponse.json({error:'Formato inválido.'},{status:400});
 let filters;try{filters=parseReportFilters(request.nextUrl.searchParams,todayISO());}catch(e){return NextResponse.json({error:(e as Error).message},{status:400});}
 const rights=await db.rpc('has_table_access',{resource:'financial_exports',action:'insert'});if(rights.error||rights.data!==true)return NextResponse.json({error:'Sem permissão para exportar.'},{status:403});
 const [result,type]=await Promise.all([db.rpc('financial_report_data',{p_kind:filters.kind,p_start:filters.from,p_end:filters.to,p_sale_type:filters.saleType||null,p_days:filters.days}),filters.saleType?db.from('sale_types').select('name').eq('id',filters.saleType).maybeSingle():{data:{name:'Todos'},error:null}]);
 if(result.error||type.error||!type.data)return NextResponse.json({error:result.error?.code==='P0001'?result.error.message:result.error?.code==='42501'?'Sem permissão para esta fonte.':'Não foi possível gerar o relatório.'},{status:result.error?.code==='42501'?403:400});
 try{
  const report=buildFinancialReport(filters,result.data,new Date().toISOString(),type.data.name);
  if(report.rows.length>10000||format==='pdf'&&report.rows.length>3000)return NextResponse.json({error:'Há muitas linhas para este formato. Reduza o período ou use a planilha.'},{status:400});
  const body=format==='pdf'?await financialReportPdf(report):financialReportCsv(report);
  const audit=await db.rpc('record_financial_export',{p_kind:filters.kind,p_format:format,p_filters:filters,p_rows:report.rows.length});
  if(audit.error)return NextResponse.json({error:'Não foi possível registrar a exportação. Tente novamente.'},{status:503});
  return new NextResponse(body as BodyInit,{headers:{'Content-Type':format==='pdf'?'application/pdf':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="financeiro-${filters.kind}-${todayISO()}.${format}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){console.error('Falha no relatório financeiro:',e instanceof Error?e.message:'erro');return NextResponse.json({error:'Não foi possível formatar o relatório. Reduza o período ou exporte a planilha.'},{status:500});}
}
