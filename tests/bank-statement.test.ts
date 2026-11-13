import { expect, test } from "vitest";
import { decodeBankStatement, parseBankStatement } from "@/lib/bank-statement";
const ofx=(transactions:string)=>`OFXHEADER:100\nDATA:OFXSGML\n<OFX><CURDEF>BRL<BANKACCTFROM><BANKID>001<ACCTID>123456<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST>${transactions}</BANKTRANLIST></OFX>`;
const movement=(id="a",amount="-12.34",date="20261113120000[-3:BRT]")=>`<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${date}<TRNAMT>${amount}<FITID>${id}<MEMO>Taxa &amp; serviço</STMTTRN>`;
test("OFX SGML and XML preserve bank dates, signed cents and stable transaction IDs",()=>{
  const a=parseBankStatement(ofx(movement()));
  expect(a.rows).toEqual([{external_id:"a",amount:"-12.34",posted_at:"2026-11-13",description:"Taxa & serviço"}]);
  expect(a.account_hint).toBe("Final 3456");expect(a.source_key).toHaveLength(64);
  const xml=ofx(movement()).replace(/<(TRNTYPE|DTPOSTED|TRNAMT|FITID|MEMO)>([^<]*)/g,"<$1>$2</$1>");
  expect(parseBankStatement(xml).rows).toEqual(a.rows);
  expect(parseBankStatement(ofx(movement("b","1234,56","20261113"))).rows[0].amount).toBe("1234.56");
});
test("CSV supports quoted delimiters, multiline descriptions, explicit locale and exact decimals",()=>{
  const parsed=parseBankStatement('\uFEFFid;data;valor;descrição\r\n1;13/11/2026;"1.234,56";"Pix; cliente"\r\n2;2026-11-12;"(12,30)";"Taxa\nmensal"');
  expect(parsed.rows.map(r=>[r.amount,r.description])).toEqual([["1234.56","Pix; cliente"],["-12.30","Taxa mensal"]]);
  expect(parseBankStatement('id,date,amount,description\n1,2026-11-13,"1,234.56","Paid ""today"""',"en-US").rows[0]).toMatchObject({amount:"1234.56",description:'Paid "today"'});
});
test("repeated IDs are deduplicated only when financial data agrees",()=>{
  expect(parseBankStatement(ofx(movement()+movement())).repeated).toBe(1);
  expect(()=>parseBankStatement(ofx(movement()+movement("a","-13.00")))).toThrow(/data ou valor diferente/);
  expect(()=>parseBankStatement('data;valor;descricao\n13/11/2026;1,00;Sem ID')).toThrow(/colunas id/);
});
test("rejects malformed, ambiguous and unsupported data without partial parsing",()=>{
  for(const value of ["NaN","Infinity","1e4","0","12.345","1000000000000.00"])expect(()=>parseBankStatement(ofx(movement("a",value)))).toThrow();
  expect(()=>parseBankStatement(ofx(movement("a","1","20260230")))).toThrow(/Data/);
  expect(()=>parseBankStatement(ofx(movement()).replace("BRL","USD"))).toThrow(/reais/);
  expect(()=>parseBankStatement(ofx(movement()).replace('<MEMO>','<CORRECTFITID>old<MEMO>'))).toThrow(/correções/);
  expect(()=>parseBankStatement(ofx(movement()).replace('</BANKACCTFROM>','</BANKACCTFROM><BANKACCTFROM><ACCTID>999</BANKACCTFROM>'))).toThrow(/única conta/);
  expect(()=>parseBankStatement('id;data;valor;descricao\na;2026-11-13;12,34;"aberto')).toThrow(/aspas abertas/);
  expect(()=>parseBankStatement(ofx(movement()).replace('</STMTTRN>',''))).toThrow(/incompletas/);
  expect(()=>parseBankStatement('<!DOCTYPE x SYSTEM "https://invalid"><OFX>')).toThrow(/externas/);
});
test("decodes common statement encodings and limits upload size",()=>{
  expect(decodeBankStatement(new Uint8Array([0x54,0x61,0x78,0x61,0x20,0xe7]))).toBe("Taxa ç");
  expect(decodeBankStatement(new Uint8Array([0xff,0xfe,0x4f,0,0x46,0,0x58,0]))).toBe("OFX");
  expect(()=>decodeBankStatement(new Uint8Array(5*1024*1024+1))).toThrow(/5 MB/);
  expect(()=>parseBankStatement('id;data;valor;descricao\n'+Array.from({length:2001},(_,i)=>`${i};2026-11-13;1,00;Pix`).join('\n'))).toThrow(/2.000/);
});
