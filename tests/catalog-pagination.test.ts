import { expect, test } from "vitest";
import { loadActiveGutterPrices } from "@/lib/load-gutter-prices";

test("quote editor receives the entire catalog beyond Supabase's 1000-row default",async()=>{
  const records=Array.from({length:1102},(_,i)=>({id:String(i),product:`Peça ${i}`,active:true}));
  const ranges: number[][]=[];
  const db={from:()=>{
    const query={select:()=>query,eq:()=>query,order:()=>query,range:async(start:number,end:number)=>{ranges.push([start,end]);return {data:records.slice(start,end+1),error:null};}};
    return query;
  }};
  const result=await loadActiveGutterPrices(db as never);
  expect(result).toHaveLength(1102);
  expect(result.at(-1)?.id).toBe('1101');
  expect(ranges).toEqual([[0,499],[500,999],[1000,1499]]);
});

test("an unavailable price page fails instead of silently returning an incomplete catalog",async()=>{
  const db={from:()=>{const query={select:()=>query,eq:()=>query,order:()=>query,range:async()=>({data:null,error:{message:'consulta indisponível'}})};return query;}};
  await expect(loadActiveGutterPrices(db as never)).rejects.toThrow(/consulta indisponível/);
});
