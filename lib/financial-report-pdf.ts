import {PDFDocument,StandardFonts,rgb,type PDFFont,type PDFPage} from 'pdf-lib';
import {reportCell,type FinancialReport} from '@/lib/financial-report';

/** Text PDF, no browser/network. Every row wraps; headers repeat on each A4 page. */
export async function financialReportPdf(report:FinancialReport):Promise<Uint8Array>{
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const landscape=report.columns.length>5,width=landscape?841.89:595.28,height=landscape?595.28:841.89,margin=32,usable=width-margin*2;
 const ink=rgb(.09,.15,.13),green=rgb(.12,.3,.23),muted=rgb(.35,.39,.37),pale=rgb(.94,.96,.94);
 const clean=(s:string)=>[...s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,' ')].map(ch=>{try{font.encodeText(ch);return ch;}catch{return '?';}}).join('');
 const wrap=(text:string,max:number,size:number,f:PDFFont=font)=>{
  const out:string[]=[];let line='';
  for(const word of clean(text).split(/\s+/)){
   if(f.widthOfTextAtSize(line?line+' '+word:word,size)<=max){line=line?line+' '+word:word;continue;}
   if(line)out.push(line);line='';
   for(const ch of word){if(f.widthOfTextAtSize(line+ch,size)>max&&line){out.push(line);line='';}line+=ch;}
  }
  if(line||!out.length)out.push(line);return out;
 };
 const weights=report.columns.map(c=>c.format?1:1.65),sum=weights.reduce((a,b)=>a+b,0),widths=weights.map(w=>usable*w/sum);
 let page:PDFPage,y=0;
 const addPage=(first:boolean)=>{
  page=doc.addPage([width,height]);y=height-margin;
  page.drawText('MARQUINHOS | FINANCEIRO',{x:margin,y,size:9,font:bold,color:green});y-=23;
  for(const line of wrap(report.title,usable,16,bold)){page.drawText(line,{x:margin,y,size:16,font:bold,color:ink});y-=20;}
  for(const line of wrap(report.criteria,usable,8)){page.drawText(line,{x:margin,y,size:8,font,color:muted});y-=11;}
  page.drawText(`Gerado em ${new Date(report.generatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} (Brasília)`,{x:margin,y,size:8,font,color:muted});y-=17;
  if(first)for(const warning of report.warnings){for(const line of wrap(warning,usable,8)){page.drawText(line,{x:margin,y,size:8,font,color:muted});y-=11;}y-=4;}
  const header=report.columns.map((c,i)=>wrap(c.label,widths[i]-12,8,bold)),h=Math.max(...header.map(a=>a.length))*11+12;
  page.drawRectangle({x:margin,y:y-h,width:usable,height:h,color:green});let x=margin;
  header.forEach((lines,i)=>{lines.forEach((line,j)=>page.drawText(line,{x:x+6,y:y-12-j*11,size:8,font:bold,color:rgb(1,1,1)}));x+=widths[i];});y-=h;
 };
 addPage(true);
 if(!report.rows.length){page!.drawText('Nenhum registro para os critérios selecionados.',{x:margin+6,y:y-20,size:10,font,color:muted});}
 for(let index=0;index<report.rows.length;index++){
  const cells=report.columns.map((c,i)=>wrap(reportCell(report.rows[index][c.key],c),widths[i]-12,8)),rowHeight=Math.max(...cells.map(c=>c.length))*11+12;
  if(rowHeight>height-200)throw new Error('Uma descrição é longa demais para o PDF. Exporte a planilha.');
  if(y-rowHeight<margin+22)addPage(false);
  if(y-rowHeight<margin+22)throw new Error('Uma descrição é longa demais para o PDF. Exporte a planilha.');
  if(index%2===0)page!.drawRectangle({x:margin,y:y-rowHeight,width:usable,height:rowHeight,color:pale});
  let x=margin;cells.forEach((lines,i)=>{lines.forEach((line,j)=>page!.drawText(line,{x:x+6,y:y-12-j*11,size:8,font,color:ink}));x+=widths[i];});
  y-=rowHeight;page!.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:.35,color:rgb(.84,.88,.85)});
 }
 const pages=doc.getPages();for(let i=0;i<pages.length;i++)pages[i].drawText(`${report.rows.length} linha(s) | Página ${i+1} de ${pages.length}`,{x:margin,y:20,size:8,font,color:muted});
 doc.setTitle(clean(report.title));doc.setAuthor('Marquinhos Calhas e Esquadrias');doc.setCreationDate(new Date(report.generatedAt));return doc.save();
}
