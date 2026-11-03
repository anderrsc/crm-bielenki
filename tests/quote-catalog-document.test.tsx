import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MARQUINHOS_CATALOG } from "@/lib/gutter-catalog";

const fixture=vi.hoisted(()=>({count:6}));
vi.mock("@/app/(crm)/actions",()=>({approveQuote:vi.fn(),deleteQuote:vi.fn(),duplicateQuote:vi.fn(),updateQuoteSeller:vi.fn(),updateQuotePaymentMethods:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>{const createClient=async()=>({from:(table:string)=>{
  let result: unknown;
  if(table==='quotes') result={id:'00000000-0000-4000-8000-000000000123',quote_number:'EXEMPLO-001',status:'rascunho',subtotal:fixture.count*100,discount:0,freight:0,total:fixture.count*100,created_at:'2026-11-02',valid_until:'2026-12-02',installation_deadline:'A combinar',seller_name:'Equipe Marquinhos',hide_unit_prices:false,notes:'EXEMPLO SEM VALIDADE COMERCIAL. Ilustrações de referência. Medidas e detalhes devem ser confirmados antes da fabricação.',client:{name:'CLIENTE DE EXEMPLO',city:'Jaraguá do Sul',state:'SC'},company:{name:'Calhas e Esquadrias Marquinhos',trade_name:'Calhas e Esquadrias Marquinhos'}};
  else if(table==='gutter_quotes')result={items:MARQUINHOS_CATALOG.pieces.slice(0,fixture.count).map(piece=>({product:piece.name,category:piece.category,thickness:'0.50 mm',cut:'300',color:'Aluminio Natural',quantity:1,meters:2,unit_price:50,total:100}))};
  else result=[];
  const query={select:()=>query,eq:()=>query,single:async()=>({data:result,error:null}),maybeSingle:async()=>({data:result,error:null}),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:result,error:null}).then(resolve)};
  return query;
}});return {createClient,getRequestClient:createClient};});

import { QuoteDocument } from "@/components/quote-document";

test.each([1,6,20])("printed quote embeds %i item drawings and QR codes",async count=>{
  fixture.count=count;
  const html=renderToStaticMarkup(await QuoteDocument({id:'00000000-0000-4000-8000-000000000123',printOnly:true}));
  expect((html.match(/class="quote-piece-image"/g)||[]).length).toBe(count);
  expect((html.match(/class="quote-piece-qr"/g)||[]).length).toBe(count);
  expect(html).not.toContain('src="/catalogo/');
  expect(html).toContain('pecas-3d.html#platibanda');
  expect(html).not.toContain('api.qrserver.com');
  expect((html.match(/class="quote-installed-image"/g)||[]).length).toBe(count);
  expect(html).toContain('Anderson Bielenki');
  expect(html).not.toContain('Anexos internos');
  expect(html).not.toContain('quote_attachments');
  expect(html).not.toContain('quote-empty-row');
  if(process.env.CATALOG_PREVIEW_DIR){mkdirSync(process.env.CATALOG_PREVIEW_DIR,{recursive:true});writeFileSync(path.join(process.env.CATALOG_PREVIEW_DIR,`quote-${count}.html`),html);}
});
