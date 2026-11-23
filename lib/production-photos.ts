import type { SupabaseClient } from '@supabase/supabase-js';
import type { StepPhoto } from '@/components/production-step-photos';

/** Converte referências antigas do bucket privado sem pedir arquivos a domínios externos. */
export function productionPhotoObject(value:string, companyId:string, supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??'') {
  let path=value, bucket='production-photos';
  if(value.startsWith('https://')||value.startsWith('http://')){
    const prefix=`${supabaseUrl.replace(/\/$/,'')}/storage/v1/object/public/service-photos/`;
    if(!supabaseUrl||!value.startsWith(prefix))return null;
    try{path=decodeURIComponent(value.slice(prefix.length));}catch{return null;}
    bucket='service-photos';
  }
  if(!path.startsWith(`${companyId}/production/`)||path.includes('..')||/[\\?#]/.test(path))return null;
  return {bucket,path};
}

export async function loadProductionStepPhotos(db:SupabaseClient, productionOrderId:string):Promise<StepPhoto[]> {
  const {data,error}=await db.from('v_production_step_photos').select('id,company_id,step_number,photo_url,caption,uploaded_by_name,created_at')
    .eq('production_order_id',productionOrderId).order('created_at');
  if(error)throw new Error('Não foi possível carregar as fotos da produção.');
  return Promise.all((data??[]).map(async photo=>{
    const object=productionPhotoObject(photo.photo_url,photo.company_id);
    if(!object)return {...photo,photo_url:''};
    const {data:signed,error}=await db.storage.from(object.bucket).createSignedUrl(object.path,1800);
    return {...photo,photo_url:error?'':signed?.signedUrl??''};
  }));
}
