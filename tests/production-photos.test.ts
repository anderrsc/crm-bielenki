import {expect,test,vi} from 'vitest';
import {loadProductionStepPhotos,productionPhotoObject} from '@/lib/production-photos';
test('referências antigas privadas são convertidas; domínios externos e caminhos fora da empresa são rejeitados',()=>{
  const key='company/production/order/step-1/photo.jpg',base='https://test.supabase.co';
  expect(productionPhotoObject(key,'company',base)).toEqual({bucket:'production-photos',path:key});
  expect(productionPhotoObject(`${base}/storage/v1/object/public/service-photos/${key}`,'company',base)).toEqual({bucket:'service-photos',path:key});
  expect(productionPhotoObject(`https://external.example/${key}`,'company',base)).toBeNull();
  expect(productionPhotoObject(key,'other',base)).toBeNull();
  expect(productionPhotoObject('company/production/../secret','company',base)).toBeNull();
});
test('galeria usa URL assinada temporária, sem emitir URL pública ou buscar domínio externo',async()=>{
  const sign=vi.fn(async()=>({data:{signedUrl:'https://test.supabase.co/signed'},error:null}));
  const result={data:[{id:'photo',company_id:'company',step_number:1,photo_url:'company/production/order/step-1/photo.jpg'}],error:null};
  const q:any={select:()=>q,eq:()=>q,order:async()=>result};
  const from=vi.fn(()=>({createSignedUrl:sign}));
  const photos=await loadProductionStepPhotos({from:()=>q,storage:{from}} as never,'order');
  expect(from).toHaveBeenCalledWith('production-photos');
  expect(sign).toHaveBeenCalledWith('company/production/order/step-1/photo.jpg',1800);
  expect(photos[0].photo_url).toBe('https://test.supabase.co/signed');
});
